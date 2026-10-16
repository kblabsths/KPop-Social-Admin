/**
 * A PostgREST-shaped database the http suite can point the built app at.
 *
 * The http tier's default database is a refused connection
 * (`DB_URL_SENTINEL`), which proves the app survives having no database at
 * all. It cannot prove what the app does with a database that ANSWERS — and
 * the state this campaign most cares about getting right, a project whose
 * ecosystem tables have not been migrated yet, is exactly an answering
 * database (a 404 carrying `PGRST205`). That state was rendered wrongly for
 * the whole of M2 and no offline stub could see it, because an offline stub
 * hands `lib/db` a structured response and never speaks HTTP
 * (admin-window/BUG-0210).
 *
 * **The one fact this file exists to reproduce, and the reason the app's own
 * offline suite is blind to it:** a HEAD response carries NO BODY. PostgREST
 * answers a request for an absent table with 404 and a `PGRST205` document;
 * on a HEAD that document is counted in `content-length` and never sent, so
 * supabase-js — which parses its error out of the body — sees nothing, and
 * rewrites the response to `status 204, error: null, count: null`
 * (`node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts`). `respond`
 * below therefore withholds the body on a HEAD **while still counting it**,
 * exactly as the real server does: measured against the declared staging
 * target 2026-09-11, a HEAD for an absent table answered `404`,
 * `content-length: 162`, and zero bytes on the wire.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

/** How the stub answers the next request. Flip it between probes. */
export type StubMode =
  /** Every table is absent: 404 + `PGRST205`, the un-migrated project. */
  | "absent"
  /** Every read is refused for a reason that is NOT absence: 403 + `42501`. */
  | "denied"
  /**
   * The host answers 404 with ZERO BYTES — a deploy pointed at something that
   * is not this database at all: a wrong `SUPABASE_URL`, or a proxy/gateway in
   * front of the service answering for it (admin-window/BUG-0224).
   *
   * **Why an empty body is its own mode rather than a variant of `absent`.**
   * supabase-js parses its error out of the body; a 404 with none is the one
   * answer it rewrites into a SUCCESS — `status 204, error: null, data: null,
   * count: null` (`node_modules/@supabase/postgrest-js/dist/index.mjs`, the
   * `res.status === 404 && body === ""` arm). So nothing reaches `classify`:
   * no code, no message, no rows and no count. It is the same blindness the
   * HEAD count had, arriving now from the HOST rather than from the request
   * shape — which is why the fix for it could not be another request shape.
   */
  | "blank"
  /**
   * Every table is THERE and holds NO ROWS: 200, a body of `[]`, and a
   * `Content-Range` whose total is 0.
   *
   * The control arm (admin-window/BUG-0224 criterion 3). A refusal that also
   * fired for a genuinely empty table would be a worse bug than the one it
   * replaced — an operator told a read failed when the queue is simply clear —
   * so the empty card has to be provably still reachable over the same wire
   * the refusal arrives on. A total of zero after the slash is what PostgREST
   * puts on a matching set of zero, and supabase-js reads its count out of
   * that half of the header.
   */
  | "empty"
  /**
   * The host answers **200 with a JSON OBJECT** — a body that is not a
   * PostgREST answer at all (QA, admin-window/BUG-0224 attack): a gateway or
   * proxy in front of the service saying its own thing, or a `SUPABASE_URL`
   * whose path lands somewhere that answers JSON.
   *
   * Measured with the real client against a loopback host answering
   * `200 {"message":"no upstream"}`: supabase-js hands back
   * `error: null, data: {"message":"no upstream"}, count: null` for EVERY read
   * shape — set read, count read and complete read alike. `data` is not null,
   * so it is not the `blank` mode's shape; it is a non-array standing where a
   * row set belongs.
   *
   * This is the third of the four host answers BUG-0224's bar names ("a
   * bodyless 404, a 204, an HTML error page from a proxy, a 200 with a body
   * that is not a PostgREST answer"), and the bar is the same for it: a
   * refusal naming the object, never a zero, never an empty card.
   */
  | "foreign"
  /**
   * The host answers **200 with a JSON ARRAY whose elements are not rows of
   * this table** (QA, admin-window/BUG-0227 attack): a gateway or proxy
   * answering its own JSON *list*, or a `SUPABASE_URL` whose path lands on
   * something that answers arrays.
   *
   * The sibling of `foreign`, and the shape its fix does NOT cover: the answer
   * IS an array, so `isRowSet` (`src/lib/db/result.ts`) passes it through as
   * `Row[]`, and the first property access in the render throws on an element
   * that has no such property. Measured over real HTTP against a production
   * build 2026-09-15 with this body and with `[[{"claim_id":"c1"}]]`,
   * `["a","b"]`, `[null,null]` and `[{}]` alike: HTTP 500 and Next's error
   * shell on `/`, `/claims`, `/browse` and `/cycles`, the server logging
   * `TypeError: Cannot read properties of undefined (reading 'trim')`.
   *
   * The bar is the same one `foreign` is held to: whatever a host answers,
   * every surface ANSWERS — a refusal naming the object, never a 500.
   */
  | "alien"
  /**
   * The table is THERE, it answers `200 []` — and the total after the slash in
   * `Content-Range` is **not a number of rows** (QA, admin-window/BUG-0229
   * attack): a negative one, or one past what the machine represents exactly.
   *
   * supabase-js reaches the count with `parseInt` over whatever follows the
   * slash, so a host answering a header it made up hands back `count: -5` (or
   * `1e20`) beside `error: null`. Measured over real HTTP against a production
   * build 2026-09-15: with a total of `-5` the Total counts table on /claims
   * published `-5` in every bucket beside state cards reading `empty`, and
   * with `99999999999999999999` it published
   * `100,000,000,000,000,000,000`.
   *
   * The body is a REAL row set (`[]`), which is the point: the rows arrived
   * and only the count did not, so nothing but the count guard can refuse it.
   * Set the total with `setCountTotal`.
   */
  | "miscounted";

