import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_FANOUT,
  ID_CHUNK,
  ROW_CAP,
  callFunction,
  classify,
  readComplete,
  readCount,
  readOne,
  readRows,
  readRowsByIds,
  type AskedObject,
  type DbResponse,
  type DbResult,
} from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import {
  columnNotInSchemaCache,
  functionNotInSchemaCache,
  missingFunctionOnTableRead,
  missingOperator,
  notNullViolation,
  permissionDenied,
  statementTimeout,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  undefinedColumn,
  undefinedColumnOfRelation,
  undefinedFunction,
  undefinedQualifiedColumn,
  undefinedTable,
} from "../../fixtures/stub-client";
import {
  fieldProvenanceRow,
  observationRow,
  pendingClaimsInEveryBucket,
  PENDING_CLAIM_BUCKETS,
  resolutionRunRow,
  reviewItemShapes,
  runRow,
  sourceRow,
} from "../../fixtures/rows";

/**
 * Acceptance test 9's offline half (campaign admin-window): absence is
 * classified by code, everything else surfaces the database's own words, and
 * no exported read throws for any of it.
 */

/**
 * The function M2 settles a review item through (campaign
 * admin-window/TASK-0047, spec F9/F10).
 *
 * It is spelled in this test and NOT in `lib/db/tables.ts`: this ticket adds
 * no call seam, and the write-surface guard
 * (`tests/offline/edit/config.test.ts`, "the write surface of the whole repo")
 * forbids the name on a code line under `src/` until one exists. Nothing in
 * the classifier knows it — `missing` is whatever the caller passed, which is
 * the whole contract this file grades.
 */
const SETTLE_FUNCTION = "settle_review_item";

/**
 * Every code that means "the object you asked for is not here", with the
 * object kind it is about. Six, since admin-window/TASK-0047 added the two
 * FUNCTION codes to the four about a table, a view or a column
 * (ARCHITECTURE.md §4.1).
 *
 * The fourth column is the read a caller must have ASKED for before the code
 * can mean an absence AT ALL (admin-window/BUG-0080): a column is a column OF
 * the table that was read, and the two function codes say nothing about a
 * table. Every row is graded in both directions below — an absence when its
 * own kind was asked for, an error when the other kind was (LESSONS 3).
 */
const ABSENCE_CODES: ReadonlyArray<
  readonly [string, string, unknown, AskedObject]
> = [
  ["PGRST205", "table", tableNotInSchemaCache(T.verdicts), "table"],
  ["42P01", "table", undefinedTable(T.verdicts), "table"],
  ["PGRST204", "column", columnNotInSchemaCache(T.reviewItems, "severity"), "table"],
  ["42703", "column", undefinedColumn("severity"), "table"],
  ["PGRST202", "function", functionNotInSchemaCache(SETTLE_FUNCTION), "function"],
  ["42883", "function", undefinedFunction(SETTLE_FUNCTION), "function"],
];

/** The name a caller of each kind passes — a table it read, a function it called. */
const ASKED_NAME: Readonly<Record<AskedObject, string>> = {
  table: T.reviewItems,
  function: SETTLE_FUNCTION,
};

/** The kind the caller did NOT ask for. */
const otherThan = (asked: AskedObject): AskedObject =>
  asked === "table" ? "function" : "table";

/**
 * Codes that look nothing like an absence and must never be read as one — the
 * other half of the guard (LESSONS 3: a classifier proves itself on both kinds
 * of input, or its green says only that it classifies nothing).
 *
 * `42883` appears in BOTH lists on purpose, in its two shapes: Postgres raises
 * `undefined_function` for a missing OPERATOR as well as for a missing
 * function, and an `ilike` aimed at a `timestamptz` is a query this app got
 * wrong, not an object the database is missing (measured on staging
 * 2026-09-08; admin-window/BUG-0058 is where it bit).
 */
const NEIGHBOURING_CODES: ReadonlyArray<readonly [string, unknown]> = [
  ["57014 statement timeout", statementTimeout()],
  ["23502 not-null violation", notNullViolation(T.walkSandbox, "label")],
  ["42883 missing OPERATOR", missingOperator()],
];

/**
 * A JWT-SHAPED string, assembled at runtime.
 *
 * It has to have the real three-segment shape or it does not exercise the
 * rule, and a literal of that shape in a source file is what a secret scanner
 * is for — so the segments are encoded here instead of pasted. Nothing in it
 * is or ever was a credential. Module-scoped because two cases need the same
 * spelling: the redaction table below, and the document rule's proof that
 * redaction still runs last (admin-window/BUG-0170).
 */
const jwtShaped = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ role: "not-a-real-role" })).toString("base64url"),
  "n0tar3alsignaturevalue",
].join(".");

describe("classify", () => {
  it("reads a table-absent code as not_provisioned naming the table", () => {
    for (const error of [
      tableNotInSchemaCache(T.reviewItems),
      undefinedTable(T.reviewItems),
    ]) {
      expect(classify(error, T.reviewItems)).toEqual({
        kind: "not_provisioned",
        missing: T.reviewItems,
      });
    }
  });

  /**
   * Every spelling a column-absent message reaches us in must name the column,
   * never collapse to the bare table — a table that is fully provisioned but
   * missing one column would otherwise read as absent.
   */
  const COLUMN_ABSENT_MESSAGE_FORMS: ReadonlyArray<[string, unknown]> = [
    ["PostgREST quoted, PGRST204", columnNotInSchemaCache(T.reviewItems, "severity")],
    ["Postgres quoted, unqualified", undefinedColumn("severity")],
    [
      "Postgres quoted, of relation",
      undefinedColumnOfRelation(T.reviewItems, "severity"),
    ],
    [
      "Postgres UNQUOTED, qualified",
      undefinedQualifiedColumn(T.reviewItems, "severity"),
    ],
  ];

  it.each(COLUMN_ABSENT_MESSAGE_FORMS)(
    "reads a column-absent code as not_provisioned naming the column (%s)",
    (_form, error) => {
      const result = classify(error, T.reviewItems);
      expect(result.kind).toBe("not_provisioned");
      // The column is named, and the table it belongs to is still carried.
      expect(result).toMatchObject({ missing: `${T.reviewItems}.severity` });
    },
  );

  it("never reports a bare table for a column-absent code that named a column", () => {
    for (const [, error] of COLUMN_ABSENT_MESSAGE_FORMS) {
      expect(classify(error, T.reviewItems)).not.toMatchObject({
        missing: T.reviewItems,
      });
    }
  });

  it("falls back to the queried name when a column-absent message names nothing", () => {
    // No column in the message: report the object the query actually asked
    // for, rather than guessing a column name out of the prose.
    expect(
      classify({ code: "PGRST204", message: "schema cache reload failed" }, T.sources),
    ).toEqual({ kind: "not_provisioned", missing: T.sources });
    expect(
      classify({ code: "42703", message: "column does not exist" }, T.sources),
    ).toEqual({ kind: "not_provisioned", missing: T.sources });
  });

  it("carries the database's own message verbatim for any other failure", () => {
    const error = permissionDenied(T.verdicts);
    expect(classify(error, T.verdicts)).toEqual({
      kind: "error",
      // The object the query asked for, so a page composing several reads can
      // say WHICH one refused (admin-window/BUG-0016).
      reading: T.verdicts,
      message: expect.stringContaining(error.message),
    });
  });

  it("carries the message of a thrown Error, a thrown string, and a bare object", () => {
    expect(classify(new Error("fetch failed"), T.runs)).toEqual({
      kind: "error",
      reading: T.runs,
      message: "fetch failed",
    });
    expect(classify("socket hang up", T.runs)).toEqual({
      kind: "error",
      reading: T.runs,
      message: "socket hang up",
    });
    // No message anywhere: still an error, still never an invented sentence.
    expect(classify({ status: 503 }, T.runs).kind).toBe("error");
  });

  it("does not treat an absence code on a different-looking error as ok", () => {
    expect(classify({ code: "PGRST116", message: "no rows" }, T.events).kind).toBe(
      "error",
    );
  });

  /* ── the absent FUNCTION (campaign admin-window/TASK-0047) ─────────────── */

  it("reads a function-absent code as not_provisioned naming the function", () => {
    // The M2 normal case: `settle_review_item` is not installed on the
    // database `main` deploys against, so a call to it must reach a page as
    // the same absence a missing table is — never as an error, never a throw.
    for (const error of [
      functionNotInSchemaCache(SETTLE_FUNCTION),
      undefinedFunction(SETTLE_FUNCTION),
    ]) {
      expect(classify(error, SETTLE_FUNCTION, "function")).toEqual({
        kind: "not_provisioned",
        missing: SETTLE_FUNCTION,
      });
    }
  });

  it.each(ABSENCE_CODES)(
    "reads %s (an absent %s) as not_provisioned for a caller that asked for one",
    (_code, _kind, error, asked) => {
      const result = classify(error, ASKED_NAME[asked], asked);
      expect(result.kind).toBe("not_provisioned");
      expect(result).toMatchObject({ missing: expect.stringContaining(ASKED_NAME[asked]) });
    },
  );

  it.each(ABSENCE_CODES)(
    "leaves %s (an absent %s) an ERROR for a caller that asked for the other kind",
    (_code, _kind, error, asked) => {
      // The other half of the guard, and the whole of admin-window/BUG-0080:
      // the database names the object IT could not find; `missing` is the
      // object WE named. When those are different kinds of thing, the app has
      // learned nothing about what it asked for, so it may not claim it absent.
      const asking = otherThan(asked);
      const result = classify(error, ASKED_NAME[asking], asking);
      expect(result.kind).toBe("error");
      expect(result).not.toHaveProperty("missing");
      if (result.kind !== "error") return;
      expect(result.reading).toBe(ASKED_NAME[asking]);
      expect(result.message).toContain((error as { message: string }).message);
    },
  );

  it("names the function the CALLER passed, never one mined from the message", () => {
    // A 42883 from inside the function names the callee — `apply_resolution`,
    // which `settle_review_item`'s body calls. The card still names what the
    // app asked for, in the app's own spelling (ARCHITECTURE.md §4.1).
    expect(
      classify(undefinedFunction("apply_resolution"), SETTLE_FUNCTION, "function"),
    ).toEqual({ kind: "not_provisioned", missing: SETTLE_FUNCTION });
  });

  it.each(NEIGHBOURING_CODES)(
    "leaves %s red, carrying the database's own words",
    (_label, error) => {
      const result = classify(error, T.groups);
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.reading).toBe(T.groups);
      expect(result.message).toContain((error as { message: string }).message);
      // An error is never an absence claim: nothing here says the object is
      // missing, and nothing here carries data.
      expect(result).not.toHaveProperty("missing");
      expect(result).not.toHaveProperty("data");
    },
  );

  /**
   * QA's strict pin for admin-window/BUG-0080, flipped back to a plain
   * `it(...)` by the fix. Nothing else about the case changed.
   */
  it("never calls a PROVISIONED table absent because a TABLE read raised 42883", () => {
    // MEASURED read-only on the declared staging target 2026-09-08
    // (admin-window/TASK-0047 QA): `db.from("groups").select("id")
    // .filter("created_at", "fts", "x")` answers 42883 "function
    // to_tsvector(timestamp with time zone) does not exist" — a non-operator
    // 42883 from a plain TABLE read. `groups` is provisioned and holds rows,
    // so "not_provisioned: groups" is a false claim about an object that is
    // right there — the exact harm the operator exception exists to prevent,
    // reached by the sentence the exception does not match.
    const result = classify(missingFunctionOnTableRead(), T.groups);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.groups);
    expect(result.message).toContain("to_tsvector");
  });

  it("tells the 42883s apart by what the caller asked for", () => {
    // Same code, opposite verdicts, and what separates them is what was ASKED
    // — not the database's prose (admin-window/BUG-0080). Asserted together so
    // a later simplification of either arm reddens here rather than silently
    // turning a provisioned table into an absence.
    expect(
      classify(undefinedFunction(SETTLE_FUNCTION), SETTLE_FUNCTION, "function").kind,
    ).toBe("not_provisioned");
    expect(classify(missingOperator(), T.groups).kind).toBe("error");
    // A 42883 that explains nothing is still an absent function TO A CALLER
    // THAT ASKED FOR ONE: the code plus the question classifies, and the
    // database is never required to explain itself.
    expect(classify({ code: "42883" }, SETTLE_FUNCTION, "function")).toEqual({
      kind: "not_provisioned",
      missing: SETTLE_FUNCTION,
    });
    // The same silent code reaching a TABLE read claims nothing at all.
    expect(classify({ code: "42883" }, T.groups).kind).toBe("error");
    // And a function's own body can still raise the missing OPERATOR, which is
    // not the function being absent either.
    expect(classify(missingOperator(), SETTLE_FUNCTION, "function").kind).toBe("error");
  });

  it("keeps every 42883 a TABLE read can raise red, not just the operator one", () => {
    // The pin above, widened past the one shape it measured (BUG-0080): a
    // `groups` read carrying an `fts`/`plfts` filter raises 42883 saying
    // `function to_tsvector(<type>) does not exist` — a missing OVERLOAD of a
    // function the app never named, from a table that is right there holding
    // rows. Every 42883 a table read can raise is graded here, because the
    // operator sentence was only the first shape anyone had met.
    const shapes: ReadonlyArray<readonly [string, unknown]> = [
      ["a missing function overload", missingFunctionOnTableRead()],
      ["a missing overload on another type", missingFunctionOnTableRead("uuid")],
      ["the missing operator", missingOperator()],
      ["a 42883 that explains nothing", { code: "42883", message: "" }],
      ["PGRST202, which a table read cannot mean", functionNotInSchemaCache("to_tsvector")],
    ];
    for (const [label, error] of shapes) {
      const result = classify(error, T.groups);
      expect(result.kind, label).toBe("error");
      // Nothing here may reach a card as a claim about `groups`.
      expect(result, label).not.toHaveProperty("missing");
      if (result.kind !== "error") continue;
      expect(result.reading, label).toBe(T.groups);
    }
  });

  it("cannot claim a function absence for a caller that did not ask for one", () => {
    // The default is the safe one: a caller that says nothing asked for a
    // TABLE, so a helper or a call site that forgets to say so gets an honest
    // error rather than a confident false absence.
    for (const error of [
      functionNotInSchemaCache(SETTLE_FUNCTION),
      undefinedFunction(SETTLE_FUNCTION),
    ]) {
      expect(classify(error, T.groups).kind).toBe("error");
      expect(classify(error, T.groups, "table").kind).toBe("error");
    }
  });
});

