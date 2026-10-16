/**
 * The live tier: ONE read-only contract smoke (Ben's testing rules of
 * 2026-09-16 — README "Testing", ARCHITECTURE.md §10, DECISIONS 2026-10-16).
 *
 * Every offline test in this repo renders against a stub whose answers were
 * TYPED by hand from PostgREST responses captured on one day
 * (`tests/fixtures/stub-client.ts`, `tests/http/postgrest-stub.ts`). The
 * stubs are only as honest as those captures, and nothing offline can notice
 * when the service stops answering the way a capture says. That is this
 * file's one job: ask the real service the handful of SHAPE questions the
 * stubs assume the answer to, and compare shapes — never values. No case
 * here asserts a count, an id, a title, an order or a population; those are
 * facts of a database another campaign writes, not fixtures this test owns.
 * Where a case needs a set it can reason about, it narrows on a value it
 * invented itself (a random address nobody holds), so the set is the test's.
 *
 * Read-only, structurally — and `tests/offline/live-guard.test.ts` pins every
 * clause of this paragraph over this directory:
 *
 *  - the one client is the app's own (`getDbClient()`), pointed at the
 *    declared staging target by `./setup.ts` before any case runs;
 *  - every query is a select, a count read, a HEAD, or a GET of the schema
 *    description, issued through that client's own authenticated fetch;
 *  - the single procedure call sends the EMPTY decision `{}`, which
 *    `settle_review_item` refuses with KS029 before it touches a row: the
 *    envelope checks are the first statements of the body — `jsonb_typeof`,
 *    the key set, then `action`, which `{}` fails — and every one of them is
 *    a `raise` ahead of the first `select … into` (read in
 *    `kspace Scraper/supabase/migrations/20260908000002_the_verdict_settles_the_item.sql`
 *    on 2026-10-16). A refusal raised in a `plpgsql` function takes the whole
 *    call back; nothing is settled, nothing is inserted.
 *
 * Each case opens with `// LIVE BECAUSE:` — the one line that says why the
 * question cannot be answered offline, which is the only reason a case may
 * be in this file (rule 3). Budget: ten cases, well under thirty seconds.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDbClient } from "@/lib/db/client";
import { classify, countRead } from "@/lib/db/result";
import {
  SCHEMA_DESCRIPTION_MEDIA_TYPE,
  readFunctionInstalled,
  restEndpointOf,
  type RestEndpoint,
} from "@/lib/db/schema";
import { FN, T } from "@/lib/db/tables";
import { SETTLE_ARGUMENT } from "@/lib/db/verdict";

/**
 * The one table this app owns (`supabase/migrations/20260406_admin_allowed_emails.sql`)
 * and the one `requireAdmin()` consults on every gated request — so it is
 * there in every world the app deploys to, which is why the shape questions
 * are asked of it rather than of a catalog table the scraper may reshape.
 */
const ALLOWLIST = "admin_allowed_emails";

/** Names nothing exposes, so the absence answers are about the NAME, not luck. */
const ABSENT_RELATION = "no_such_relation_contract_smoke";
const ABSENT_COLUMN = "no_such_column_contract_smoke";

/** An address no row holds: a set this test invented, so it may reason about it. */
const nobody = () => `nobody-${randomUUID()}@contract-smoke.invalid`;

/** The error a PostgREST answer carries, as the fields this app reads off it. */
type Refusal = { code?: unknown; message?: unknown } | null;

/** The REST root and the authenticated fetch of the app's own client. */
function endpoint(): RestEndpoint {
  const found = restEndpointOf(getDbClient());
  if (found === null) {
    throw new Error(
      "the app's client no longer exposes its REST endpoint, so the raw-wire " +
        "cases below cannot be asked — and neither can `lib/db/schema.ts`",
    );
  }
  return found;
}

/** A path under the REST root, joined the way `lib/db/schema.ts` joins it. */
const rest = (pathUnderRoot: string) =>
  `${endpoint().url.replace(/\/+$/, "")}${pathUnderRoot}`;

