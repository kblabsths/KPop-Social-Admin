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
  | "denied";

export interface PostgrestStub {
  /** `http://127.0.0.1:<port>` — what `SUPABASE_URL` is set to. */
  readonly url: string;
  /** Set what the NEXT request is answered with. */
  setMode(mode: StubMode): void;
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
function bodyFor(mode: StubMode, table: string): { status: number; body: string } {
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
  const requests: string[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${req.method} ${req.url}`);
    const { status, body } = bodyFor(mode, tableOf(url.pathname));
    // `content-length` counts the document either way; a HEAD sends none of
    // it. That asymmetry IS the bug's mechanism — do not "simplify" it.
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body)),
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
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