/**
 * The client's own account of a failure (admin-window/BUG-0016).
 *
 * `message` alone is not the account. supabase-js wraps a transport failure as
 * `message: "TypeError: fetch failed"` and puts the REAL cause in `details`,
 * so a reader of `message` alone ships exactly the generic wrapper the Feel
 * forbids ("errors are never swallowed and never replaced with a generic
 * message"). Everything below is about what survives into the `DbResult`.
 */
describe("the database client's own account", () => {
  it("carries the cause out of details when the message is only a wrapper", () => {
    const result = classify(transportFailure(), T.events);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    // The cause, verbatim — this is the whole bug: it used to be dropped.
    expect(result.message).toContain("bad port");
    expect(result.message).toContain("Caused by");
    // And never the wrapper standing alone.
    expect(result.message).not.toBe(transportFailure().message);
  });

  it("says the wrapper once, not twice, when details repeats it", () => {
    // supabase-js's `details` opens with a copy of `message`. Printing both
    // tells an operator nothing and pushes the cause off the line.
    const result = classify(transportFailure(), T.events);
    if (result.kind !== "error") throw new Error("expected an error");
    const wrapper = transportFailure().message;
    expect(result.message.split(wrapper)).toHaveLength(2);
  });

  it("does not read an EMPTY code as a code, or print one", () => {
    // The transport failure comes back with code "" and hint "". Neither is
    // information, and "" is not an absence code.
    const result = classify(transportFailure(), T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).not.toContain("()");
    expect(result.message.trim()).toBe(result.message);
  });

  it("carries message, details, hint and code, in that order", () => {
    // The code was `42883` until admin-window/TASK-0047 taught the classifier
    // that an absent FUNCTION is `not_provisioned` — which would give this
    // case no message to order. The case is about the ORDER of the account's
    // four fields, so it now uses a code that is still an error; nothing else
    // about it changed.
    const error = {
      code: "42501",
      message: "permission denied for function settle",
      details: "the resolver called it with two arguments",
      hint: "No function matches the given name and argument types.",
    };
    const result = classify(error, T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    const at = (part: string) => result.message.indexOf(part);
    expect(at(error.message)).toBeGreaterThanOrEqual(0);
    expect(at(error.details)).toBeGreaterThan(at(error.message));
    expect(at(error.hint)).toBeGreaterThan(at(error.details));
    expect(at(error.code)).toBeGreaterThan(at(error.hint));
  });

  it("follows a thrown Error's cause chain", () => {
    // The other shape of the same failure: a fetch that throws straight
    // through arrives as an Error whose `cause` is the real one.
    const thrown = new Error("TypeError: fetch failed", {
      cause: new Error("bad port"),
    });
    const result = classify(thrown, T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("bad port");
  });

  it("survives a cause that points back at itself", () => {
    const looping: { message: string; cause?: unknown } = { message: "outer" };
    looping.cause = looping;
    const result = classify(looping, T.sources);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("outer");
  });

  it("survives a cause chain that cycles between TWO errors", () => {
    // The self-pointing cause above is the easy cycle. A ping-pong between two
    // errors never repeats a node, so a depth guard is the only thing stopping
    // it, and each node must still be said exactly once (QA, BUG-0016).
    const outer: { message: string; cause?: unknown } = { message: "outer" };
    const inner: { message: string; cause?: unknown } = { message: "inner" };
    outer.cause = inner;
    inner.cause = outer;

    const result = classify(outer, T.sources);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    for (const node of ["outer", "inner"]) {
      expect(result.message.split(node)).toHaveLength(2);
    }
  });

  it("names the read that failed, in the spelling the query used", () => {
    for (const table of [T.events, T.fieldProvenance, T.sources]) {
      expect(classify(transportFailure(), table)).toMatchObject({
        kind: "error",
        reading: table,
      });
    }
  });

  /**
   * An INTERMEDIARY's error page is not the database's account (QA,
   * admin-window/TASK-0066 attack, measured against staging 2026-09-10).
   *
   * `/claims?domain=events%27%29%3B%20drop%20table%20groups%3B--` is answered
   * by the WAF in front of PostgREST with an HTML document, not by PostgREST,
   * so supabase-js hands back the page body as `message`. The measured answer
   * on the landed tree is a 4,547-character Cloudflare document, which the
   * claims card and the paging route's `error` arm both carry verbatim onto
   * the operator's screen.
   *
   * The rule is ARCHITECTURE.md common violations row 15 and LESSONS 4:
   * foreign text reaches an app sentence in its own box or not at all. A
   * document is never a sentence, whatever it says.
   */
  it("does not carry an intermediary's HTML page into the account (admin-window/BUG-0170)", () => {
    // REDUCED — three document shapes, one derivation. Each part's first
    // non-blank character is `<`: the doctype QA measured, an `<html>`
    // fragment sent with NO doctype, and an `<?xml?>` prolog behind a leading
    // newline and indentation. None of them may reach the account.
    const cloudflare = [
      "<!DOCTYPE html>",
      '<html class="no-js" lang="en-US"><head>',
      "<title>Attention Required! | Cloudflare</title>",
      '<meta charset="UTF-8" /></head>',
      "<body>Sorry, you have been blocked</body></html>",
    ].join("\n");
    const nginx =
      "<html><head><title>502 Bad Gateway</title></head>" +
      "<body><center>502 Bad Gateway</center><hr><center>nginx</center></body></html>";
    const xmlEnvelope =
      '\n  <?xml version="1.0" encoding="UTF-8"?>\n' +
      "  <Error><Code>AccessDenied</Code><Message>Request blocked</Message></Error>\n";

    const documents: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      [
        "the Cloudflare doctype page measured against staging",
        cloudflare,
        ["Attention Required", "Cloudflare", "no-js", "charset"],
      ],
      ["an nginx 502 with no doctype", nginx, ["502 Bad Gateway", "nginx", "center"]],
      [
        "an XML error envelope, leading newline and indentation included",
        xmlEnvelope,
        ["AccessDenied", "Request blocked", "encoding"],
      ],
    ];

    for (const [shape, page, itsOwnWords] of documents) {
      const result = classify(
        { code: "", hint: "", details: "", message: page },
        T.pendingClaims,
      );

      expect(result.kind, shape).toBe("error");
      if (result.kind !== "error") continue;
      // Still an honest refusal naming the object it could not read.
      expect(result.reading, shape).toBe(T.pendingClaims);
      // Not a document: no doctype, no tags, nothing for a reader to parse.
      expect(result.message, shape).not.toMatch(/<!DOCTYPE/i);
      expect(result.message, shape).not.toMatch(/<\/?html[\s>]/i);
      expect(result.message, shape).not.toContain("<");
      // COUNTED, NOT SPELLED: no part of the document is quoted — not its
      // title, not its first line, not a tag — and the real character count
      // of what arrived is what the account carries instead.
      for (const quoted of itsOwnWords) {
        expect(result.message, `${shape} quotes ${quoted}`).not.toContain(quoted);
      }
      expect(result.message, shape).toContain(String(page.length));
      // An app-authored clause, not a bare count and not a generic apology:
      // the operator can tell that something other than the database answered.
      const withoutTheCount = result.message.replace(String(page.length), "").trim();
      expect(withoutTheCount.split(/\s+/).length, shape).toBeGreaterThan(3);
      expect(result.message.toLowerCase(), shape).not.toContain("something went wrong");
      expect(result.message.toLowerCase(), shape).not.toContain("sorry");
    }

    // The measured page was 4,547 characters (staging, 2026-09-10). Padded to
    // exactly that length with filler this app wrote, so the number the
    // operator reads is the number `error.message.length` reports.
    const measured = cloudflare.padEnd(4547, "x");
    expect(measured.length).toBe(4547);
    const atMeasuredLength = classify({ code: "", message: measured }, T.pendingClaims);
    expect(atMeasuredLength.kind).toBe("error");
    if (atMeasuredLength.kind === "error") {
      expect(atMeasuredLength.message).toContain("4547");
    }

    // Redaction still runs LAST, over whatever the account became: a document
    // that embedded a key cannot ship one by being reduced first.
    const pageCarryingAKey = `<!DOCTYPE html>\n<html><body>apikey=${jwtShaped}</body></html>`;
    const redacted = classify({ code: "", message: pageCarryingAKey }, T.pendingClaims);
    expect(redacted.kind).toBe("error");
    if (redacted.kind === "error") {
      expect(redacted.message).not.toMatch(/<!DOCTYPE/i);
      expect(redacted.message).not.toContain(jwtShaped);
      expect(redacted.message).toContain(String(pageCarryingAKey.length));
    }

    // CROSSING VERBATIM — the database's own prose is untouched by all of the
    // above, in the order the account has always put its fields.
    const refusal = {
      code: "42501",
      message: "permission denied for table pending_claims",
      details: "the read used the anon role",
      hint: "GRANT SELECT ON pending_claims TO service_role.",
    };
    const denied = classify(refusal, T.pendingClaims);
    expect(denied.kind).toBe("error");
    if (denied.kind === "error") {
      const at = (part: string) => denied.message.indexOf(part);
      expect(at(refusal.message)).toBeGreaterThanOrEqual(0);
      expect(at(refusal.details)).toBeGreaterThan(at(refusal.message));
      expect(at(refusal.hint)).toBeGreaterThan(at(refusal.details));
      expect(denied.message).toContain("(42501)");
    }

    // The fixture that stops this rule from becoming a bracket scrub: a real
    // Postgres message whose prose CONTAINS an angle-bracket operator. It
    // begins with a letter, so it is prose, and it crosses whole.
    const operatorMessage = "operator does not exist: text <-> integer";
    const brackets = classify(
      {
        code: "42883",
        details: null,
        hint: null,
        message: operatorMessage,
      },
      T.events,
    );
    expect(brackets.kind).toBe("error");
    if (brackets.kind === "error") {
      expect(brackets.message).toContain(operatorMessage);
    }

    // And the fixture that stops it from becoming an ASCII filter: data the
    // database itself echoed back, in Hangul. Never reduced, never truncated,
    // never transliterated.
    const duplicate = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "groups_name_key"',
      details: "Key (name)=(르세라핌) already exists.",
      hint: null,
    };
    const collision = classify(duplicate, T.groups);
    expect(collision.kind).toBe("error");
    if (collision.kind === "error") {
      expect(collision.message).toContain(duplicate.message);
      expect(collision.message).toContain(duplicate.details);
      expect(collision.message).toContain("르세라핌");
    }
  });

  it("invents nothing when the client said nothing at all", () => {
    // No message, no details: still an error, still never a sentence of ours.
    const result = classify({}, T.runs);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.toLowerCase()).not.toContain("something went wrong");
    expect(result.message.toLowerCase()).not.toContain("sorry");
  });
});