describe("what PostgREST answers, on the declared staging target", () => {
  // LIVE BECAUSE: the stub hands `count` straight back; only the service shows the total riding Content-Range on a GET of zero rows — 200 or 206, never 416, and a counted ZERO as a 0, never a null.
  it("answers a { count: \"exact\" } read over limit 0 with a total, an empty array and no error", async () => {
    const whole = await countRead(getDbClient(), ALLOWLIST);
    expect(whole.error).toBeNull();
    expect(whole.data).toEqual([]);
    expect(Number.isInteger(whole.count) && (whole.count as number) >= 0).toBe(true);
    expect([200, 206]).toContain(whole.status);

    // The same read over a matching set of ZERO — the set is this test's own,
    // because the address is invented — is a 200 carrying a 0, not a 416.
    const none = await countRead(getDbClient(), ALLOWLIST).ilike("email", nobody());
    expect(none.error).toBeNull();
    expect(none.data).toEqual([]);
    expect(none.count).toBe(0);
    expect(none.status).toBe(200);

    // And on the wire, the total is the second half of Content-Range.
    const raw = await endpoint().fetch(rest(`/${ALLOWLIST}?select=*&limit=0`), {
      headers: { Prefer: "count=exact" },
    });
    expect([200, 206]).toContain(raw.status);
    expect(raw.headers.get("content-range")).toMatch(/^(\*|\d+-\d+)\/\d+$/);
    expect(await raw.text()).toBe("[]");
  });

  // LIVE BECAUSE: `tableNotInSchemaCache` in the stub is a typed copy of one capture; the code, the 404 it rides on and the name in its message are the service's to keep.
  it("answers a read of an absent relation with 404 carrying a PGRST205 document, which classifies as not provisioned", async () => {
    const { data, error, count, status } = await countRead(getDbClient(), ABSENT_RELATION);
    expect(status).toBe(404);
    expect(data).toBeNull();
    expect(count).toBeNull();
    expect((error as Refusal)?.code).toBe("PGRST205");
    expect(String((error as Refusal)?.message)).toContain(ABSENT_RELATION);
    expect(classify(error, ABSENT_RELATION)).toEqual({
      kind: "not_provisioned",
      missing: ABSENT_RELATION,
    });
  });

  // LIVE BECAUSE: the http stub withholds the body on a HEAD because the service was once measured doing so; the whole reason `countRead` is a GET rests on that measurement staying true.
  it("sends no body on a HEAD of an absent relation, so the PGRST205 document never reaches a client", async () => {
    const raw = await endpoint().fetch(rest(`/${ABSENT_RELATION}?select=*`), {
      method: "HEAD",
      headers: { Prefer: "count=exact" },
    });
    expect(raw.status).toBe(404);
    expect(await raw.text()).toBe("");

    // …which is exactly the blindness the app refuses to build on: the same
    // question asked head-shaped through the client comes back as a SUCCESS
    // carrying nothing — no error, no count — because there was no body to
    // parse one out of (admin-window/BUG-0210).
    const blind = await getDbClient()
      .from(ABSENT_RELATION)
      .select("*", { head: true, count: "exact" });
    expect(blind.error).toBeNull();
    expect(blind.count).toBeNull();
    expect(blind.status).toBe(204);
  });

  // LIVE BECAUSE: `readOne` tells "no row" from "no answer" by the status the client stamps on a `data: null`; the stub stamps 200 by fiat, the service has to earn it.
  it("answers .maybeSingle() over no rows with data null, no error, and a 200 that carried content", async () => {
    const { data, error, status } = await getDbClient()
      .from(ALLOWLIST)
      .select("id")
      .ilike("email", nobody())
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
    expect(status).toBe(200);
  });

  // LIVE BECAUSE: `classify` maps TWO codes to a missing column (42703, PGRST204); only the service says which one a select of an unknown column raises today, and that it names the column the app then shows.
  it("refuses a select naming an absent column with a column-absence code the app classifies as not provisioned", async () => {
    const { data, error } = await getDbClient()
      .from(ALLOWLIST)
      .select(ABSENT_COLUMN)
      .limit(0);
    expect(data).toBeNull();
    expect(["42703", "PGRST204"]).toContain((error as Refusal)?.code);
    const classified = classify(error, ALLOWLIST);
    expect(classified.kind).toBe("not_provisioned");
    if (classified.kind === "not_provisioned") {
      expect(classified.missing.startsWith(ALLOWLIST)).toBe(true);
    }
  });

  // LIVE BECAUSE: `missingOperator` in the stub says a text pattern over a timestamptz raises 42883 — the code an absent FUNCTION also raises; the service decides whether that collision is still real, and `classify` must keep it an error on a table read.
  it("refuses a text pattern over a timestamp column with 42883, which a table read classifies as an error, never an absence", async () => {
    const { data, error } = await getDbClient()
      .from(ALLOWLIST)
      .select("id")
      .ilike("created_at", "%contract-smoke%")
      .limit(0);
    expect(data).toBeNull();
    expect((error as Refusal)?.code).toBe("42883");
    expect(classify(error, ALLOWLIST).kind).toBe("error");
  });

  // LIVE BECAUSE: the app establishes that settle_review_item and verdicts exist by READING this document, never by calling (BUG-0223); the stub fabricates the document, the service publishes it.
  it("publishes an OpenAPI description at the REST root whose paths list /rpc/settle_review_item and /verdicts", async () => {
    const raw = await endpoint().fetch(rest("/"), {
      headers: { Accept: SCHEMA_DESCRIPTION_MEDIA_TYPE },
    });
    expect(raw.ok).toBe(true);
    expect(raw.headers.get("content-type") ?? "").toContain("openapi+json");
    const body = (await raw.json()) as { paths?: unknown };
    const paths = body.paths;
    expect(typeof paths === "object" && paths !== null && !Array.isArray(paths)).toBe(true);
    const routes = Object.keys(paths as Record<string, unknown>);
    expect(routes).toContain(`/rpc/${FN.settleReviewItem}`);
    expect(routes).toContain(`/${T.verdicts}`);

    // And the app's own reader of that document agrees, through the same client.
    await expect(
      readFunctionInstalled(FN.settleReviewItem, getDbClient()),
    ).resolves.toEqual({ kind: "ok", data: "installed" });
  });

  // LIVE BECAUSE: admin_allowed_emails is app-owned and in no scraper migration; only the live service proves the name `requireAdmin()` consults still resolves, and answers rows shaped { id } and nothing wider.
  it("answers the gate's allowlist read with a row set whose rows carry id", async () => {
    const { data, error, status } = await getDbClient()
      .from(ALLOWLIST)
      .select("id")
      .limit(1);
    expect(error).toBeNull();
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    for (const row of data as unknown[]) {
      expect(Object.keys(row as object)).toEqual(["id"]);
    }
  });

  // LIVE BECAUSE: the stub accepts any filter chain; whether the service parses `is null` and `not is null` beside `eq(queue)` — the two population counts /queues spells — is a fact of PostgREST's grammar, not of this repo.
  it("accepts the two population filters /queues spells, answering each with a total", async () => {
    const db = getDbClient();
    const [withSource, withoutSource] = await Promise.all([
      countRead(db, T.reviewItems).eq("queue", "entity_link").not("source_id", "is", null),
      countRead(db, T.reviewItems).eq("queue", "entity_link").is("source_id", null),
    ]);
    for (const answer of [withSource, withoutSource]) {
      expect(answer.error).toBeNull();
      expect(answer.data).toEqual([]);
      expect(Number.isInteger(answer.count)).toBe(true);
    }
  });

  // LIVE BECAUSE: the offline pin of KS029 grades our handoff's SQL text; only the INSTALLED function proves the service raises that code for the empty decision — before any row, per the body's first statements (see the header).
  it("refuses the empty decision with KS029, settling nothing", async () => {
    const { data, error } = await getDbClient().rpc(FN.settleReviewItem, { [SETTLE_ARGUMENT]: {} });
    expect(data).toBeNull();
    expect((error as Refusal)?.code).toBe("KS029");
    // A refusal the function raised is an ERROR naming the function — never
    // the absence a PGRST202 would be — so the close slot shows the words.
    expect(classify(error, FN.settleReviewItem, "function").kind).toBe("error");
  });
});