export interface PostgrestStub {
  /** `http://127.0.0.1:<port>` — what `SUPABASE_URL` is set to. */
  readonly url: string;
  /** Set what the NEXT request is answered with. */
  setMode(mode: StubMode): void;
  /**
   * The body the `alien` mode answers with — any JSON ARRAY (as a string).
   *
   * The mode is "an array whose elements are not this table's rows", and the
   * element shapes QA measured 500s on are several
   * (admin-window/BUG-0228 criterion 2): `[{"message":"no upstream"}]`,
   * `[[{"claim_id":"c1"}]]`, `["a","b"]`, `[null,null]`, `[{}]`,
   * `[{"foo":1}]`. They are one mode with one bar, so they are one knob
   * rather than six modes.
   */
  setAlienBody(body: string): void;
  /**
   * The total the `miscounted` mode puts after the slash in `Content-Range`,
   * verbatim — it is a HEADER, so it is a string and may be anything a host
   * can write there (`-5`, `99999999999999999999`).
   *
   * One knob rather than a mode per spelling, for the reason `setAlienBody` is
   * one: they are one host answer — "the total is not a number of rows" — held
   * to one bar.
   */
  setCountTotal(total: string): void;
  /** Every request the app made, as `METHOD /path?query`. */
  readonly requests: string[];
  close(): Promise<void>;
}

/** The table a PostgREST path names: `/rest/v1/pending_claims` -> `pending_claims`. */
function tableOf(pathname: string): string {
  const rest = pathname.replace(/^\/rest\/v1\/?/, "");
  return rest === "" ? "unknown" : decodeURIComponent(rest.split("/")[0]);
}

/**
 * The two bodies, spelled as the database spells them.
 *
 * `PGRST205`'s message is PostgREST's own wording, verbatim from the
 * measurement above; `42501`'s is Postgres's. Neither is this app's prose, and
 * that is the point of asserting against them: what reaches the page in the
 * error case must be the DATABASE's words.
 */
export const DEFAULT_ALIEN_BODY = JSON.stringify([{ message: "no upstream" }]);

/** The `miscounted` mode's total unless a test sets another one. */
export const DEFAULT_COUNT_TOTAL = "-5";

function bodyFor(
  mode: StubMode,
  table: string,
  alienBody: string,
  countTotal: string,
): { status: number; body: string; headers?: Record<string, string> } {
  if (mode === "miscounted") {
    // A real, empty row set — and a total no count of rows could be. Only the
    // count guard (`isCount`, `src/lib/db/result.ts`) stands between this
    // header and a published figure.
    return { status: 200, body: "[]", headers: { "content-range": `*/${countTotal}` } };
  }
  if (mode === "alien") {
    // An array, so `Array.isArray` passed it — of things that are not rows of
    // this table, so the render threw on the first column it read.
    //
    // NO `content-range`, exactly as QA measured it: this host sends no count,
    // so a count read still refuses for the reason it did in `foreign` mode
    // and no figure is published. Giving it one would be a different host —
    // one whose counts are answers — and the surface would then publish them,
    // which is right and is not this ticket's question.
    return { status: 200, body: alienBody };
  }
  if (mode === "foreign") {
    // Not a row set, not an error document: something else's JSON, answered
    // with a success status. The table name is not read — nothing here is
    // about this database.
    return { status: 200, body: JSON.stringify({ message: "no upstream" }) };
  }
  if (mode === "empty") {
    // The answer a real, empty table gives: the array PostgREST always sends
    // for a set read, and a total of zero for anything that asked to count.
    return { status: 200, body: "[]", headers: { "content-range": "*/0" } };
  }
  if (mode === "blank") {
    // 404 and not one byte. `content-length: 0` is what a host answering for
    // something it does not have sends, and it is the whole mode: the table
    // name is not even read, because nothing here is about this database.
    return { status: 404, body: "" };
  }
  if (mode === "absent") {
    return {
      status: 404,
      body: JSON.stringify({
        code: "PGRST205",
        details: null,
        hint: null,
        message: `Could not find the table 'public.${table}' in the schema cache`,
      }),
    };
  }
  return {
    status: 403,
    body: JSON.stringify({
      code: "42501",
      details: null,
      hint: null,
      message: `permission denied for table ${table}`,
    }),
  };
}

/** The 42501 message the `denied` mode answers with, for a test to assert on. */
export function deniedMessage(table: string): string {
  return `permission denied for table ${table}`;
}

/** Start the stub on an ephemeral loopback port. */
export async function startPostgrestStub(
  initialMode: StubMode = "absent",
): Promise<PostgrestStub> {
  let mode: StubMode = initialMode;
  let alienBody = DEFAULT_ALIEN_BODY;
  let countTotal = DEFAULT_COUNT_TOTAL;
  const requests: string[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${req.method} ${req.url}`);
    const { status, body, headers } = bodyFor(
      mode,
      tableOf(url.pathname),
      alienBody,
      countTotal,
    );
    // `content-length` counts the document either way; a HEAD sends none of
    // it. That asymmetry IS the bug's mechanism — do not "simplify" it.
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body)),
      ...headers,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setMode(next: StubMode) {
      mode = next;
    },
    setAlienBody(next: string) {
      alienBody = next;
    },
    setCountTotal(next: string) {
      countTotal = next;
    },
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