/**
 * An account carries the parts the DATABASE authored (admin-window/BUG-0173).
 *
 * admin-window/BUG-0170 put the decision in one place and asked one question
 * of each part: is this a document? QA's close measured three residuals of the
 * same class arriving one field over or one quote deep — so the ONE derivation
 * grows to three questions and stops there:
 *
 *  1. did WE serialise this part because the value carried no string
 *     `message` (provenance — no text is inspected at all);
 *  2. is its first non-blank character `<`;
 *  3. does it carry runtime stack frames — a line whose text after leading
 *     whitespace begins `at ` and ends in `)` or in `:<digits>:<digits>`.
 *
 * A part the CLIENT authored ABOUT a failure is not the database's words, and
 * is answered the way a document is: counted, never quoted.
 */
describe("an account carries the parts the database authored", () => {
  /** The one-line diagnostic a runtime writes when a 2xx body is not JSON. */
  const NOT_JSON = `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`;

  /** Where the app is deployed — every absolute path below hangs off it. */
  const DEPLOY = "/Users/admin/deploys/kspace-admin";
  const POSTGREST = `${DEPLOY}/node_modules/@supabase/postgrest-js/dist/index.mjs`;

  /**
   * QA's (a): an intermediary answered 2xx with a document, postgrest-js's
   * `JSON.parse` threw, and postgrest-js handed the thrown error's `stack`
   * back as `details`. Measured at 697-802 characters against staging
   * 2026-09-10; this literal is 723.
   */
  const NOT_JSON_STACK = [
    NOT_JSON,
    "    at JSON.parse (<anonymous>)",
    "    at parseJSONFromBytes (node:internal/deps/undici/undici:5589:19)",
    "    at successSteps (node:internal/deps/undici/undici:5570:27)",
    `    at ${POSTGREST}:122:30`,
    "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
    `    at async PostgrestBuilder.then (${POSTGREST}:110:20)`,
    `    at async readRows (${DEPLOY}/src/lib/db/result.ts:476:20)`,
    `    at async loadPendingClaims (${DEPLOY}/src/lib/db/claims.ts:88:18)`,
  ].join("\n");

  const notJsonBody = {
    code: "",
    details: NOT_JSON_STACK,
    hint: "",
    message: NOT_JSON,
  };

  /**
   * QA's (c): the transport failure that is reachable today, measured at
   * `/claims` with the database URL pointed at `db.invalid`. The CAUSE lives
   * on the second line, AFTER the wrapper and BEFORE the frame — which is why
   * a part is never truncated at its first frame (admin-window/BUG-0016).
   */
  const dnsFailure = {
    code: "",
    details:
      "TypeError: fetch failed\n" +
      "    Caused by: Error: getaddrinfo ENOTFOUND db.invalid\n" +
      "        at GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:121:26)",
    hint: "",
    message: "TypeError: fetch failed",
  };

  /**
   * QA's (b): an intermediary's JSON envelope with no `message` field of its
   * own, which `messageOf` had to serialise whole. 114 characters, asserted
   * below rather than trusted.
   */
  const envelope = {
    success: false,
    errors: [{ code: 10015, message: "prohibited" }],
    ray: "8f2c1de4b7c90a13-LHR-6f0a2b9c1d5e7a4133",
  };

  /** The same class, nesting a document one quote deep so it begins with `[`. */
  const nestedDocument = [{ message: "<html>nope</html>" }];

  /**
   * The fixture that stops question 3 from becoming a prose filter: a database
   * message whose indented second line begins "at " and is no frame, because
   * it ends in neither `)` nor `:<digits>:<digits>`.
   */
  const indentedProse = {
    code: "23514",
    details:
      "Failing row contains (7f3a, 2026-09-11, open).\n" +
      "    at the end of the statement the window was still open",
    hint: null,
    message:
      'new row for relation "resolution_runs" violates check constraint "runs_window_ck"',
  };

  it("drops the runtime frames of a stack, keeping the cause and saying how many went", () => {
    // REDUCED (1) — the 2xx-non-JSON stack. Eight frame lines go; the
    // runtime's own one-line diagnostic stays, an 11-character quotation of
    // the body included. That sentence is the runtime's, it is bounded, and
    // chasing it would cost the detector this rule exists to refuse.
    expect(NOT_JSON_STACK.length).toBeGreaterThanOrEqual(697);
    expect(NOT_JSON_STACK.length).toBeLessThanOrEqual(802);

    const parsed = classify(notJsonBody, T.pendingClaims);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.reading).toBe(T.pendingClaims);
    expect(parsed.message).toContain(NOT_JSON);
    // Bounded, and carrying no server's filesystem.
    expect(parsed.message.length).toBeLessThan(200);
    expect(parsed.message).not.toContain("node_modules");
    expect(parsed.message).not.toContain("src/lib/db");
    expect(parsed.message).not.toContain(DEPLOY);
    expect(parsed.message).not.toContain("node:internal");
    expect(parsed.message).not.toContain("JSON.parse");
    // Counted, in the app's own words with the number in them — eight frames
    // went, and an operator can see that they did.
    expect(parsed.message).toMatch(/\b8\b[^)]{0,40}frame/);

    // REDUCED (2) — the measured DNS failure. The wrapper says nothing on its
    // own, so the cause must cross whole from AFTER the wrapper line, and the
    // frame must not.
    const transport = classify(dnsFailure, T.pendingClaims);
    expect(transport.kind).toBe("error");
    if (transport.kind !== "error") return;
    expect(transport.reading).toBe(T.pendingClaims);
    expect(transport.message).toContain("fetch failed");
    expect(transport.message).toContain("getaddrinfo ENOTFOUND db.invalid");
    expect(transport.message).toMatch(/\b1\b[^)]{0,40}frame/);
    expect(transport.message).not.toContain("node:dns:");
    expect(transport.message).not.toContain("GetAddrInfoReqWrap");
    // The wrapper is still said once, not twice, after the reduction.
    expect(transport.message.split("TypeError: fetch failed")).toHaveLength(2);

    // The kept lines are re-asked questions 1-2. This part opens with prose,
    // so the document question passes over it; the document is on the line
    // BELOW, above a frame. Dropping the frame must not hand that line to an
    // operator — it is counted where it stands, and the prose around it stays.
    const page = "<html><body>504 Gateway Time-out</body></html>";
    const documentInside = classify(
      {
        code: "",
        details: `upstream said:\n${page}\n    at Object.parse (${POSTGREST}:41:11)`,
        hint: "",
        message: "read failed",
      },
      T.pendingClaims,
    );
    expect(documentInside.kind).toBe("error");
    if (documentInside.kind !== "error") return;
    expect(documentInside.message).toContain("upstream said:");
    expect(documentInside.message).not.toContain("<");
    expect(documentInside.message).not.toContain("Gateway Time-out");
    expect(documentInside.message).toContain(String(page.length));
    expect(documentInside.message).toMatch(/\b1\b[^)]{0,40}frame/);

    // MUST NOT TOUCH — a database message whose indented line begins "at "
    // and is not a frame. It crosses whole: same newline, same indentation,
    // same words, and no count of frames nobody dropped.
    const prose = classify(indentedProse, T.resolutionRuns);
    expect(prose.kind).toBe("error");
    if (prose.kind !== "error") return;
    expect(prose.message).toContain(indentedProse.message);
    expect(prose.message).toContain(indentedProse.details);
    expect(prose.message).not.toMatch(/frame/i);
  });

  it("counts a body it had to serialise, and nothing of what it said", () => {
    // REDUCED (3) — the 114-character envelope with no `message` of its own.
    // Nothing about it is inspected: the question is who wrote the part.
    const serialised = JSON.stringify(envelope);
    expect(serialised.length).toBe(114);

    const counted = classify(envelope, T.pendingClaims);
    expect(counted.kind).toBe("error");
    if (counted.kind !== "error") return;
    expect(counted.reading).toBe(T.pendingClaims);
    expect(counted.message).toContain("114");
    // Neither the envelope's keys nor its values reach the account.
    for (const spelling of [
      "success",
      "errors",
      "ray",
      "message",
      "prohibited",
      "10015",
      envelope.ray,
      "false",
      "{",
    ]) {
      expect(counted.message, `quotes ${spelling}`).not.toContain(spelling);
    }
    // An app-authored clause, not a bare number and not a generic apology: an
    // operator can tell that something other than the database answered.
    const withoutTheCount = counted.message.replace("114", "").trim();
    expect(withoutTheCount.split(/\s+/).length).toBeGreaterThan(3);
    expect(counted.message.toLowerCase()).not.toContain("something went wrong");
    expect(counted.message.toLowerCase()).not.toContain("sorry");

    // REDUCED (4) — the same class nesting a document one quote deep. Its
    // first character is `[`, so the document question never sees it; the
    // provenance question does.
    const nested = classify(nestedDocument, T.pendingClaims);
    expect(nested.kind).toBe("error");
    if (nested.kind !== "error") return;
    expect(nested.message).toContain(String(JSON.stringify(nestedDocument).length));
    expect(nested.message).not.toContain("<");
    expect(nested.message).not.toContain("nope");
    expect(nested.message).not.toContain("html");

    // A serialised body that hid a credential is still counted, and the
    // redaction that runs last has nothing left to find.
    const keyed = classify({ status: 403, detail: `apikey=${jwtShaped}` }, T.sources);
    expect(keyed.kind).toBe("error");
    if (keyed.kind !== "error") return;
    expect(keyed.message).not.toContain(jwtShaped);
    expect(keyed.message).not.toContain("apikey");

    // MUST NOT TOUCH (1) — a value that HAS a string message was never
    // serialised, whatever else it carries. STACK.md §5's launch diagnosis
    // depends on this exact sentence reaching the panel.
    const unset = classify(new Error("SUPABASE_URL is not set"), T.pendingClaims);
    expect(unset.kind).toBe("error");
    if (unset.kind !== "error") return;
    expect(unset.message).toBe("SUPABASE_URL is not set");

    // MUST NOT TOUCH (2) — the four-field PostgREST refusal, every field in
    // order and the code still in parentheses.
    const refusal = {
      code: "42501",
      message: "permission denied for view pending_claims",
      details: "the read used the anon role",
      hint: "GRANT SELECT ON pending_claims TO service_role.",
    };
    const denied = classify(refusal, T.pendingClaims);
    expect(denied.kind).toBe("error");
    if (denied.kind !== "error") return;
    const at = (part: string) => denied.message.indexOf(part);
    expect(at(refusal.message)).toBeGreaterThanOrEqual(0);
    expect(at(refusal.details)).toBeGreaterThan(at(refusal.message));
    expect(at(refusal.hint)).toBeGreaterThan(at(refusal.details));
    expect(denied.message).toContain("(42501)");
  });

  /**
   * The non-vacuity table (LESSONS 8): every anchor proved on an input it MUST
   * reduce AND on one it must NOT. Five rows of each, and a row that grades
   * nothing is a row that proves nothing — so each carries at least one
   * spelling the account must hold and, when it is a reduction, at least one
   * the account must never hold.
   */
  const HANGUL_DUPLICATE = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "groups_name_key"',
    details: "Key (name)=(르세라핌) already exists.",
    hint: null,
  };
  const OPERATOR_MESSAGE = "operator does not exist: text <-> integer";
  const CLOUDFLARE_WITH_A_KEY =
    `<!DOCTYPE html>\n<html><body>apikey=${jwtShaped}</body></html>`;

  const ACCOUNT_FIXTURES: ReadonlyArray<
    readonly [string, boolean, unknown, readonly string[], readonly string[]]
  > = [
    [
      "a runtime stack quoting a document it could not parse",
      true,
      notJsonBody,
      [NOT_JSON],
      ["node_modules", "node:internal", DEPLOY],
    ],
    [
      "the measured transport failure, frames and all",
      true,
      dnsFailure,
      ["getaddrinfo ENOTFOUND db.invalid"],
      ["node:dns:", "GetAddrInfoReqWrap"],
    ],
    [
      "an intermediary's JSON envelope with no message of its own",
      true,
      envelope,
      ["114"],
      ["success", "ray", "prohibited"],
    ],
    [
      "an envelope nesting a document one quote deep",
      true,
      nestedDocument,
      ["33"],
      ["<", "nope", "html"],
    ],
    [
      "an intermediary's document carrying a key (admin-window/BUG-0170)",
      true,
      { code: "", message: CLOUDFLARE_WITH_A_KEY },
      [String(CLOUDFLARE_WITH_A_KEY.length)],
      ["<!DOCTYPE", jwtShaped, "apikey"],
    ],
    [
      "a four-field PostgREST refusal",
      false,
      {
        code: "42501",
        message: "permission denied for view pending_claims",
        details: "the read used the anon role",
        hint: "GRANT SELECT ON pending_claims TO service_role.",
      },
      [
        "permission denied for view pending_claims",
        "the read used the anon role",
        "GRANT SELECT ON pending_claims TO service_role.",
        "(42501)",
      ],
      [],
    ],
    [
      "an angle-bracket operator on a TABLE read, the bracket-scrub fixture",
      false,
      { code: "42883", details: null, hint: null, message: OPERATOR_MESSAGE },
      [OPERATOR_MESSAGE],
      [],
    ],
    [
      "a duplicate key quoting a Hangul value",
      false,
      HANGUL_DUPLICATE,
      [HANGUL_DUPLICATE.message, HANGUL_DUPLICATE.details, "르세라핌"],
      [],
    ],
    [
      "a database message whose indented line begins 'at ' and is no frame",
      false,
      indentedProse,
      [indentedProse.message, indentedProse.details],
      [],
    ],
    [
      "an app-thrown Error the launch diagnosis depends on",
      false,
      new Error("SUPABASE_URL is not set"),
      ["SUPABASE_URL is not set"],
      [],
    ],
  ];

  it("grades ten fixtures: five the rule must reduce, five it must never touch", () => {
    expect(ACCOUNT_FIXTURES).toHaveLength(10);
    expect(ACCOUNT_FIXTURES.filter(([, reduced]) => reduced)).toHaveLength(5);
    expect(ACCOUNT_FIXTURES.filter(([, reduced]) => !reduced)).toHaveLength(5);
    for (const [label, reduced, , carries, never] of ACCOUNT_FIXTURES) {
      expect(carries.length, label).toBeGreaterThan(0);
      if (reduced) expect(never.length, label).toBeGreaterThan(0);
    }
  });

  it.each(ACCOUNT_FIXTURES)(
    "%s",
    (label, _reduced, error, carries, never) => {
      const result = classify(error, T.pendingClaims);
      expect(result.kind, label).toBe("error");
      if (result.kind !== "error") return;
      expect(result.reading, label).toBe(T.pendingClaims);
      for (const words of carries) {
        expect(result.message, `${label}: must carry ${words}`).toContain(words);
      }
      for (const words of never) {
        expect(result.message, `${label}: must not carry ${words}`).not.toContain(
          words,
        );
      }
    },
  );

  /**
   * The same ONE derivation, applied evenly (admin-window/BUG-0179): to the
   * `code` arm, to an account where nothing survived, and to every line of a
   * part rather than to framed lines alone. Each case grades an input the rule
   * MUST answer and its twin, which it must not touch (LESSONS 8).
   */
  it("asks the code the same questions as every other part", () => {
    // REDUCED — a document arriving in `code` BESIDE a real database message.
    // postgrest-js hands the parsed body back as the error object for any
    // non-2xx, so an intermediary authors this field exactly as it authors the
    // envelope QA measured. The message is the database's and crosses whole;
    // the code is counted, in the parentheses it has always rendered in.
    const page = `<!DOCTYPE html>\n<html><body>${"x".repeat(600)}</body></html>`;
    const denied = "permission denied for view pending_claims";
    const documentCode = classify({ code: page, message: denied }, T.pendingClaims);
    expect(documentCode.kind).toBe("error");
    if (documentCode.kind !== "error") return;
    expect(documentCode.reading).toBe(T.pendingClaims);
    expect(documentCode.message).toContain(denied);
    expect(documentCode.message).not.toMatch(/<!DOCTYPE/i);
    expect(documentCode.message).not.toMatch(/<\/?html[\s>]/);
    expect(documentCode.message).not.toContain("<");
    expect(documentCode.message).toContain(String(page.length));
    expect(documentCode.message.length).toBeLessThan(400);

    // MUST NOT TOUCH (1) — a 300-character code that answers NO question
    // crosses VERBATIM, however long it is. The bar is the same derivation as
    // every other part, not a shorter one for this field: a cap here would be
    // the fourth question.
    const longCode = "R".repeat(300);
    const bland = classify(
      { code: longCode, message: "canceling statement due to statement timeout" },
      T.pendingClaims,
    );
    expect(bland.kind).toBe("error");
    if (bland.kind !== "error") return;
    expect(bland.message).toContain("canceling statement due to statement timeout");
    expect(bland.message).toContain(`(${longCode})`);
    expect(bland.message.endsWith(`(${longCode})`)).toBe(true);

    // MUST NOT TOUCH (2) — the four-field PostgREST refusal, byte for byte:
    // every field in order and the code still last, still in parentheses.
    const refusal = {
      code: "42501",
      message: "permission denied for view pending_claims",
      details: "the read used the anon role",
      hint: "GRANT SELECT ON pending_claims TO service_role.",
    };
    const postgrest = classify(refusal, T.pendingClaims);
    expect(postgrest.kind).toBe("error");
    if (postgrest.kind !== "error") return;
    const at = (part: string) => postgrest.message.indexOf(part);
    expect(at(refusal.message)).toBeGreaterThanOrEqual(0);
    expect(at(refusal.details)).toBeGreaterThan(at(refusal.message));
    expect(at(refusal.hint)).toBeGreaterThan(at(refusal.details));
    expect(postgrest.message.endsWith("(42501)")).toBe(true);
  });

  it("says the read was refused when the client said nothing at all", () => {
    // A non-2xx with an EMPTY body: postgrest-js's JSON.parse throws on it and
    // its catch builds `{message: body}`. That is what every bodiless 502, 503
    // and 429 looks like here, and what a head-shaped count read gets. Every
    // part is blank and no code survives, so the account used to be "" and the
    // error line named no failure at all.
    const blank = classify({ message: "" }, T.pendingClaims);
    expect(blank.kind).toBe("error");
    if (blank.kind !== "error") return;
    expect(blank.reading).toBe(T.pendingClaims);
    // The app's own words, and enough of them to read as a sentence.
    expect(blank.message.trim()).toBe(blank.message);
    expect(blank.message.split(/\s+/).length).toBeGreaterThan(3);
    expect(blank.message).toMatch(/refus/i);
    // Nothing invented: no number of any kind, and no generic apology.
    expect(blank.message).not.toMatch(/\d/);
    expect(blank.message.toLowerCase()).not.toContain("something went wrong");
    expect(blank.message.toLowerCase()).not.toContain("sorry");

    // MUST NOT TOUCH — the same empty message beside a code says the code and
    // nothing else. The clause is for the state where NOTHING survived.
    const coded = classify({ code: "42883", message: "" }, T.pendingClaims);
    expect(coded.kind).toBe("error");
    if (coded.kind !== "error") return;
    expect(coded.message).toBe("(42883)");
  });

  it("counts a document on any line of a part, framed or not", () => {
    // REDUCED — a FRAMELESS two-line part: the client's prose on the first
    // line, a whole intermediary page on the second. The identical part one
    // line above a stack frame was already counted; the question is the same
    // at both granularities, so the answer is too.
    const page = "<html><body>504 Gateway Time-out</body></html>";
    const below = classify(
      {
        code: "",
        details: `reference 8f3c1\n${page}`,
        hint: "",
        message: "read failed",
      },
      T.pendingClaims,
    );
    expect(below.kind).toBe("error");
    if (below.kind !== "error") return;
    expect(below.message).toContain("read failed");
    // The prose line beside it is kept — only the document line is counted.
    expect(below.message).toContain("reference 8f3c1");
    expect(below.message).not.toContain("<");
    expect(below.message).not.toContain("Gateway Time-out");
    expect(below.message).toContain(String(page.length));
    // And no count of frames nobody dropped.
    expect(below.message).not.toMatch(/frame/i);

    // MUST NOT TOUCH — a multi-line part in which no line is a document and no
    // line is a frame comes back byte-identical: same newline, same four
    // leading spaces, same words.
    const prose = {
      code: "23514",
      message:
        'new row for relation "resolution_runs" violates check constraint "runs_window_ck"',
      details:
        "Failing row contains (7f3a, 2026-09-11, open).\n" +
        "    at the end of the statement the window was still open",
      hint: null,
    };
    const untouched = classify(prose, T.resolutionRuns);
    expect(untouched.kind).toBe("error");
    if (untouched.kind !== "error") return;
    expect(untouched.message).toContain(prose.message);
    expect(untouched.message).toContain(prose.details);
    expect(untouched.message).not.toMatch(/frame/i);
    expect(untouched.message.endsWith("(23514)")).toBe(true);
  });

  /**
   * PIN — QA, admin-window/BUG-0179. An account carries the parts the
   * DATABASE authored, and the `code` arm is the one field of the client's
   * account that is never asked that question: it trails in parentheses
   * verbatim, whatever it holds and however long it is.
   *
   * Reachable by the SAME path as the envelope fixture above, one field over.
   * postgrest-js hands the parsed body back AS the error object for ANY
   * non-2xx response (`error = JSON.parse(body)`,
   * node_modules/@supabase/postgrest-js/dist/index.mjs:143), so an
   * intermediary that refuses with a JSON envelope authors every field of it,
   * `code` included. Measured through the real `@supabase/supabase-js` client
   * with a stubbed transport, and again at `/claims` on a production build
   * with SUPABASE_URL pointed at a local 403-answering intermediary: three
   * error cards each carried 4,530 characters of the document.
   *
   * Expected: the account counts the envelope and quotes no value of it.
   * Found: the envelope is counted AND its `code` is appended whole.
   */
  it("never trails a foreign code verbatim after the clause that counted its body (admin-window/BUG-0179)", () => {
    const page = `<!DOCTYPE html>\n<html><body>${"x".repeat(4400)}</body></html>`;
    const refused = { success: false, ray: "8f3c1attack", code: page };
    const serialised = JSON.stringify(refused);

    const result = classify(refused, T.pendingClaims);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    // The counted clause is right and stays right.
    expect(result.message).toContain(String(serialised.length));
    // Nothing of what arrived may sit inside it — the code included.
    expect(result.message).not.toContain("<!DOCTYPE");
    expect(result.message).not.toMatch(/<\/?html[\s>]/);
    // And the account stays a line an operator can read.
    expect(result.message.length).toBeLessThan(400);

    // Nor any key or value of the envelope, which the same clause counted
    // whole (admin-window/BUG-0179's fix: the code is not appended again).
    for (const quoted of ["success", "ray", "8f3c1attack", "false", "{"]) {
      expect(result.message, `quotes ${quoted}`).not.toContain(quoted);
    }

    // QA's blander shape takes the same path, for the same reason: one
    // counted clause, and no run of the intermediary's own characters.
    const blander = { blocked: true, code: "R".repeat(300) };
    const counted = classify(blander, T.pendingClaims);
    expect(counted.kind).toBe("error");
    if (counted.kind !== "error") return;
    expect(counted.message).toContain(String(JSON.stringify(blander).length));
    expect(counted.message).not.toContain("RRR");
    expect(counted.message).not.toContain("blocked");
    expect(counted.message.length).toBeLessThan(400);
  });
});

/**
 * The account reaches a screen, so it must not carry a credential.
 *
 * The host of an unreachable database IS the client's own account of what it
 * could not reach and stays. A key never may — including the one place a
 * `NAME=value` rule misses it, a DSN's password between the colon and the `@`.
 */
describe("the account never carries a credential", () => {
  const HOST = "abcdefghijklmnopqrst.supabase.co";

  const cases: ReadonlyArray<[string, string, string]> = [
    [
      "a JWT",
      `GET https://${HOST}/rest/v1/events failed with apikey ${jwtShaped}`,
      jwtShaped,
    ],
    [
      "a named key in a query string",
      `connect ECONNREFUSED https://${HOST}/rest/v1/events?apikey=sbp_0000notarealkey0000`,
      "sbp_0000notarealkey0000",
    ],
    [
      "a DSN password, mid-line between the colon and the @",
      `could not connect to postgresql://postgres:n0tar3alpassw0rd@${HOST}:5432/postgres`,
      "n0tar3alpassw0rd",
    ],
    [
      "an Authorization header dump",
      `401 from https://${HOST}/rest/v1/events; Authorization: Bearer sb_secret_000notarealsecret000`,
      "sb_secret_000notarealsecret000",
    ],
  ];

  it.each(cases)("redacts %s while keeping the host", (_label, detail, secret) => {
    const result = classify(
      { code: "", hint: "", message: "TypeError: fetch failed", details: detail },
      T.events,
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).not.toContain(secret);
    // The host is what an operator needs in order to know where to look.
    expect(result.message).toContain(HOST);
  });

  /**
   * The rule is about the VALUE, not the field that happened to carry it.
   *
   * The cases above all ride `details`, because `details` is the field this
   * bug taught the account to read. The account now composes `message`,
   * `details`, `hint`, every `cause` in the chain and the `code`, and a
   * credential reaching a screen from any of them is the same leak — so the
   * scrub is asserted per CARRIER, not per case (admin-window/BUG-0016, QA).
   */
  const carriers: ReadonlyArray<[string, (secret: string) => unknown]> = [
    [
      "message",
      (secret) => ({
        code: "",
        message: `GET https://${HOST}/rest/v1/events rejected apikey ${secret}`,
      }),
    ],
    [
      "hint",
      (secret) => ({
        code: "",
        message: `TypeError: fetch failed reaching ${HOST}`,
        hint: `retry with apikey ${secret}`,
      }),
    ],
    [
      "a thrown Error's cause",
      (secret) =>
        new Error(`TypeError: fetch failed reaching ${HOST}`, {
          cause: new Error(`Authorization: Bearer ${secret}`),
        }),
    ],
    [
      "a cause three links down the chain",
      (secret) => ({
        message: `TypeError: fetch failed reaching ${HOST}`,
        cause: {
          message: "socket hang up",
          cause: {
            message: "retrying",
            cause: { message: `apikey ${secret}` },
          },
        },
      }),
    ],
    [
      "the code",
      (secret) => ({
        message: `TypeError: fetch failed reaching ${HOST}`,
        code: secret,
      }),
    ],
  ];

  it.each(carriers)("redacts a JWT arriving in %s", (_label, build) => {
    const result = classify(build(jwtShaped), T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    expect(result.message).not.toContain(jwtShaped);
    // No segment of it either: a key printed in halves is still the key.
    for (const segment of jwtShaped.split(".")) {
      expect(result.message).not.toContain(segment);
    }
    // Scrubbing must not become swallowing — the rest of the account stays.
    expect(result.message).toContain(HOST);
  });
});

/**
 * Criterion 4: the classification is UNCHANGED. `details` is now read for the
 * account, and it must not be read for the classification — an absent object
 * still renders gray and names itself, and only genuine failures render red.
 */
describe("the account does not disturb the classification", () => {
  it("still reads an absent table as not_provisioned when details names something else", () => {
    expect(
      classify(
        {
          ...tableNotInSchemaCache(T.verdicts),
          details: `Perhaps you meant the table 'public.${T.reviewItems}'`,
        },
        T.verdicts,
      ),
    ).toEqual({ kind: "not_provisioned", missing: T.verdicts });
  });

  it("still names the column from the MESSAGE when details quotes another name", () => {
    // The mined column must come from `message`; a quoted identifier in
    // `details` must not be able to take its place.
    expect(
      classify(
        {
          ...undefinedQualifiedColumn(T.events, "badcol"),
          details: "column 'starts_at' is the closest match",
        },
        T.events,
      ),
    ).toEqual({ kind: "not_provisioned", missing: `${T.events}.badcol` });
  });

  it("keeps a transport failure red rather than reading it as an absence", () => {
    // "Red means broken, never unavailable": a database that refuses to answer
    // is broken, whatever its empty code might tempt a reader into.
    expect(classify(transportFailure(), T.events).kind).toBe("error");
  });
});

describe("reads against a scripted PostgREST response", () => {
  it("returns ok with the rows the database returned", async () => {
    const items = reviewItemShapes();
    const stub = stubClient({ [T.reviewItems]: { data: items } });

    const result = await readRows(
      T.reviewItems,
      (db) => db.from(T.reviewItems).select("*").eq("status", "open"),
      stub.asSupabaseClient(),
    );

    expect(result).toEqual({ kind: "ok", data: items });
    // The query used the name from tables.ts, which is the name a
    // not-provisioned card would have to print.
    expect(stub.tablesRead()).toEqual([T.reviewItems]);
    expect(stub.calls[0].steps.map((step) => step.method)).toEqual([
      "select",
      "eq",
    ]);
  });

  it("returns ok with an empty array when there are no rows", async () => {
    const stub = stubClient({ [T.pendingClaims]: { data: null } });
    const result = await readRows(
      T.pendingClaims,
      (db) => db.from(T.pendingClaims).select("*"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: [] });
  });

  it("returns not_provisioned when the table is not in the schema cache", async () => {
    const stub = stubClient({
      [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
    });
    const result = await readRows(
      T.verdicts,
      (db) => db.from(T.verdicts).select("*"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "not_provisioned", missing: T.verdicts });
  });

  it("returns not_provisioned naming the column when a selected column is absent", async () => {
    // The real surface of the bare-qualified 42703: a read selecting an
    // explicit column list off a table that exists but lacks one column.
    const stub = stubClient({
      [T.events]: { error: undefinedQualifiedColumn(T.events, "badcol") },
    });
    const result = await readRows(
      T.events,
      (db) => db.from(T.events).select("event_id,badcol"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({
      kind: "not_provisioned",
      missing: `${T.events}.badcol`,
    });
  });

  it("returns the database's message when the read is refused", async () => {
    const error = permissionDenied(T.observations);
    const stub = stubClient({ [T.observations]: { error } });
    const result = await readRows(
      T.observations,
      (db) => db.from(T.observations).select("*"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({
      kind: "error",
      reading: T.observations,
      message: expect.stringContaining(error.message),
    });
  });

  it("reads one row, and null when there is none", async () => {
    const observation = observationRow();
    const stub = stubClient({
      [T.observations]: [{ data: observation }, { data: null }],
    });
    const client = stub.asSupabaseClient();

    await expect(
      readOne(T.observations, (db) => db.from(T.observations).select("*").maybeSingle(), client),
    ).resolves.toEqual({ kind: "ok", data: observation });
    await expect(
      readOne(T.observations, (db) => db.from(T.observations).select("*").maybeSingle(), client),
    ).resolves.toEqual({ kind: "ok", data: null });
  });

  it("reads a count, and refuses a null count instead of reporting zero", async () => {
    // BUG-0007's user-visible twin (fixed by admin-window/TASK-0026): a
    // response with `error: null` and `count: null` — what a select written
    // WITHOUT `{ head: true, count: "exact" }` returns — used to render a
    // confident 0 for a table holding rows. A counted 0 is still an ok 0.
    const stub = stubClient({
      [T.reviewItems]: [{ count: 7 }, { count: 0 }, { count: null }],
    });
    const client = stub.asSupabaseClient();

    await expect(
      readCount(
        T.reviewItems,
        (db) => db.from(T.reviewItems).select("*", { count: "exact", head: true }),
        client,
      ),
    ).resolves.toEqual({ kind: "ok", data: 7 });
    await expect(
      readCount(
        T.reviewItems,
        (db) => db.from(T.reviewItems).select("*", { count: "exact", head: true }),
        client,
      ),
    ).resolves.toEqual({ kind: "ok", data: 0 });

    const refused = await readCount(
      T.reviewItems,
      // The defective spelling: no count asked for, so none comes back.
      (db) => db.from(T.reviewItems).select("*"),
      client,
    );
    expect(refused.kind).toBe("error");
    if (refused.kind !== "error") return;
    // The object is carried by the result rather than spelled into the prose:
    // every error arm names its read (admin-window/BUG-0016).
    expect(refused.reading).toBe(T.reviewItems);
    expect(refused.message).toContain('count: "exact"');
    // Never a number the database did not give.
    expect(refused).not.toHaveProperty("data");
  });

  it("classifies an absent table on a count read too", async () => {
    const stub = stubClient({
      [T.resolutionRuns]: { error: undefinedTable(T.resolutionRuns) },
    });
    await expect(
      readCount(
        T.resolutionRuns,
        (db) => db.from(T.resolutionRuns).select("*", { count: "exact", head: true }),
        stub.asSupabaseClient(),
      ),
    ).resolves.toEqual({ kind: "not_provisioned", missing: T.resolutionRuns });
  });

  it("keeps a TABLE read that raised 42883 red, and reads the same table again", async () => {
    // admin-window/BUG-0080, through the helper a page actually uses rather
    // than through `classify` alone: the filter Postgres could not build
    // (`fts` on a timestamptz) raises 42883, and `groups` is provisioned and
    // full of rows. Anything but an error here is the card telling an operator
    // to install a table that is right there.
    const stub = stubClient({
      [T.groups]: [{ error: missingFunctionOnTableRead() }, { data: [{ group_id: "g1" }] }],
    });
    const client = stub.asSupabaseClient();
    const search = await readRows(
      T.groups,
      (db) => db.from(T.groups).select("group_id").filter("created_at", "fts", "x"),
      client,
    );

    expect(search.kind).toBe("error");
    expect(search).not.toHaveProperty("missing");
    if (search.kind !== "error") return;
    expect(search.reading).toBe(T.groups);
    // The database's own words, not a sentence of ours.
    expect(search.message).toContain(missingFunctionOnTableRead().message);

    // And the table really is readable — the refusal was about the QUERY.
    await expect(
      readRows(T.groups, (db) => db.from(T.groups).select("group_id"), client),
    ).resolves.toEqual({ kind: "ok", data: [{ group_id: "g1" }] });
  });

  it("keeps an absent-FUNCTION code on a COUNT of a table an error, never a zero", async () => {
    // The two ways a count can go wrong meet here: a 42883 from a table read
    // is an error (BUG-0080) — and, like every refusal, it carries no number
    // (LESSONS 2, ARCHITECTURE.md §4.3).
    const stub = stubClient({
      [T.groups]: { error: functionNotInSchemaCache("to_tsvector") },
    });
    const result = await readCount(
      T.groups,
      (db) => db.from(T.groups).select("*", { count: "exact", head: true }),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    expect(result).not.toHaveProperty("data");
    expect(result).not.toHaveProperty("missing");
  });

  /* ── the absent FUNCTION, through the read path (admin-window/TASK-0047) ── */

  it("returns not_provisioned when the FUNCTION is not in the schema cache", async () => {
    // The whole M2 path in miniature: a real call, through the seam that says
    // a FUNCTION was asked for, against a PostgREST that answers PGRST202 —
    // and what comes back is the absence card's input, not an exception.
    const stub = stubClient({
      [SETTLE_FUNCTION]: { error: functionNotInSchemaCache(SETTLE_FUNCTION) },
    });
    const result = await callFunction(
      SETTLE_FUNCTION,
      (db) => db.rpc(SETTLE_FUNCTION, { p_decision: { action: "keep_current" } }),
      stub.asSupabaseClient(),
    );

    expect(result).toEqual({
      kind: "not_provisioned",
      missing: SETTLE_FUNCTION,
    });
    // The call really went through the client seam, as a FUNCTION call
    // carrying its one argument — not as a table read.
    expect(stub.functionsCalled()).toEqual([SETTLE_FUNCTION]);
    expect(stub.tablesRead()).toEqual([]);
    expect(stub.calls[0].steps[0]).toEqual({
      method: "rpc",
      args: [{ p_decision: { action: "keep_current" } }],
    });
  });

  it("never turns the absent function into a number", async () => {
    // ARCHITECTURE.md §4.3 and LESSONS 2: an absent object is a refusal, never
    // a confident zero — and a null count is a refusal even when nothing is
    // absent at all. Both, over the same function, so this change cannot have
    // quietly made an unreadable object render as "0 settled".
    const absent = stubClient({
      [SETTLE_FUNCTION]: { error: undefinedFunction(SETTLE_FUNCTION) },
    });
    const refusedAbsent = await callFunction(
      SETTLE_FUNCTION,
      (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
      absent.asSupabaseClient(),
    );
    expect(refusedAbsent).toEqual({
      kind: "not_provisioned",
      missing: SETTLE_FUNCTION,
    });
    expect(refusedAbsent).not.toHaveProperty("data");

    const silent = stubClient({ [SETTLE_FUNCTION]: { count: null } });
    const refusedSilent = await readCount(
      SETTLE_FUNCTION,
      (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
      silent.asSupabaseClient(),
    );
    expect(refusedSilent.kind).toBe("error");
    expect(refusedSilent).not.toHaveProperty("data");
  });

  it("refuses the absence when a call site reaches a function through a TABLE read", async () => {
    // The realistic way admin-window/BUG-0080 comes back: not a strange
    // Postgres sentence, but a call site that wires the close slot with the
    // read kind it already knows. `readOne`/`readRows`/`readCount`/
    // `readComplete` all default to `asked: "table"`, so each must answer the
    // function's own absence code with an honest error naming what it read —
    // never the not-provisioned card, which only a caller that came through
    // `callFunction` may be shown.
    for (const error of [
      functionNotInSchemaCache(SETTLE_FUNCTION),
      undefinedFunction(SETTLE_FUNCTION),
    ]) {
      const script = { [SETTLE_FUNCTION]: { error } };
      const rpc = (db: SupabaseClient) => db.rpc(SETTLE_FUNCTION, { p_decision: {} });
      const results: DbResult<unknown>[] = [
        await readOne(SETTLE_FUNCTION, rpc, stubClient(script).asSupabaseClient()),
        await readRows(SETTLE_FUNCTION, rpc, stubClient(script).asSupabaseClient()),
        await readCount(SETTLE_FUNCTION, rpc, stubClient(script).asSupabaseClient()),
        await readComplete(SETTLE_FUNCTION, rpc, stubClient(script).asSupabaseClient()),
      ];
      for (const result of results) {
        expect(result.kind).toBe("error");
        expect(result).not.toHaveProperty("missing");
        expect(result).not.toHaveProperty("data");
      }
    }

    // And the same four, handed the same codes while reading a real TABLE,
    // stay errors about that table rather than absences of it.
    const onATable = await readRows(
      T.groups,
      (db) => db.from(T.groups).select("group_id"),
      stubClient({ [T.groups]: { error: undefinedFunction("to_tsvector") } }).asSupabaseClient(),
    );
    expect(onATable.kind).toBe("error");
    expect(onATable).not.toHaveProperty("missing");
  });

  it("hands back what the function returned, falsy answers included", async () => {
    // A settlement procedure may legitimately answer `false`, `0` or an empty
    // set, and none of those is "it returned nothing". Only a genuinely
    // absent value becomes `null`, so a caller can tell "settled: false" from
    // "the call said nothing" (ARCHITECTURE.md §4.1).
    const answers: ReadonlyArray<readonly [unknown, unknown]> = [
      [false, false],
      [0, 0],
      ["", ""],
      [[], []],
      [{ settled: false }, { settled: false }],
      [null, null],
      [undefined, null],
    ];
    for (const [returned, expected] of answers) {
      const stub = stubClient({ [SETTLE_FUNCTION]: { data: returned } });
      await expect(
        callFunction(
          SETTLE_FUNCTION,
          (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
          stub.asSupabaseClient(),
        ),
      ).resolves.toEqual({ kind: "ok", data: expected });
    }
  });

  it("reads a NUMERIC error code the same way as its string spelling", () => {
    // PostgREST spells its codes as strings, but the client hands back
    // whatever the transport parsed, and `42883` is a number in JSON. The
    // asked-partition must survive that: the same code, both spellings, must
    // reach the same verdict on both arms — otherwise a numeric code slips
    // past `ABSENCE_CODES` and a real absence renders as a raw error, or the
    // reverse (admin-window/BUG-0080).
    const spellings: ReadonlyArray<readonly [unknown, unknown]> = [
      [{ code: "42883", message: "function f(uuid) does not exist" }, { code: 42883, message: "function f(uuid) does not exist" }],
      [{ code: "42703", message: 'column "c" does not exist' }, { code: 42703, message: 'column "c" does not exist' }],
    ];
    for (const [asString, asNumber] of spellings) {
      for (const asked of ["table", "function"] as AskedObject[]) {
        expect(classify(asNumber, ASKED_NAME[asked], asked)).toEqual(
          classify(asString, ASKED_NAME[asked], asked),
        );
      }
    }
    // Named, so the equality above cannot be two identical wrongs: a numeric
    // 42883 is an absence to a function caller and an error to a table read.
    expect(classify({ code: 42883, message: "x" }, SETTLE_FUNCTION, "function").kind).toBe(
      "not_provisioned",
    );
    expect(classify({ code: 42883, message: "x" }, T.groups).kind).toBe("error");
  });

  it("keeps a CALL to an absent function an absence, and a refused call red", async () => {
    // The two verdicts a caller must be able to tell apart, through the same
    // helper: the function is not installed (absence), and the function is
    // there but the call was refused (error, in the database's own words).
    const absent = stubClient({
      [SETTLE_FUNCTION]: { error: functionNotInSchemaCache(SETTLE_FUNCTION) },
    });
    await expect(
      callFunction(
        SETTLE_FUNCTION,
        (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
        absent.asSupabaseClient(),
      ),
    ).resolves.toEqual({ kind: "not_provisioned", missing: SETTLE_FUNCTION });

    const refused = stubClient({
      [SETTLE_FUNCTION]: { error: permissionDenied(SETTLE_FUNCTION) },
    });
    const result = await callFunction(
      SETTLE_FUNCTION,
      (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
      refused.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(SETTLE_FUNCTION);
    expect(result.message).toContain("permission denied");
  });
});

/**
 * The complete read (ARCHITECTURE.md §4.3, campaign admin-window/TASK-0026).
 *
 * The property under test in every case below is one sentence: **an `ok` array
 * is the whole matching set.** So each branch is checked twice — that the
 * refusal happens, and that no array escapes with it.
 */
describe("readComplete", () => {
  /** The query a complete read is contractually required to build. */
  const completeQuery =
    (table: string) =>
    (db: SupabaseClient, cap: number) =>
      db
        .from(table)
        .select("*", { count: "exact" })
        .order("review_item_id", { ascending: true })
        .range(0, cap - 1);

  it("returns ok with every row when the exact count matches what came back", async () => {
    const items = reviewItemShapes();
    const stub = stubClient({
      [T.reviewItems]: { data: items, count: items.length },
    });
    const result = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: items });
  });

  it("returns an empty ok when the database counted nothing", async () => {
    // A counted zero is information; only an ABSENT count is a refusal.
    const stub = stubClient({ [T.pendingClaims]: { data: null, count: 0 } });
    const result = await readComplete(
      T.pendingClaims,
      completeQuery(T.pendingClaims),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: [] });
  });

  it("hands the cap to the query rather than letting the caller spell it", async () => {
    const stub = stubClient({ [T.reviewItems]: { data: [], count: 0 } });
    await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    const range = stub.calls[0].steps.find((step) => step.method === "range");
    expect(range?.args).toEqual([0, ROW_CAP - 1]);
  });

  it("classifies a database error exactly as a window read does", async () => {
    const absent = stubClient({
      [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
    });
    expect(
      await readComplete(T.verdicts, completeQuery(T.verdicts), absent.asSupabaseClient()),
    ).toEqual({ kind: "not_provisioned", missing: T.verdicts });

    const refused = stubClient({
      [T.observations]: { error: permissionDenied(T.observations) },
    });
    expect(
      await readComplete(
        T.observations,
        completeQuery(T.observations),
        refused.asSupabaseClient(),
      ),
    ).toEqual({
      kind: "error",
      reading: T.observations,
      message: expect.stringContaining(permissionDenied(T.observations).message),
    });
  });

  it("refuses a null count instead of fabricating completeness, and returns no array", async () => {
    // The defective spelling: a select without `{ count: "exact" }` answers
    // `error: null, count: null`. Whether those rows are all of them is
    // unknowable, so they must not surface as an ok set.
    const items = reviewItemShapes();
    const stub = stubClient({ [T.reviewItems]: { data: items, count: null } });
    const result = await readComplete(
      T.reviewItems,
      (db) => db.from(T.reviewItems).select("*"),
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.reviewItems);
    expect(result.message).toContain('count: "exact"');
    expect(result).not.toHaveProperty("data");
  });

  it("refuses a truncated set, naming the object, the count and the cap", async () => {
    // What the server's own db-max-rows does to a big table: ROW_CAP rows
    // back, and a count that says there are far more.
    const rows = Array.from({ length: ROW_CAP }, (_, index) => ({
      review_item_id: `row-${index}`,
    }));
    const held = 1732;
    const stub = stubClient({ [T.reviewItems]: { data: rows, count: held } });

    const result = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.reviewItems);
    expect(result.message).toContain(String(held));
    expect(result.message).toContain(String(ROW_CAP));
    // Never a partial array: the whole point of the branch.
    expect(result).not.toHaveProperty("data");
  });

  it("refuses truncation regardless of where the cap bit, cap or server", async () => {
    // One row short of the count is still a truncated set. Nothing here
    // assumes ROW_CAP was the thing that cut it.
    const items = reviewItemShapes();
    const stub = stubClient({
      [T.reviewItems]: { data: items, count: items.length + 1 },
    });
    const result = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
  });
});

/**
 * The cap boundary and the window/complete split (QA attack on
 * admin-window/TASK-0026). The branch above is decided by `count > rows`, so
 * the one row on either side of the cap is where an off-by-one would live, and
 * a refusal that carried rows would be the whole ticket lost.
 */
describe("readComplete at the cap boundary", () => {
  const completeQuery =
    (table: string) =>
    (db: SupabaseClient, cap: number) =>
      db
        .from(table)
        .select("*", { count: "exact" })
        .order("review_item_id", { ascending: true })
        .range(0, cap - 1);

  const capRows = (n: number) =>
    Array.from({ length: n }, (_, index) => ({ review_item_id: `row-${index}` }));

  it("returns every row when the matching set is exactly the cap, and refuses at one more", async () => {
    // A table holding exactly ROW_CAP matching rows IS a whole matching set:
    // 1000 counted, 1000 returned. Refusing here would make the cap a limit on
    // what the app can ever show; returning ok at 1001 would make an `ok`
    // array a partial one.
    const full = stubClient({
      [T.reviewItems]: { data: capRows(ROW_CAP), count: ROW_CAP },
    });
    const complete = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      full.asSupabaseClient(),
    );
    expect(complete.kind).toBe("ok");
    if (complete.kind !== "ok") return;
    expect(complete.data).toHaveLength(ROW_CAP);

    const overflowing = stubClient({
      [T.reviewItems]: { data: capRows(ROW_CAP), count: ROW_CAP + 1 },
    });
    const refused = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      overflowing.asSupabaseClient(),
    );
    expect(refused.kind).toBe("error");
    if (refused.kind !== "error") return;
    expect(refused.message).toContain(String(ROW_CAP + 1));
    expect(refused).not.toHaveProperty("data");
  });

  it("refuses a counted set that came back with no rows at all", async () => {
    // `data: null` with `error: null` and a count of 12: whatever produced it,
    // an empty array here would render as "nothing matches" for a set the
    // database says holds 12 rows. Complete-or-refuse means refuse.
    const stub = stubClient({ [T.reviewItems]: { data: null, count: 12 } });
    const result = await readComplete(
      T.reviewItems,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("12");
    expect(result).not.toHaveProperty("data");
  });

  it("leaves window reads alone: readRows over a counted response still returns its window", async () => {
    // The six gauge modules read through `readRows` and name their window
    // (ARCHITECTURE.md §4.3, §8). A count on the response is not their
    // business: complete-read refusal must never bleed into a window read.
    const stub = stubClient({
      [T.reviewItems]: { data: capRows(3), count: 1732 },
    });
    const result = await readRows(
      T.reviewItems,
      (db) => db.from(T.reviewItems).select("*").order("opened_at").limit(3),
      stub.asSupabaseClient(),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data).toHaveLength(3);
  });
});

describe("no exported read throws", () => {
  const failures: Array<[string, unknown]> = [
    ["table not in schema cache", tableNotInSchemaCache(T.reviewItems)],
    ["undefined_table", undefinedTable(T.reviewItems)],
    ["column not in schema cache", columnNotInSchemaCache(T.reviewItems, "severity")],
    ["undefined_column", undefinedColumn("severity")],
    ["permission denied", permissionDenied(T.reviewItems)],
    ["a bare object", { status: 500 }],
    ["a string", "socket hang up"],
  ];

  it.each(failures)("resolves rather than rejecting on %s", async (_label, error) => {
    const stub = stubClient({ [T.reviewItems]: { error }, [SETTLE_FUNCTION]: { error } });
    const client = stub.asSupabaseClient();

    const results: DbResult<unknown>[] = [
      // `callFunction` is an exported read of `lib/db/result.ts` too, so
      // ARCHITECTURE.md §4.1's "never throws" is its contract as much as any
      // table read's — including for the codes that mean an absence of some
      // OTHER kind of object, which is where the asked-partition sends it
      // (admin-window/BUG-0080).
      await callFunction(
        SETTLE_FUNCTION,
        (db) => db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
        client,
      ),
      await readRows(T.reviewItems, (db) => db.from(T.reviewItems).select("*"), client),
      await readOne(T.reviewItems, (db) => db.from(T.reviewItems).select("*").maybeSingle(), client),
      await readCount(
        T.reviewItems,
        (db) => db.from(T.reviewItems).select("*", { count: "exact", head: true }),
        client,
      ),
      await readComplete(
        T.reviewItems,
        (db, cap) =>
          db
            .from(T.reviewItems)
            .select("*", { count: "exact" })
            .order("review_item_id")
            .range(0, cap - 1),
        client,
      ),
    ];

    for (const result of results) {
      expect(["not_provisioned", "error"]).toContain(result.kind);
    }
  });

  it("turns a query that throws on its way out into an error result", async () => {
    const boom = new Error("TypeError: db.from is not a function");
    const thrower = () => {
      throw boom;
    };
    const client = stubClient({}).asSupabaseClient();

    const thrown = { kind: "error", reading: T.sources, message: boom.message };
    await expect(readRows(T.sources, thrower, client)).resolves.toEqual(thrown);
    await expect(readOne(T.sources, thrower, client)).resolves.toEqual(thrown);
    await expect(readCount(T.sources, thrower, client)).resolves.toEqual(thrown);
    await expect(readComplete(T.sources, thrower, client)).resolves.toEqual(thrown);
    // A callback that throws on the FUNCTION seam resolves the same way, and
    // the throw carries no code — so nothing about it may be read as the
    // function being absent.
    await expect(callFunction(T.sources, thrower, client)).resolves.toEqual(thrown);
  });

  it("turns an unset credential name into an error result, not a crash", async () => {
    // No client passed, so the read resolves one itself — inside the same try
    // that classifies. This is the deploy-time case the ground rules name:
    // every push to main must leave the app renderable.
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    try {
      const result = await readRows(T.sources, (db) => db.from(T.sources).select("*"));
      expect(result.kind).toBe("error");
      expect(result).toMatchObject({ message: expect.stringContaining("SUPABASE_URL") });
      // The close slot's own seam resolves an unset name the same way. It must
      // not become "the resolver function is not installed": the app never
      // reached a database at all, and M2's absence card is a claim about
      // staging, not about this process's environment.
      const called = await callFunction(SETTLE_FUNCTION, (db) =>
        db.rpc(SETTLE_FUNCTION, { p_decision: {} }),
      );
      expect(called.kind).toBe("error");
      expect(called).not.toHaveProperty("missing");
      expect(called).toMatchObject({ message: expect.stringContaining("SUPABASE_URL") });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the fixture builders the suite reads through", () => {
  it("carries a review item in each of the three shapes", () => {
    const [dataConflict, entityLinkFact, sourcePattern] = reviewItemShapes();

    // A per-fact item names its fact and carries no source.
    expect(dataConflict.queue).toBe("data_conflict");
    expect(dataConflict.source_id).toBeNull();
    expect(dataConflict.domain).not.toBeNull();
    expect(entityLinkFact.queue).toBe("entity_link");
    expect(entityLinkFact.source_id).toBeNull();

    // The source-pattern item is the other subject shape: source set, the
    // other three null — the null shape the subject index compares.
    expect(sourcePattern.source_id).not.toBeNull();
    expect(sourcePattern.domain).toBeNull();
    expect(sourcePattern.entity_id).toBeNull();
    expect(sourcePattern.field).toBeNull();
  });

  it("carries a pending claim in every bucket, in_window included", () => {
    const claims = pendingClaimsInEveryBucket();
    expect(claims.map((claim) => claim.bucket)).toEqual([...PENDING_CLAIM_BUCKETS]);
    // Only awaiting_row names an unmet requirement; a bare awaiting_row is a
    // defect and every other bucket carries null.
    for (const claim of claims) {
      expect(claim.unmet_requirement === null).toBe(claim.bucket !== "awaiting_row");
    }
  });

  it("carries a cycle, a run, a source, an observation and a provenance row", () => {
    expect(resolutionRunRow().outcome).toBe("succeeded");
    // runs.source is text with no foreign key: it matches sources.source by name.
    expect(runRow().source).toBe(sourceRow().source);
    expect(observationRow().source_id).toBe(sourceRow().source_id);
    // `field_provenance` spells the canonical table entity_type; `observations`
    // and `review_items` spell the same thing domain, and the values agree —
    // `observations.entity_type` was dropped by scraper migration
    // `20260819000002` (admin-window/BUG-0024).
    expect(fieldProvenanceRow().entity_type).toBe(observationRow().domain);
    expect(reviewItemShapes()[0].domain).toBe(observationRow().domain);
  });
});

/**
 * Compile-time only: proves the read seam accepts a REAL supabase-js query
 * builder, so a page ticket coding against this contract type-checks.
 * `tsc --noEmit` is the assertion; the runtime check just keeps it referenced.
 */
async function acceptsARealQueryBuilder(
  db: SupabaseClient,
): Promise<DbResult<{ source_id: string }[]>> {
  return readRows<{ source_id: string }>(
    T.sources,
    (client) => client.from(T.sources).select("source_id"),
    db,
  );
}

it("types the read seam against the real client", () => {
  expect(typeof acceptsARealQueryBuilder).toBe("function");
});

/* ── readRowsByIds: the bounded, concurrent fan-out (admin-window/TASK-0062) ── */

/**
 * `readRowsByIds` issues its chunks as BATCHES of at most `CHUNK_FANOUT`,
 * batches in chunk-index order. What that must not change is every refusal
 * guarantee it already made, so the properties below grade the two halves
 * together: the clock moved, nothing the function SAYS did.
 *
 * Three of the six properties are graded elsewhere and stay there rather than
 * being retyped here (LESSONS 5): an empty id set issuing ZERO round trips and
 * an erroring chunk returning the first non-`ok` unchanged are
 * `tests/offline/gauges/gauge.test.ts`'s `readRowsByIds` block (which reads
 * through the `lib/db/gauges` re-export, the spelling every caller still
 * uses), and a missing table reaching the PAGE as `not_provisioned` naming
 * that table is `tests/offline/absence/pages.test.ts`. The three below are the
 * ones concurrency can break and a fixed stub cannot see: ORDER, WHICH
 * refusal, and the bound itself.
 *
 * The seam is a hand-built `run` rather than `stubClient`, because the stub
 * settles synchronously — a request that is never in flight cannot show a
 * fan-out. Here the test decides when each chunk settles, so every assertion
 * below is deterministic rather than timing-dependent.
 */

interface TaggedRow {
  source_id: string;
}

/** A promise the TEST settles, at the moment of its choosing. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Let every already-settled microtask run before the next assertion. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
}

/** Ids spanning exactly `chunks` full chunks, in the id set's own order. */
function idsSpanning(chunks: number): string[] {
  return Array.from({ length: chunks * ID_CHUNK }, (_, index) => `id-${index}`);
}

/** The chunk's index, read back out of the ids the fan-out handed the seam. */
function chunkIndexOf(chunkIds: string[]): number {
  return Math.floor(Number(chunkIds[0].slice("id-".length)) / ID_CHUNK);
}

/** One chunk's answer: the row tagged with the chunk that returned it. */
function rowsFor(index: number): DbResponse<TaggedRow[]> {
  return { data: [{ source_id: `row-${index}` }], error: null };
}

/** A refusal from one chunk, carrying the database's own error object. */
function refusalFrom(error: unknown): DbResponse<TaggedRow[]> {
  return { data: null, error };
}

interface ChunkSeam {
  /** The `run` callback handed to `readRowsByIds`. */
  run: (db: SupabaseClient, chunkIds: string[]) => PromiseLike<DbResponse<TaggedRow[]>>;
  /** Chunk indexes in the order the fan-out ISSUED them. */
  readonly issued: number[];
  /** Chunk indexes in the order they SETTLED. */
  readonly settled: number[];
  /** The most requests observed in flight at any one moment. */
  maxInFlight(): number;
  /** Settle one chunk's request — whether or not it has been issued yet. */
  settle(index: number, response: DbResponse<TaggedRow[]>): void;
}

function chunkSeam(): ChunkSeam {
  const slots = new Map<number, ReturnType<typeof deferred<DbResponse<TaggedRow[]>>>>();
  const issued: number[] = [];
  const settled: number[] = [];
  let inFlight = 0;
  let peak = 0;

  const slotFor = (index: number) => {
    const held = slots.get(index);
    if (held !== undefined) return held;
    const fresh = deferred<DbResponse<TaggedRow[]>>();
    slots.set(index, fresh);
    return fresh;
  };

  return {
    issued,
    settled,
    maxInFlight: () => peak,
    settle(index, response) {
      slotFor(index).resolve(response);
    },
    run(_db, chunkIds) {
      const index = chunkIndexOf(chunkIds);
      issued.push(index);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return slotFor(index).promise.then((response) => {
        inFlight -= 1;
        settled.push(index);
        return response;
      });
    },
  };
}

/** A client the seam never reads — `readRows` only needs one to exist. */
const unusedClient = () => stubClient({}).asSupabaseClient();

describe("readRowsByIds fans out over its chunks, bounded", () => {
  it("issues at most CHUNK_FANOUT at once and at least two at once — a sequential implementation fails this test", async () => {
    const seam = chunkSeam();
    const chunks = CHUNK_FANOUT + 2;
    const pending = readRowsByIds<TaggedRow>(
      T.sources,
      idsSpanning(chunks),
      seam.run,
      unusedClient(),
    );
    await flush();

    // The first batch is in flight together — this is the assertion a
    // one-at-a-time loop cannot pass: it would have issued exactly [0].
    expect(seam.issued).toEqual([0, 1, 2, 3]);
    expect(seam.maxInFlight()).toBeGreaterThanOrEqual(2);
    expect(seam.maxInFlight()).toBeLessThanOrEqual(CHUNK_FANOUT);

    // …and the batch AFTER it is not issued until this one is done, so the
    // bound holds across the whole read, not just at its start.
    for (let index = 0; index < CHUNK_FANOUT; index += 1) {
      seam.settle(index, rowsFor(index));
    }
    await flush();
    expect(seam.issued).toEqual([0, 1, 2, 3, 4, 5]);

    for (let index = CHUNK_FANOUT; index < chunks; index += 1) {
      seam.settle(index, rowsFor(index));
    }
    const result = await pending;
    expect(seam.maxInFlight()).toBeLessThanOrEqual(CHUNK_FANOUT);
    expect(result).toEqual({
      kind: "ok",
      data: Array.from({ length: chunks }, (_, index) => ({
        source_id: `row-${index}`,
      })),
    });
  });

  it("concatenates in chunk-index order, not completion order", async () => {
    const seam = chunkSeam();
    const pending = readRowsByIds<TaggedRow>(
      T.sources,
      idsSpanning(3),
      seam.run,
      unusedClient(),
    );
    await flush();

    // Chunk 2 answers first, chunk 0 last — the completion order is the
    // reverse of the id set's order.
    for (const index of [2, 1, 0]) {
      seam.settle(index, rowsFor(index));
      await flush();
    }
    const result = await pending;

    expect(seam.settled).toEqual([2, 1, 0]);
    expect(result).toEqual({
      kind: "ok",
      data: [{ source_id: "row-0" }, { source_id: "row-1" }, { source_id: "row-2" }],
    });
  });

  it("returns the LOWEST-INDEX non-ok, not whichever chunk failed first", async () => {
    const seam = chunkSeam();
    const pending = readRowsByIds<TaggedRow>(
      T.sources,
      idsSpanning(3),
      seam.run,
      unusedClient(),
    );
    await flush();

    // The later chunk fails FIRST, with a different refusal, so a fan-out that
    // took whichever rejected soonest would answer with chunk 2's error.
    seam.settle(2, refusalFrom(permissionDenied(T.sources)));
    await flush();
    seam.settle(1, refusalFrom(tableNotInSchemaCache(T.sources)));
    await flush();
    seam.settle(0, rowsFor(0));
    const result = await pending;

    expect(seam.settled).toEqual([2, 1, 0]);
    // Chunk 1's absence, unchanged — and no half-filled `ok` carrying chunk 0.
    expect(result).toEqual({ kind: "not_provisioned", missing: T.sources });
  });

  it("issues no further batch once a refusal is known", async () => {
    const seam = chunkSeam();
    const chunks = CHUNK_FANOUT + 2;
    const pending = readRowsByIds<TaggedRow>(
      T.sources,
      idsSpanning(chunks),
      seam.run,
      unusedClient(),
    );
    await flush();

    seam.settle(0, refusalFrom(tableNotInSchemaCache(T.sources)));
    for (let index = 1; index < CHUNK_FANOUT; index += 1) {
      seam.settle(index, rowsFor(index));
    }
    const result = await pending;
    await flush();

    expect(result).toEqual({ kind: "not_provisioned", missing: T.sources });
    // Strictly fewer requests than there are chunks: the second batch was
    // never started.
    expect(seam.issued.length).toBeLessThan(chunks);
    expect(seam.issued).toEqual([0, 1, 2, 3]);
  });

  it("bounds the fan-out at a number a database can serve", () => {
    // A bound of 1 is the sequential loop under another name; an unbounded
    // fan-out is what §4.2 forbids. Both ends are asserted, not the middle.
    expect(CHUNK_FANOUT).toBeGreaterThan(1);
    expect(CHUNK_FANOUT).toBeLessThanOrEqual(8);
  });
});

/**
 * The fan-out's refusal guarantees ACROSS a batch boundary (QA, TASK-0062).
 *
 * The block above grades order, which refusal, and the bound — all inside the
 * FIRST batch. FEAT-0014 names the one way this change can be wrong as
 * "concurrency turning a refusal into a partial answer", and the batch
 * boundary is where that would happen: batch 0 has already collected rows into
 * `collected` when batch 1 refuses. Nothing pinned that the collected rows are
 * discarded, nor that a chunk whose REQUEST rejects cannot take the whole
 * `Promise.all` down as a rejection escaping into a page (ARCHITECTURE §4.1:
 * a read never throws).
 */
describe("readRowsByIds keeps its refusal guarantees across a batch boundary", () => {
  it("discards rows an earlier batch collected when a LATER batch refuses", async () => {
    const seam = chunkSeam();
    const pending = readRowsByIds<TaggedRow>(
      T.sources,
      idsSpanning(CHUNK_FANOUT + 2),
      seam.run,
      unusedClient(),
    );
    await flush();

    // Batch 0 answers in full: four chunks of rows are now in `collected`.
    for (let index = 0; index < CHUNK_FANOUT; index += 1) {
      seam.settle(index, rowsFor(index));
    }
    await flush();
    expect(seam.issued).toEqual([0, 1, 2, 3, 4, 5]);

    // Batch 1 refuses. The four chunks already collected must not come back.
    seam.settle(CHUNK_FANOUT, refusalFrom(tableNotInSchemaCache(T.sources)));
    seam.settle(CHUNK_FANOUT + 1, rowsFor(CHUNK_FANOUT + 1));

    expect(await pending).toEqual({ kind: "not_provisioned", missing: T.sources });
  });

  it("returns the earlier BATCH's refusal when two batches each hold one", async () => {
    const seam = chunkSeam();
    const pending = readRowsByIds<TaggedRow>(
      T.sources,
      idsSpanning(CHUNK_FANOUT + 2),
      seam.run,
      unusedClient(),
    );
    await flush();

    seam.settle(1, refusalFrom(permissionDenied(T.sources)));
    for (const index of [0, 2, 3]) seam.settle(index, rowsFor(index));
    const result = await pending;

    // Batch 1 was never issued, so its refusal could not have been chosen.
    expect(seam.issued).toEqual([0, 1, 2, 3]);
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.reading).toBe(T.sources);
  });

  it("classifies a chunk whose request REJECTS instead of rejecting the fan-out", async () => {
    const issued: number[] = [];
    const result = await readRowsByIds<TaggedRow>(
      T.sources,
      idsSpanning(CHUNK_FANOUT + 2),
      (_db, chunkIds) => {
        const index = chunkIndexOf(chunkIds);
        issued.push(index);
        if (index === 2) {
          return Promise.reject(
            Object.assign(new Error("connection reset"), { code: "XX000" }),
          );
        }
        return Promise.resolve(rowsFor(index));
      },
      unusedClient(),
    );

    // A rejection inside `Promise.all` would have escaped as a thrown promise;
    // it must arrive as this module's own error result instead.
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.reading).toBe(T.sources);
    expect(issued).toEqual([0, 1, 2, 3]);
  });

  it("classifies a chunk whose run THROWS synchronously inside a batch", async () => {
    const result = await readRowsByIds<TaggedRow>(
      T.sources,
      idsSpanning(CHUNK_FANOUT + 2),
      (_db, chunkIds) => {
        if (chunkIndexOf(chunkIds) === 1) throw new Error("built a bad query");
        return Promise.resolve(rowsFor(chunkIndexOf(chunkIds)));
      },
      unusedClient(),
    );
    expect(result.kind).toBe("error");
  });
});
