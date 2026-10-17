import * as cheerio from "cheerio";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ANY_COLUMNS,
  CHUNK_FANOUT,
  ID_CHUNK,
  ROW_CAP,
  callFunction,
  classify,
  countRead,
  readComplete,
  readCount,
  readOne,
  readRows,
  readRowsByIds,
  selectList,
  type AskedObject,
  type DbResponse,
  type DbResult,
  type RowColumns,
} from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import type { AccountSegment, ReasonAuthor } from "@/lib/account/authored";
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
  undefinedFunction,
  undefinedQualifiedColumn,
  undefinedTable,
  type ScriptedResponse,
} from "../../fixtures/stub-client";
import { StateOf } from "@/components/ui/state-of";
import { h, render } from "../ui/markup";
import { reviewItemShapes } from "../../fixtures/rows";

/**
 * Acceptance test 9's offline half (campaign admin-window): absence is
 * classified by code, everything else surfaces the database's own words, and
 * no exported read throws for any of it.
 */

/**
 * Fragments of this app's note to its OWN DEVELOPER, which no refusal an
 * operator can reach may carry (campaign admin-window/BUG-0224 criterion 2).
 *
 * They describe the arguments of a call site in this repo, so they answer
 * nothing an operator can act on — and two of them really did reach /claims
 * and /queues, beside an empty card, the day a host answered 404 with zero
 * bytes. The same absence is asserted over the rendered HTML by
 * `tests/http/absence.http.test.ts`; this is its unit-level twin, at the seam
 * that used to compose them.
 */
const CALL_SITE_PROSE = [
  "count read requires",
  "complete read requires",
  'count: "exact"',
] as const;

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

  /**
   * A column-absent envelope is not necessarily the DATABASE'S: postgrest-js
   * hands the parsed body back as the error object for any non-2xx, so an
   * intermediary can author `code` and `message` both — and the column half of
   * `missing` is mined out of that message. `missing` is an object name the
   * app renders in its own sentence (the records and settle routes inline it
   * into `"<missing> is not present in this database"`), so a mined column is
   * admitted only when it matches the app's object grammar; otherwise the
   * verdict names the table the query asked for
   * (campaign admin-window/BUG-0181, the architect's four measured envelopes).
   */
  const FOREIGN_COLUMN_ABSENT_ENVELOPES: ReadonlyArray<[string, unknown, string]> = [
    [
      "a quoted fragment that closes the quote and keeps going",
      {
        code: "42703",
        message: `column 'severity" OR 1=1 --  <script>alert(1)</script> ' does not exist`,
      },
      `severity" OR 1=1`,
    ],
    [
      "a quoted run in a refusal that never says 'column' at all",
      {
        code: "PGRST204",
        message:
          'Access denied by policy "your request was blocked; contact support@evil.example for reference 8f3c1"',
      },
      "for reference 8f3c1",
    ],
    [
      "a whole document between the quotes",
      {
        code: "42703",
        message:
          'blocked "<!DOCTYPE html><html><head><title>Attention Required!</title></head></html>"',
      },
      "Attention Required!",
    ],
    [
      "an unterminated right-to-left override inside the value",
      { code: "42703", message: 'column "‮gnitset" does not exist' },
      "‮",
    ],
  ];

  it("spells a column only when the message named one this app could have named", () => {
    // MUST NOT ADMIT: four envelopes whose quoted run is an intermediary's own
    // text. Each stays an absence naming the object the QUERY asked for, and
    // carries no character of that text.
    for (const [shape, error, foreign] of FOREIGN_COLUMN_ABSENT_ENVELOPES) {
      const result = classify(error, T.reviewItems);
      expect(result, shape).toEqual({
        kind: "not_provisioned",
        missing: T.reviewItems,
      });
      const named = (result as { missing: string }).missing;
      expect(named, shape).not.toContain(foreign);
      // Whatever it names is an object name: a table, or a table qualified by
      // one column, in the grammar this app spells itself.
      expect(named, shape).toMatch(/^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?$/);
    }

    // MUST ADMIT (the twin, LESSONS 8): the four spellings a real
    // Postgres/PostgREST column-absent message uses still qualify, byte for
    // byte, qualifier dropped.
    const HONEST: ReadonlyArray<[unknown, string, string]> = [
      [
        {
          code: "PGRST204",
          message: `Could not find the 'severity' column of 'review_items' in the schema cache`,
        },
        T.reviewItems,
        `${T.reviewItems}.severity`,
      ],
      [
        { code: "42703", message: 'column "severity" does not exist' },
        T.reviewItems,
        `${T.reviewItems}.severity`,
      ],
      [
        {
          code: "42703",
          message: 'column "severity" of relation "review_items" does not exist',
        },
        T.reviewItems,
        `${T.reviewItems}.severity`,
      ],
      [
        { code: "42703", message: "column events.badcol does not exist" },
        T.events,
        `${T.events}.badcol`,
      ],
    ];
    for (const [error, asked, named] of HONEST) {
      expect(classify(error, asked), named).toEqual({
        kind: "not_provisioned",
        missing: named,
      });
    }
  });

  it("asks the operator exception of the database's words too, not the app's", () => {
    // The file's other CLASSIFICATION read of a message moved with the one
    // above, because it is the same question: what the DATABASE said about
    // what is missing (admin-window/BUG-0185, criterion 3). A message the
    // database did not author tests nothing and makes no operator claim.
    const SILENT: ReadonlyArray<[string, unknown]> = [
      ["no message field at all", { code: "42883" }],
      ["a null message", { code: "42883", message: null }],
      [
        "an operator sentence the app would have to serialise to see",
        { code: "42883", message: { text: "operator does not exist: text <-> integer" } },
      ],
    ];
    for (const [shape, error] of SILENT) {
      // "A 42883 that says nothing at all is still an absent function to a
      // caller that asked for one" — src/lib/db/result.ts's own standing rule.
      expect(classify(error, SETTLE_FUNCTION, "function"), shape).toEqual({
        kind: "not_provisioned",
        missing: SETTLE_FUNCTION,
      });
    }

    // MUST FLAG (the twin, LESSONS 8): the honest operator message on the
    // same read still refuses the absence.
    expect(classify(missingOperator(), SETTLE_FUNCTION, "function").kind).toBe("error");
  });

  /**
   * The same rule where the envelope actually COMES FROM, rather than where a
   * fixture hands it over: the real `@supabase/supabase-js` client over a
   * stubbed transport, whose 400 body is the whole error object postgrest-js
   * gives back — no `message` key is required of it, which is what made the
   * fabricated column reachable end to end (admin-window/BUG-0185). Every
   * other case in this file hands `classify` an error directly, so nothing
   * else here proves the shape a real client produces is the shape the rule
   * was written for. No network: `fetch` is stubbed, the host is `.invalid`.
   */
  it("takes no column out of a message-less 400 body a real client parsed", async () => {
    const answering = (body: unknown): SupabaseClient =>
      createClient("https://stub.invalid", "stub-key", {
        auth: { persistSession: false },
        global: {
          fetch: async () =>
            new Response(JSON.stringify(body), {
              status: 400,
              headers: { "content-type": "application/json" },
            }),
        },
      }) as unknown as SupabaseClient;

    // MUST NOT ADMIT: the field names are the BODY AUTHOR's, and their order
    // is too — neither may become the column half of `missing`.
    for (const [shape, body] of [
      ["no message field at all", { code: "42703" }],
      ["a null message", { code: "42703", message: null }],
      ["a foreign field name ahead of the code", { contact_support_at_evil_example: 1, code: "42703" }],
      ["a message that is itself an object", { code: "42703", message: { text: 'column "severity" does not exist' } }],
      ["an empty message the database really authored", { code: "42703", message: "" }],
      ["a schema-cache code with no message", { code: "PGRST204" }],
    ] as ReadonlyArray<[string, unknown]>) {
      expect(
        await readRows(T.reviewItems, ["id"], (db) => db.from(T.reviewItems).select("id"), answering(body)),
        shape,
      ).toEqual({ kind: "not_provisioned", missing: T.reviewItems });
    }

    // MUST ADMIT (the twin): the same transport carrying a message the
    // database really wrote still names its column.
    expect(
      await readRows(
        T.reviewItems,
        ["id"],
        (db) => db.from(T.reviewItems).select("id"),
        answering({ code: "42703", message: 'column "severity" does not exist' }),
      ),
    ).toEqual({ kind: "not_provisioned", missing: `${T.reviewItems}.severity` });

    // And the function arm over the same transport: a silent 42883 is still
    // the absent function, an honest operator sentence is still an error.
    expect(
      await callFunction(SETTLE_FUNCTION, (db) => db.rpc(SETTLE_FUNCTION, {}), answering({ code: "42883" })),
    ).toEqual({ kind: "not_provisioned", missing: SETTLE_FUNCTION });
    expect(
      (
        await callFunction(
          SETTLE_FUNCTION,
          (db) => db.rpc(SETTLE_FUNCTION, {}),
          answering({ code: "42883", message: "operator does not exist: timestamp with time zone ~~* unknown" }),
        )
      ).kind,
    ).toBe("error");
  });

  it("carries the message of a thrown Error, a thrown string, and a bare object", () => {
    expect(classify(new Error("fetch failed"), T.runs)).toEqual({
      kind: "error",
      reading: T.runs,
      message: "fetch failed",
      authored: [{ words: "fetch failed", author: "the machine" }],
    });
    expect(classify("socket hang up", T.runs)).toEqual({
      kind: "error",
      reading: T.runs,
      message: "socket hang up",
      authored: [{ words: "socket hang up", author: "the machine" }],
    });
    // No message anywhere: still an error, still never an invented sentence.
    expect(classify({ status: 503 }, T.runs).kind).toBe("error");
  });

  /* ── the absent FUNCTION (campaign admin-window/TASK-0047) ─────────────── */

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
  it("does not read an EMPTY code as a code, or print one", () => {
    // The transport failure comes back with code "" and hint "". Neither is
    // information, and "" is not an absence code.
    const result = classify(transportFailure(), T.events);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).not.toContain("()");
    expect(result.message.trim()).toBe(result.message);
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

  const HANGUL_DUPLICATE = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "groups_name_key"',
    details: "Key (name)=(르세라핌) already exists.",
    hint: null,
  };
  const OPERATOR_MESSAGE = "operator does not exist: text <-> integer";
  const CLOUDFLARE_WITH_A_KEY =
    `<!DOCTYPE html>\n<html><body>apikey=${jwtShaped}</body></html>`;

  /**
   * The clause the app says INSTEAD of a document, discovered FROM the app
   * rather than retyped here.
   *
   * Nothing below pins `documentInstead`'s wording. The whole-part arm counts
   * a part that IS a document at the length it arrived with, so classifying
   * one page yields exactly the clause every other arm owes the same bytes.
   */
  const documentClause = (document: string): string => {
    const counted = classify({ message: document }, T.pendingClaims);
    if (counted.kind !== "error") throw new Error("a document part is an error");
    return counted.message;
  };

  /**
   * Everything the clause says APART from its number: the shared tail of two
   * clauses whose documents differ in length. Counting occurrences of THIS
   * counts the documents an account says it counted, without this file
   * knowing one word of them.
   */
  const CLAUSE_WORDS = ((short: string, long: string) => {
    let shared = 0;
    while (
      shared < short.length &&
      short[short.length - 1 - shared] === long[long.length - 1 - shared]
    ) {
      shared += 1;
    }
    return short.slice(short.length - shared);
  })(documentClause("<x>"), documentClause("<xx>"));

  /** How many documents an account says it counted. */
  const clausesIn = (account: string): number =>
    account.split(CLAUSE_WORDS).length - 1;

  /**
   * What an operator actually READS off the rendered card — the account
   * through `StateOf` -> `ErrorLine`, with its entities decoded, so an
   * escaped leak (`&lt;html&gt;`) cannot hide from an assertion about `<`.
   */
  const cardTextOf = (result: {
    kind: "error";
    reading: string;
    message: string;
  }): string =>
    cheerio.load(render(h(StateOf, { result })))('[data-state="error"]').text();

  it("the clause counter finds the app's own clause, and nothing else", () => {
    // The counter the table below grades with is not vacuous (LESSONS 8).
    expect(CLAUSE_WORDS.length).toBeGreaterThan(10);
    expect(clausesIn(documentClause("<x>"))).toBe(1);
    expect(clausesIn("the read was refused with no words to explain it")).toBe(0);
  });

  /* ── the parts the chain measured, as the client delivered them ────────── */

  /** The Cloudflare doctype page QA measured against staging (BUG-0170). */
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
  /** The measured page was 4,547 characters (staging, 2026-09-10). */
  const measured = cloudflare.padEnd(4547, "x");

  /** A whole document as one part, beside nothing. */
  const alone = (page: string) => ({ code: "", hint: "", details: "", message: page });
  /** A part in `details`, beside the client's own line. */
  const inDetails = (part: string) => ({
    code: "",
    details: part,
    hint: "",
    message: "read failed",
  });
  /** The same part one line below the client's own prose. */
  const belowProse = (document: string): string => `reference 8f3c1\n${document}`;

  /** A one-line intermediary page, frameless and framed. */
  const gatewayPage = "<html><body>504 Gateway Time-out</body></html>";
  const gatewayFramed = `upstream said:\n${gatewayPage}\n    at Object.parse (${POSTGREST}:41:11)`;

  /** The shape a WAF actually serves: an interstitial, pretty-printed. */
  const wafInterstitial = [
    "<!DOCTYPE html>",
    '<html lang="en-US">',
    "<head>",
    "<title>Attention Required!</title>",
    '<meta charset="UTF-8" />',
    '<meta name="robots" content="noindex, nofollow" />',
    '<link rel="stylesheet" href="/cdn-cgi/styles/cf.errors.css" />',
    "</head>",
    "<body>",
    '<div id="cf-wrapper">',
    '<div id="cf-error-details" class="cf-error-details-wrapper">',
    "<h1>Sorry, you have been blocked</h1>",
    "<h2>You are unable to access this site</h2>",
    "</div>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
  const shortInterstitial = [
    "<!DOCTYPE html>",
    '<html lang="en-US">',
    "<head>",
    "<title>Attention Required!</title>",
    "</head>",
    "<body>",
    "<h1>Sorry, you have been blocked</h1>",
    "</body>",
    "</html>",
  ].join("\n");
  const fuller = [
    "<!DOCTYPE html>",
    '<html lang="en-US">',
    "<head>",
    "<title>Attention Required! | Cloudflare</title>",
    '<meta charset="UTF-8" />',
    '<meta http-equiv="X-UA-Compatible" content="IE=Edge" />',
    '<meta name="robots" content="noindex, nofollow" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    '<link rel="stylesheet" href="/cdn-cgi/styles/cf.errors.css" />',
    "</head>",
    "<body>",
    '<div id="cf-wrapper">',
    '<div id="cf-error-details" class="cf-error-details-wrapper">',
    "<h1>Sorry, you have been blocked</h1>",
    "<h2>You are unable to access this site</h2>",
    "<p>You can email the site owner to let them know you were blocked.</p>",
    '<p>Cloudflare Ray ID: <strong>8f3c1de4b7c90a13</strong></p>',
    "</div>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
  // Scale, and INDENTED: the run's own characters include the indentation
  // the document arrived with, so the number is the document's length and
  // not the sum of its trimmed lines.
  const wide = [
    "<!DOCTYPE html>",
    '<html lang="en-US">',
    "<body>",
    ...Array.from(
      { length: 395 },
      (_unused, row) => `  <div class="cf-row-${row}">request blocked</div>`,
    ),
    "</body>",
    "</html>",
  ].join("\n");
  const inCode = [
    "<!DOCTYPE html>",
    '<html lang="en-US">',
    "<body>",
    ...Array.from(
      { length: 195 },
      (_unused, row) => `  <p class="cf-note-${row}">request blocked</p>`,
    ),
    "</body>",
    "</html>",
  ].join("\n");
  // The `code` beside a real message, whose FIRST line is not markup, so a
  // whole-part question alone would pass over it (admin-window/BUG-0179).
  const codePart = `edge-cache-status: refused\n${inCode}`;

  /** A document whose OWN text is shaped like a V8 frame (BUG-0187). */
  const frameShaped = "at least one parameter is required (see docs)";
  const xmlFrameShaped = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Error>",
    "<Code>InvalidRequest</Code>",
    "<Message>",
    frameShaped,
    "</Message>",
    "</Error>",
  ].join("\n");

  /** A document with V8 frames APPENDED (BUG-0187). */
  const blockedPage = [
    "<!DOCTYPE html>",
    '<html lang="en-US">',
    "<body>",
    "<h1>Sorry, you have been blocked</h1>",
    "</body>",
    "</html>",
  ].join("\n");
  const appendedFrames = [
    `    at Object.parse (${POSTGREST}:41:11)`,
    `    at async readRows (${DEPLOY}/src/lib/db/result.ts:476:20)`,
  ].join("\n");
  const blockedWithFrames = `${blockedPage}\n${appendedFrames}`;

  /** Two documents in one part, the intermediary's own line between them. */
  const between = "reference 8f3c1 was refused at the edge";
  const twoDocuments = `upstream said:\n${shortInterstitial}\n${between}\n${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Error>",
    "<Code>AccessDenied</Code>",
    "<Message>Request blocked by the gateway</Message>",
    "</Error>",
  ].join("\n")}`;

  /** An interstitial whose TEXT NODES sit on lines of their own (BUG-0187). */
  const textNodes = [
    "<!DOCTYPE html>",
    '<html lang="en-US">',
    "<head>",
    "<title>Attention Required! | Cloudflare</title>",
    "</head>",
    "<body>",
    '<div id="cf-error-details">',
    "<h1>",
    "Sorry, you have been blocked",
    "</h1>",
    "<h2>",
    "You are unable to access this site",
    "</h2>",
    "<p>",
    "You can email the site owner to let them know you were blocked.",
    "</p>",
    "<p>Cloudflare Ray ID:</p>",
    "8f3c1de4b7c90a13",
    "<p>Your IP:</p>",
    "203.0.113.7",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
  /** Text only the INTERMEDIARY authored — none of it may reach a sentence. */
  const itsOwnText = [
    "Sorry, you have been blocked",
    "You are unable to access this site",
    "You can email the site owner to let them know you were blocked.",
    "8f3c1de4b7c90a13",
    "203.0.113.7",
  ];

  /** The `code` arm's shapes (BUG-0179): a document, a long bland code, a foreign envelope. */
  const DENIED = "permission denied for view pending_claims";
  const TIMEOUT = "canceling statement due to statement timeout";
  const longCode = "R".repeat(300);
  const documentCode = `<!DOCTYPE html>\n<html><body>${"x".repeat(600)}</body></html>`;
  const foreignCode = {
    success: false,
    ray: "8f3c1attack",
    code: `<!DOCTYPE html>\n<html><body>${"x".repeat(4400)}</body></html>`,
  };
  const blander = { blocked: true, code: longCode };
  const refusal = {
    code: "42501",
    message: DENIED,
    details: "the read used the anon role",
    hint: "GRANT SELECT ON pending_claims TO service_role.",
  };

  /** What one account must and must not say, graded off `classify`'s result. */
  interface AccountExpectation {
    /** The account, exactly. */
    readonly is?: string;
    /** Spellings the account must carry. */
    readonly carries?: readonly string[];
    /** Spellings it must never carry. */
    readonly never?: readonly string[];
    /** Patterns it must never match. */
    readonly neverMatch?: readonly RegExp[];
    /** Spellings said exactly once. */
    readonly once?: readonly string[];
    /** How many frames the app says went; 0 means no frames clause at all. */
    readonly frames?: number;
    /**
     * The PART that was foreign whole: ONE clause, the clause the app owes
     * those exact bytes, counted at the length the client delivered.
     */
    readonly countsWhole?: string;
    /** No clause counts anything. */
    readonly countsNothing?: boolean;
    /** No non-blank line of this text crosses. */
    readonly noLineOf?: string;
    /** Spellings that appear in this order. */
    readonly inOrder?: readonly string[];
    readonly endsWith?: string;
    /** The account is shorter than this many characters. */
    readonly shorterThan?: number;
    /** The number the app's clause is written around: a sentence, not a bare count. */
    readonly sentenceAround?: string;
    /** Also graded off the rendered card, entities decoded. */
    readonly onCard?: boolean;
  }

  /**
   * THE PART IS THE UNIT (ARCHITECTURE.md §4.1; admin-window/BUG-0170,
   * BUG-0173, BUG-0179, BUG-0182, BUG-0187) — one table over every shape the
   * chain measured, graded by the one bar: a part carrying a document
   * ANYWHERE is foreign as a WHOLE and is replaced by one clause counted at
   * the length the client delivered it; a part this app had to serialise is
   * counted and never quoted; runtime frames are dropped and counted;
   * everything else crosses verbatim, in order, the code last in parentheses.
   * The rows that must NOT be touched are the guard against a greedy reading
   * of any of that (LESSONS 8).
   */
  const ACCOUNT_FIXTURES: ReadonlyArray<readonly [string, unknown, AccountExpectation]> = [
    // ── frames dropped and counted; the cause crosses ──
    [
      "a runtime stack quoting a document it could not parse",
      notJsonBody,
      {
        carries: [NOT_JSON],
        never: ["node_modules", "src/lib/db", DEPLOY, "node:internal", "JSON.parse"],
        frames: 8,
        shorterThan: 200,
      },
    ],
    [
      "the measured transport failure, frames and all",
      dnsFailure,
      {
        carries: ["fetch failed", "getaddrinfo ENOTFOUND db.invalid"],
        never: ["node:dns:", "GetAddrInfoReqWrap"],
        once: ["TypeError: fetch failed"],
        frames: 1,
      },
    ],
    // ── a part this app had to serialise: counted, nothing of it quoted ──
    [
      "an intermediary's JSON envelope with no message of its own",
      envelope,
      {
        carries: ["114"],
        never: [
          "success",
          "errors",
          "ray",
          "message",
          "prohibited",
          "10015",
          envelope.ray,
          "false",
          "{",
        ],
        sentenceAround: "114",
      },
    ],
    [
      "an envelope nesting a document one quote deep",
      nestedDocument,
      {
        carries: [String(JSON.stringify(nestedDocument).length)],
        never: ["<", "nope", "html"],
      },
    ],
    [
      "a serialised body that hid a credential",
      { status: 403, detail: `apikey=${jwtShaped}` },
      { never: [jwtShaped, "apikey"] },
    ],
    [
      "a foreign code trailing a serialised envelope (admin-window/BUG-0179)",
      foreignCode,
      {
        carries: [String(JSON.stringify(foreignCode).length)],
        never: ["<!DOCTYPE", "success", "ray", "8f3c1attack", "false", "{"],
        neverMatch: [/<\/?html[\s>]/],
        shorterThan: 400,
      },
    ],
    [
      "QA's blander envelope, a 300-character code beside a flag",
      blander,
      {
        carries: [String(JSON.stringify(blander).length)],
        never: ["RRR", "blocked"],
        shorterThan: 400,
      },
    ],
    // ── a document as the whole part (admin-window/BUG-0170) ──
    [
      "the Cloudflare doctype page measured against staging",
      alone(cloudflare),
      {
        countsWhole: cloudflare,
        never: ["Attention Required", "Cloudflare", "no-js", "charset", "<"],
        neverMatch: [/<!DOCTYPE/i, /<\/?html[\s>]/i],
        sentenceAround: String(cloudflare.length),
      },
    ],
    [
      "an nginx 502 with no doctype",
      alone(nginx),
      {
        countsWhole: nginx,
        never: ["502 Bad Gateway", "nginx", "center", "<"],
        neverMatch: [/<!DOCTYPE/i, /<\/?html[\s>]/i],
        sentenceAround: String(nginx.length),
      },
    ],
    [
      "an XML error envelope, leading newline and indentation included",
      alone(xmlEnvelope),
      {
        countsWhole: xmlEnvelope,
        never: ["AccessDenied", "Request blocked", "encoding", "<"],
        neverMatch: [/<!DOCTYPE/i, /<\/?html[\s>]/i],
        sentenceAround: String(xmlEnvelope.length),
      },
    ],
    [
      "the measured page, padded to 4,547 characters",
      { code: "", message: measured },
      { carries: ["4547"] },
    ],
    [
      "an intermediary's document carrying a key (admin-window/BUG-0170)",
      { code: "", message: CLOUDFLARE_WITH_A_KEY },
      {
        carries: [String(CLOUDFLARE_WITH_A_KEY.length)],
        never: ["<!DOCTYPE", jwtShaped, "apikey"],
      },
    ],
    [
      "a pretty-printed interstitial as the whole part",
      inDetails(shortInterstitial),
      {
        carries: ["read failed"],
        never: ["<"],
        countsWhole: shortInterstitial,
        shorterThan: shortInterstitial.length,
      },
    ],
    [
      "a document whose text sits on its own lines, as the whole part (admin-window/BUG-0187)",
      { message: textNodes },
      { countsWhole: textNodes, never: itsOwnText },
    ],
    // ── the code asked the same questions as every other part (BUG-0179) ──
    [
      "a document in the code beside a real database message",
      { code: documentCode, message: DENIED },
      {
        carries: [DENIED, String(documentCode.length)],
        never: ["<"],
        neverMatch: [/<!DOCTYPE/i, /<\/?html[\s>]/],
        shorterThan: 400,
      },
    ],
    [
      "a 200-line document in the code beside a real message",
      { code: codePart, message: DENIED },
      {
        never: ["edge-cache-status: refused", "<", "DOCTYPE", "html", "div"],
        countsWhole: codePart,
        shorterThan: codePart.length,
        noLineOf: codePart,
        onCard: true,
      },
    ],
    // ── a document on ANY line of a part: the whole part is foreign ──
    [
      "a frameless document one line below the client's prose",
      inDetails(belowProse(gatewayPage)),
      {
        carries: ["read failed"],
        never: ["reference 8f3c1", "<", "Gateway Time-out"],
        countsWhole: belowProse(gatewayPage),
        frames: 0,
      },
    ],
    [
      "a document with a frame appended, below the client's prose",
      inDetails(gatewayFramed),
      {
        never: ["upstream said:", "<", "Gateway Time-out"],
        countsWhole: gatewayFramed,
        frames: 0,
      },
    ],
    [
      "a 17-line interstitial below the client's prose (admin-window/BUG-0182)",
      inDetails(belowProse(wafInterstitial)),
      {
        carries: ["read failed"],
        never: ["reference 8f3c1", "<", "Sorry, you have been blocked", "DOCTYPE", "html", "div"],
        countsWhole: belowProse(wafInterstitial),
        shorterThan: belowProse(wafInterstitial).length,
        noLineOf: belowProse(wafInterstitial),
        onCard: true,
      },
    ],
    [
      "a fuller interstitial below the client's prose",
      inDetails(belowProse(fuller)),
      {
        never: ["reference 8f3c1", "<", "DOCTYPE", "html", "div"],
        countsWhole: belowProse(fuller),
        shorterThan: belowProse(fuller).length,
        noLineOf: belowProse(fuller),
        onCard: true,
      },
    ],
    [
      "a 400-line indented interstitial below the client's prose",
      inDetails(belowProse(wide)),
      {
        never: ["reference 8f3c1", "<", "DOCTYPE", "html", "div"],
        countsWhole: belowProse(wide),
        shorterThan: belowProse(wide).length,
        noLineOf: belowProse(wide),
        onCard: true,
      },
    ],
    [
      "a document whose own text is frame-shaped, as the whole part (admin-window/BUG-0187)",
      inDetails(xmlFrameShaped),
      {
        countsWhole: xmlFrameShaped,
        frames: 0,
        never: ["<", frameShaped],
        noLineOf: xmlFrameShaped,
        onCard: true,
      },
    ],
    [
      "a document whose own text is frame-shaped, below the client's prose",
      inDetails(`upstream refused:\n${xmlFrameShaped}`),
      {
        countsWhole: `upstream refused:\n${xmlFrameShaped}`,
        frames: 0,
        never: ["<", frameShaped],
        noLineOf: `upstream refused:\n${xmlFrameShaped}`,
        onCard: true,
      },
    ],
    [
      "a six-line page as the whole part (admin-window/BUG-0187)",
      inDetails(blockedPage),
      {
        carries: ["read failed"],
        countsWhole: blockedPage,
        frames: 0,
        never: ["<", "Sorry, you have been blocked", "node_modules", DEPLOY, "upstream said:"],
        onCard: true,
      },
    ],
    [
      "the same page with frames appended, counted at the whole part's length",
      inDetails(blockedWithFrames),
      {
        carries: ["read failed"],
        countsWhole: blockedWithFrames,
        frames: 0,
        // The number counts the part as delivered, frames included — the
        // document alone is shorter than the part that carried it and its stack.
        never: [
          "<",
          "Sorry, you have been blocked",
          "node_modules",
          DEPLOY,
          "upstream said:",
          String(blockedPage.length),
        ],
        onCard: true,
      },
    ],
    [
      "the same page with frames appended, below the client's prose",
      inDetails(`upstream said:\n${blockedWithFrames}`),
      {
        carries: ["read failed"],
        countsWhole: `upstream said:\n${blockedWithFrames}`,
        frames: 0,
        never: ["<", "Sorry, you have been blocked", "node_modules", DEPLOY, "upstream said:"],
        onCard: true,
      },
    ],
    [
      "two documents in one part, the intermediary's line between them (admin-window/BUG-0187)",
      inDetails(twoDocuments),
      {
        carries: ["read failed"],
        countsWhole: twoDocuments,
        never: ["upstream said:", between, "<", "AccessDenied", "Sorry, you have been blocked"],
        shorterThan: twoDocuments.length,
        onCard: true,
      },
    ],
    [
      "a document whose text sits on its own lines, below the client's prose (admin-window/BUG-0187)",
      inDetails(belowProse(textNodes)),
      {
        carries: ["read failed"],
        never: ["reference 8f3c1", "<", ...itsOwnText],
        countsWhole: belowProse(textNodes),
        shorterThan: belowProse(textNodes).length,
        onCard: true,
      },
    ],
    // ── MUST NOT TOUCH: the database's own words cross verbatim ──
    [
      "a four-field PostgREST refusal",
      refusal,
      {
        carries: [refusal.message, refusal.details, refusal.hint, "(42501)"],
        inOrder: [refusal.message, refusal.details, refusal.hint],
        endsWith: "(42501)",
      },
    ],
    [
      "a 300-character code that answers no question",
      { code: longCode, message: TIMEOUT },
      { carries: [TIMEOUT, `(${longCode})`], endsWith: `(${longCode})` },
    ],
    [
      "an angle-bracket operator on a TABLE read, the bracket-scrub fixture",
      { code: "42883", details: null, hint: null, message: OPERATOR_MESSAGE },
      { carries: [OPERATOR_MESSAGE] },
    ],
    [
      "a duplicate key quoting a Hangul value",
      HANGUL_DUPLICATE,
      { carries: [HANGUL_DUPLICATE.message, HANGUL_DUPLICATE.details, "르세라핌"] },
    ],
    [
      "a database message whose indented line begins 'at ' and is no frame",
      indentedProse,
      {
        carries: [indentedProse.message, indentedProse.details],
        frames: 0,
        countsNothing: true,
        endsWith: "(23514)",
      },
    ],
    [
      "an app-thrown Error the launch diagnosis depends on",
      new Error("SUPABASE_URL is not set"),
      { is: "SUPABASE_URL is not set" },
    ],
  ];

  it.each(ACCOUNT_FIXTURES)("the part is the unit — %s", (label, error, expected) => {
    const result = classify(error, T.pendingClaims);
    expect(result.kind, label).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading, label).toBe(T.pendingClaims);
    const { message } = result;

    // COUNTED, NEVER QUOTED — on the DbResult and, where the chain measured
    // it, on the rendered card read back with its entities decoded.
    const reads = [message];
    if (expected.onCard) {
      const card = cardTextOf(result);
      expect(card, label).toContain(message);
      reads.push(card);
    }

    if (expected.is !== undefined) expect(message, label).toBe(expected.is);
    for (const words of expected.carries ?? []) {
      expect(message, `${label}: must carry ${words}`).toContain(words);
    }
    for (const read of reads) {
      for (const words of expected.never ?? []) {
        expect(read, `${label}: must not carry ${words}`).not.toContain(words);
      }
      for (const pattern of expected.neverMatch ?? []) {
        expect(read, label).not.toMatch(pattern);
      }
      if (expected.noLineOf !== undefined) {
        // Graded as the BAR rather than as a list of strings: NO non-blank
        // line of the part crosses, so the next text node a WAF prints is
        // covered by this same assertion.
        const printed = expected.noLineOf
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        expect(printed.length, label).toBeGreaterThan(3);
        for (const line of printed) {
          expect(read, `${label} quotes ${line}`).not.toContain(line);
        }
      }
    }
    for (const words of expected.once ?? []) {
      expect(message.split(words).length - 1, `${label}: ${words} once`).toBe(1);
    }
    if (expected.frames === 0) {
      expect(message, label).not.toMatch(/frame/i);
    } else if (expected.frames !== undefined) {
      expect(message, label).toMatch(new RegExp(`\\b${expected.frames}\\b[^)]{0,40}frame`));
    }
    if (expected.countsWhole !== undefined) {
      expect(clausesIn(message), label).toBe(1);
      expect(message, label).toContain(documentClause(expected.countsWhole));
      expect(message, label).toContain(String(expected.countsWhole.length));
    }
    if (expected.countsNothing) expect(clausesIn(message), label).toBe(0);
    if (expected.shorterThan !== undefined) {
      expect(message.length, label).toBeLessThan(expected.shorterThan);
    }
    if (expected.inOrder !== undefined) {
      const at = (part: string) => message.indexOf(part);
      expect(at(expected.inOrder[0]), label).toBeGreaterThanOrEqual(0);
      for (let index = 1; index < expected.inOrder.length; index += 1) {
        expect(at(expected.inOrder[index]), label).toBeGreaterThan(
          at(expected.inOrder[index - 1]),
        );
      }
    }
    if (expected.endsWith !== undefined) {
      expect(message.endsWith(expected.endsWith), label).toBe(true);
    }
    if (expected.sentenceAround !== undefined) {
      // An app-authored clause, not a bare count: the operator can tell that
      // something other than the database answered.
      const withoutTheCount = message.replace(expected.sentenceAround, "").trim();
      expect(withoutTheCount.split(/\s+/).length, label).toBeGreaterThan(3);
    }
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

  /**
   * The rest of what QA measured on that shape (admin-window/BUG-0187): the
   * GROWTH ladder — 4, 16 and 64 text nodes — and the same bytes arriving
   * CRLF-separated through the real `@supabase/supabase-js` client over a
   * stubbed 400 transport, which is where a part like this actually comes
   * from. No network: the host is `.invalid` and `fetch` is stubbed.
   *
   * Graded as the BAR rather than as a list of strings: ONE clause at the
   * PART's length, no non-blank line of the part on the result or the
   * rendered card, and an account bounded by the clause instead of growing
   * with the page's text nodes.
   */
  it("bounds the account by the clause at every text-node count, CRLF included (admin-window/BUG-0187)", async () => {
    /** A pretty-printed interstitial whose TEXT sits on its own lines. */
    const interstitial = (nodes: number, newline: string): string =>
      [
        "<!DOCTYPE html>",
        '<html lang="en-US">',
        "<body>",
        ...Array.from({ length: nodes }, (_unused, node) => node).flatMap(
          (node) => [
            `<p class="cf-note-${node}">`,
            `Sorry, you have been blocked (${node})`,
            "</p>",
          ],
        ),
        "</body>",
        "</html>",
      ].join(newline);

    /** Every non-blank line of a part, trimmed — what may never be quoted. */
    const linesOf = (part: string): string[] =>
      part
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const accounts: number[] = [];
    for (const nodes of [4, 16, 64]) {
      const part = `reference 8f3c1\n${interstitial(nodes, "\n")}`;
      const result = classify(
        { code: "", details: part, hint: "", message: "read failed" },
        T.pendingClaims,
      );
      expect(result.kind, `${nodes} text nodes`).toBe("error");
      if (result.kind !== "error") continue;
      expect(clausesIn(result.message), `${nodes} text nodes`).toBe(1);
      expect(result.message, `${nodes} text nodes`).toContain(documentClause(part));
      expect(result.message.length, `${nodes} text nodes`).toBeLessThan(part.length);
      const card = cardTextOf(result);
      expect(card, `${nodes} text nodes`).toContain(result.message);
      for (const read of [result.message, card]) {
        for (const line of linesOf(part)) {
          expect(read, `${nodes} text nodes quotes ${line}`).not.toContain(line);
        }
      }
      accounts.push(result.message.length);
    }
    // Bounded by the CLAUSE, not by the page: sixteen times the text nodes
    // moves the account by the digits of one number, not by thousands of
    // characters (QA measured 527 -> 6,881 before this).
    expect(accounts).toHaveLength(3);
    expect(accounts[2] - accounts[0]).toBeLessThan(10);

    // The same bytes where they actually come from: CRLF-separated, through
    // the real client over a stubbed 400 transport.
    const crlfPart = `reference 8f3c1\r\n${interstitial(16, "\r\n")}`;
    const client = createClient("https://stub.invalid", "stub-key", {
      auth: { persistSession: false },
      global: {
        fetch: async () =>
          new Response(
            JSON.stringify({
              code: "",
              message: "read failed",
              details: crlfPart,
              hint: "",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
      },
    }) as unknown as SupabaseClient;

    const read = await readRows(
      T.pendingClaims,
      ["id"],
      (db) => db.from(T.pendingClaims).select("id"),
      client,
    );
    expect(read.kind).toBe("error");
    if (read.kind !== "error") return;
    expect(clausesIn(read.message)).toBe(1);
    expect(read.message).toContain(documentClause(crlfPart));
    expect(read.message).toContain(String(crlfPart.length));
    expect(read.message.length).toBeLessThan(crlfPart.length);
    const card = cardTextOf(read);
    for (const surface of [read.message, card]) {
      for (const line of linesOf(crlfPart)) {
        expect(surface, `quotes ${line}`).not.toContain(line);
      }
    }
  });

  /**
   * ONE SENTENCE, ONCE — and the twin that forbids the greedy rule
   * (admin-window/DEBT-0020, LESSONS 8).
   *
   * MEASURED through the real client before a line of the fix was written:
   * this shape's account read `TypeError: fetch failed Caused by: Error:
   * getaddrinfo ENOTFOUND db.invalid (ENOTFOUND) Error: getaddrinfo ENOTFOUND
   * db.invalid (1 runtime stack frame dropped)` — 158 characters, one true
   * sentence the database authored, stated twice. postgrest-js writes
   * `Caused by: ${cause.name}: ${cause.message}`, then ` (${cause.code})` on
   * that same line when the cause carries one (node's always do), and then
   * appends the cause's whole `stack`, whose FIRST line is
   * `${cause.name}: ${cause.message}` again. `errorMessage`'s part-level dedup
   * cannot see it: both copies live inside the ONE reduced `details`.
   *
   * The twin is the half that keeps the fix honest. A rule that dropped any
   * line another kept line CONTAINS ANYWHERE would also delete a database
   * message wrapped onto a continuation line that opens with the first line's
   * own words — so the rule spares exactly that case (an earlier line BEGINS
   * with this one) and both directions are graded here, on the same code path
   * (each twin part carries a frame, which is the only state in which this
   * file reshapes a part at all).
   */
  it("says a repeated cause sentence once, and a prefix-sharing line twice", () => {
    /** Occurrences of `needle` in `haystack` — the whole grading below. */
    const occurrences = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;

    // The measured transport shape, built exactly as postgrest-js builds it:
    // the wrapper line, a BLANK line, the attributed cause, the cause's stack
    // (head line first), and V8 frames. `attribution` is the ONE line that
    // differs between a cause that carries a `code` and one that does not —
    // postgrest-js appends ` (${cause.code})` to it, BETWEEN the two copies
    // of the sentence, and node's causes always carry one
    // (admin-window/BUG-0199: the ends-with rule this replaced saw the
    // code-less line only, which is the shape production never produces).
    const sentence = "Error: getaddrinfo ENOTFOUND db.invalid";
    const detailsWith = (attribution: string): string =>
      [
        "TypeError: fetch failed",
        "",
        attribution,
        sentence,
        "    at GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:120:26)",
        `    at async readRows (${DEPLOY}/src/lib/db/result.ts:476:20)`,
      ].join("\n");

    for (const attribution of [
      // What node's own DNS failure produces, and the one to believe.
      `Caused by: ${sentence} (ENOTFOUND)`,
      // A cause carrying no code at all — the same bar, one line shorter.
      `Caused by: ${sentence}`,
    ]) {
      const transport = classify(
        {
          code: "",
          message: "TypeError: fetch failed",
          details: detailsWith(attribution),
          hint: "",
        },
        T.pendingClaims,
      );
      expect(transport.kind, attribution).toBe("error");
      if (transport.kind !== "error") continue;

      // ONCE, and STILL THERE — the attributing line is the copy that
      // survives, so the account still says who caused what, code and all.
      expect(transport.message, attribution).toContain(sentence);
      expect(occurrences(transport.message, sentence), attribution).toBe(1);
      expect(transport.message, attribution).toContain(attribution);
      // Nothing else about the account moved: it still names the object read,
      // still carries the wrapper once, still counts the frames in the app's
      // own words, and still carries no runtime and no filesystem.
      expect(transport.reading, attribution).toBe(T.pendingClaims);
      expect(
        occurrences(transport.message, "TypeError: fetch failed"),
        attribution,
      ).toBe(1);
      expect(transport.message, attribution).toMatch(/\b2\b[^)]{0,40}frame/);
      expect(transport.message, attribution).not.toContain("node:dns:");
      expect(transport.message, attribution).not.toContain("GetAddrInfoReqWrap");
      expect(transport.message, attribution).not.toContain(DEPLOY);
      // And the operator reads that one sentence once off the rendered card.
      expect(occurrences(cardTextOf(transport), sentence), attribution).toBe(1);
    }

    // THE TWIN — two lines that share a prefix but are not the same line.
    // Each pair is the database's own words twice over and BOTH lines cross
    // whole, whichever order they arrive in.
    const TIMEOUT = "canceling statement due to statement timeout";
    const CONSTRAINT = "duplicate key value violates unique constraint";
    const wrapped = `${TIMEOUT} after 30000 ms, at the end of the statement`;
    const PREFIX_SHARING: ReadonlyArray<readonly [string, string]> = [
      // A message wrapped onto a second line that BEGINS with the first.
      [TIMEOUT, wrapped],
      // The same pair the other way round, so arrival order cannot save the
      // rule from the greedy reading.
      [wrapped, TIMEOUT],
      // And two lines that merely SHARE a prefix, neither inside the other.
      [`${CONSTRAINT} "groups_name_key"`, `${CONSTRAINT} "groups_slug_key"`],
    ];

    for (const [first, second] of PREFIX_SHARING) {
      const arrived = `${first} ${second}`;
      const twin = classify(
        {
          code: "",
          message: "the statement was refused",
          details: [
            first,
            second,
            `    at async readRows (${DEPLOY}/src/lib/db/result.ts:476:20)`,
          ].join("\n"),
          hint: "",
        },
        T.pendingClaims,
      );
      expect(twin.kind, arrived).toBe("error");
      if (twin.kind !== "error") continue;
      // Both lines, whole, in the order they arrived — the same count of each
      // the part itself carries, so a rule that deleted either one fails here.
      expect(twin.message, arrived).toContain(arrived);
      expect(occurrences(twin.message, first), `${arrived}: first`).toBe(
        occurrences(arrived, first),
      );
      expect(occurrences(twin.message, second), `${arrived}: second`).toBe(
        occurrences(arrived, second),
      );
      // Non-vacuous: this part really did go down the reshaping path, so the
      // dedup ran over these two lines and kept them both.
      expect(twin.message, arrived).toMatch(/\b1\b[^)]{0,40}frame/);
      expect(twin.message, arrived).not.toContain(DEPLOY);
    }
  });

  /**
   * THE SAME SENTENCE, STILL SAID TWICE, ON EVERY REAL TRANSPORT FAILURE
   * (QA pin, admin-window/BUG-0199, filed against admin-window/DEBT-0020).
   *
   * DEBT-0020 measured its shape from a hand-built `cause` that carried no
   * `code`. Node's do: `getaddrinfo ENOTFOUND` carries `code: "ENOTFOUND"`,
   * `connect ECONNREFUSED` carries `code: "ECONNREFUSED"`, and postgrest-js
   * writes that code INTO the attributing line before it appends the stack
   * (`node_modules/@supabase/postgrest-js/dist/index.mjs`: `if (causeCode)
   * errorDetails += ` (${causeCode})`` sits between the `Caused by:` line and
   * the `errorDetails += "\n" + cause.stack` arm). So the earlier kept line
   * reads `Caused by: Error: getaddrinfo ENOTFOUND db.invalid (ENOTFOUND)`
   * and no longer ENDS WITH the stack head it is supposed to absorb —
   * `saidOnce`'s ends-with test misses, and the account says the cause
   * sentence twice again.
   *
   * Driven through the REAL `@supabase/supabase-js` client over a transport
   * that REJECTS the way node's `fetch` rejects, so the `details` string is
   * postgrest-js's own and not a fixture's idea of it. No network: the host is
   * `.invalid` and the stub throws before any socket.
   * FIXED by admin-window/DEBT-0020's second attempt: `saidOnce` drops a line
   * an earlier kept line already carries whole somewhere other than at its
   * own START, so the code between the two copies no longer hides the repeat.
   * QA pinned this `it.fails` while the defect stood; it is a plain `it` again
   * and grades the shape a deployed instance actually produces.
   */
  it("says the cause sentence once when the cause carries a code, as node's do", async () => {
    const occurrences = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;

    /** A client whose transport rejects with exactly what node hands back. */
    const rejecting = (fetchError: unknown): SupabaseClient =>
      createClient("https://stub.invalid", "stub-key", {
        auth: { persistSession: false },
        global: {
          fetch: async () => {
            throw fetchError;
          },
        },
      }) as unknown as SupabaseClient;

    /** The wrapper node's `fetch` throws, around a cause that carries a code. */
    const transportFailureWithCode = (
      sentence: string,
      code: string,
      frame: string,
    ): unknown => {
      const cause = new Error(sentence) as Error & { code?: string };
      cause.code = code;
      cause.stack = `${sentence}\n    at ${frame}`;
      const wrapper = new TypeError("fetch failed");
      (wrapper as TypeError & { cause?: unknown }).cause = cause;
      return wrapper;
    };

    for (const [sentence, code, frame] of [
      [
        "Error: getaddrinfo ENOTFOUND db.invalid",
        "ENOTFOUND",
        "GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:120:26)",
      ],
      [
        "Error: connect ECONNREFUSED 127.0.0.1:5432",
        "ECONNREFUSED",
        "TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)",
      ],
    ] as ReadonlyArray<readonly [string, string, string]>) {
      const result = await readRows(
        T.pendingClaims,
        ["id"],
        (db) => db.from(T.pendingClaims).select("id"),
        rejecting(transportFailureWithCode(sentence, code, frame)),
      );
      expect(result.kind, sentence).toBe("error");
      if (result.kind !== "error") continue;
      // STILL THERE, and said ONCE — the whole of DEBT-0020's bar, on the
      // shape a deployed instance actually produces.
      expect(result.message, sentence).toContain(sentence);
      expect(occurrences(result.message, sentence), sentence).toBe(1);
      // Nothing else may move to buy that: the object read is still named,
      // the frames are still counted in the app's words, and no runtime
      // internal crosses.
      expect(result.reading, sentence).toBe(T.pendingClaims);
      expect(result.message, sentence).toMatch(/\b1\b[^)]{0,40}frame/);
      expect(result.message, sentence).not.toContain("node:dns:");
      expect(result.message, sentence).not.toContain("node:net:");
    }
  });

  /**
   * WHO WROTE EACH PART OF THE ACCOUNT — campaign admin-window/BUG-0196.
   *
   * The account crossed to the view as ONE string, so no renderer could tell
   * this app's clauses from the database's and all of them reached the
   * operator in the mono face the type scale reserves for the machine. The
   * fix is that the fact TRAVELS: `classify` publishes the account as runs,
   * each carrying who wrote it, decided where the clause is authored.
   *
   * Every case below is STRUCTURAL — which run a part lands in, and that the
   * flat account is the join of the runs. None of them pins one of this app's
   * sentences: reword any clause and nothing here moves.
   */
  describe("and says who wrote each of them", () => {
    /** The error arm of a classified failure, or a loud failure. */
    function accountOf(error: unknown): {
      message: string;
      runs: readonly AccountSegment[];
    } {
      const result = classify(error, T.pendingClaims);
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("unreachable");
      expect(result.authored, "the arm carries no authorship").toBeDefined();
      return { message: result.message, runs: result.authored ?? [] };
    }

    /** The authors of an account's runs, in order — the shape of the split. */
    const authorsOf = (error: unknown): ReasonAuthor[] =>
      accountOf(error).runs.map((run) => run.author);

    /** The words of the runs ONE author wrote, joined as the line reads them. */
    function wroteBy(error: unknown, author: ReasonAuthor): string {
      return accountOf(error)
        .runs.filter((run) => run.author === author)
        .map((run) => run.words)
        .join(" ");
    }

    it("makes the flat message the JOIN of the runs, on every shape", () => {
      // Criterion 5b: the string is derived FROM the segments, not beside
      // them — which is what makes byte-identity structural. Every fixture
      // this suite reasons about is driven, the plain ones included.
      for (const [name, error] of [
        ["a document in `message`", { code: "", message: `<!DOCTYPE html>${"x".repeat(40)}` }],
        ["a serialised envelope", envelope],
        ["a nested document", nestedDocument],
        ["a transport failure with frames", dnsFailure],
        ["a 2xx body that was not JSON", notJsonBody],
        ["indented prose that is not a frame", indentedProse],
        ["a plain PostgREST refusal", permissionDenied(T.pendingClaims)],
        ["a thrown string", "socket hang up"],
        ["a value that said nothing at all", { code: "", message: "" }],
      ] as ReadonlyArray<readonly [string, unknown]>) {
        const { message, runs } = accountOf(error);
        expect(runs.map((run) => run.words).join(" "), name).toBe(message);
        // No empty run: a run with no words is a span drawing a gap around
        // nothing, and it cannot be what any author wrote.
        for (const run of runs) expect(run.words.length, name).toBeGreaterThan(0);
      }
    });

    it("puts a counted clause about a part it refused to quote in this app's run", () => {
      // The three authors of criterion 2 that REPLACE a part: a document, a
      // body with no sentence of its own, and a document nested one quote
      // deep. Each account is exactly one run, and it is ours — asserted by
      // its AUTHOR, never by its wording.
      for (const [name, error] of [
        ["a document", { code: "", message: `<!DOCTYPE html>${"x".repeat(40)}` }],
        ["an envelope with no message", envelope],
        ["a document nested one quote deep", nestedDocument],
      ] as ReadonlyArray<readonly [string, unknown]>) {
        expect(authorsOf(error), name).toEqual(["this app"]);
      }
    });

    it("splits ONE account between both faces where both authors spoke", () => {
      // Criterion 4: a part that kept its cause sentence and dropped frames.
      // The database's lines are the machine's run; the count of what went is
      // this app's, and they are separate runs of one account in that order.
      expect(authorsOf(dnsFailure)).toEqual(["the machine", "this app"]);
      // Nothing is dropped, truncated or reordered to buy the split: the
      // cause the account exists to preserve is in the machine's run, and the
      // number of frames is in ours.
      expect(wroteBy(dnsFailure, "the machine")).toContain("getaddrinfo ENOTFOUND db.invalid");
      expect(wroteBy(dnsFailure, "this app")).toMatch(/\b1\b[^)]{0,40}frame/);
      expect(wroteBy(dnsFailure, "this app")).not.toContain("ENOTFOUND");
    });

    it("says the read was refused in this app's run when the client said nothing at all", () => {
      // The fourth author of criterion 2. A non-2xx with an empty body: every
      // part is blank, so the account is the app's own clause and reads in
      // the app's face.
      expect(authorsOf({ code: "", message: "" })).toEqual(["this app"]);
    });

    it("never recovers the author from the words: the same sentence, both ways round", () => {
      // Criterion 5e, and the bar `reasonFrom` already passes: the DATABASE
      // says, verbatim, the sentence this app writes about a document. Read
      // as text it is indistinguishable; read as provenance it is the
      // machine's, because the database authored it. A derivation comparing a
      // sentence to this app's own list fails here; one carrying the fact
      // passes, and no rewording can change that.
      const ours = wroteBy({ code: "", message: `<!DOCTYPE html>${"x".repeat(40)}` }, "this app");
      expect(ours.length).toBeGreaterThan(0);

      const impostor = accountOf({ code: "42501", message: ours });
      expect(impostor.runs.map((run) => run.author)).toEqual(["the machine", "the machine"]);
      expect(impostor.message).toContain(ours);
    });

    it("scrubs every run, so a credential cannot cross inside one", () => {
      // `withoutSecrets` still runs LAST over what crosses — over the runs
      // now, which is the same string as over the join.
      const { message, runs } = accountOf({
        code: "",
        message: `GET https://host/rest/v1/events failed with apikey ${jwtShaped}`,
      });
      expect(message).not.toContain(jwtShaped);
      for (const run of runs) expect(run.words).not.toContain(jwtShaped);
      expect(message).toContain("[redacted]");
    });

    it("cannot spell an error arm whose account does not say who wrote it", () => {
      // admin-window/DEBT-0021. Every arm asserted above carries its runs, and
      // until now the only thing that kept the NEXT one from omitting them was
      // a regex sweep stored in a closed ticket's checks — which nothing runs
      // again, and which sees one spelling of the literal. The property is
      // stated here instead, where it runs on every ticket forever: `authored`
      // is REQUIRED on the error member of `DbResult`, so every construction
      // site is refused by `tsc --noEmit` (acceptance test 1) whatever its
      // spelling — an object literal, a spread of a base, or a helper
      // returning the union member.
      //
      // A pin in both directions by construction: an unused `@ts-expect-error`
      // is itself an error (TS2578), so the day the `?` comes back this line
      // reddens instead of quietly permitting an unauthored account.
      const arm = (result: DbResult<never>): DbResult<never> => result;
      // @ts-expect-error an account that does not say which words the DATABASE
      // wrote and which this app wrote is unwritable.
      arm({ kind: "error", reading: T.pendingClaims, message: "connection refused" });

      // ...and the same arm WITH its runs compiles, so the directive above is
      // refusing the omission and not the shape. `authored` is read with no
      // `?? []` on purpose: the type carries the guarantee.
      const runs: readonly AccountSegment[] = [
        { words: "connection refused", author: "the machine" },
      ];
      const written = arm({
        kind: "error",
        reading: T.pendingClaims,
        message: runs.map((run) => run.words).join(" "),
        authored: runs,
      });
      expect(written.kind).toBe("error");
      if (written.kind !== "error") throw new Error("unreachable");
      expect(written.authored.map((run) => run.author)).toEqual(["the machine"]);
      expect(written.authored.map((run) => run.words).join(" ")).toBe(written.message);
    });
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
});

describe("reads against a scripted PostgREST response", () => {
  it("returns ok with the rows the database returned", async () => {
    const items = reviewItemShapes();
    const stub = stubClient({ [T.reviewItems]: { data: items } });

    const result = await readRows(
      T.reviewItems,
      ANY_COLUMNS,
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

  /**
   * The bodies QA measured an HTTP 500 on (admin-window/BUG-0228), each a JSON
   * ARRAY that is not this table's rows. They are one question with one
   * answer, not six shapes to enumerate: none of their elements carries the
   * columns the read named.
   */
  const NOT_THIS_READS_ROWS: ReadonlyArray<readonly [string, unknown]> = [
    ["a proxy's own JSON list", [{ message: "no upstream" }]],
    ["an array of arrays", [[{ claim_id: "c1" }]]],
    ["an array of strings", ["a", "b"]],
    ["an array of nulls", [null, null]],
    ["an array of empty objects", [{}]],
    ["an array of objects with other keys", [{ foo: 1 }]],
  ];

  /** The columns `pending_claims` reads name, as the query names them. */
  const CLAIM_COLUMNS = ["observation_id", "bucket"] as const;

  /** The reads an answer reaches, each built the way its callers build it. */
  type Leg = "readRows" | "readComplete" | "readRowsByIds" | "readOne" | "readCount";

  const LEGS: Readonly<
    Record<Leg, (db: SupabaseClient, columns: RowColumns) => Promise<DbResult<unknown>>>
  > = {
    readRows: (db, columns) =>
      readRows(
        T.pendingClaims,
        columns,
        (client) => client.from(T.pendingClaims).select(selectList(columns)),
        db,
      ),
    readComplete: (db, columns) =>
      readComplete(
        T.pendingClaims,
        columns,
        (client, cap) =>
          client
            .from(T.pendingClaims)
            .select(selectList(columns), { count: "exact" })
            .order("observation_id", { ascending: true })
            .range(0, cap - 1),
        db,
      ),
    // The id-set leg is `readRows` underneath, so the same question reaches
    // a two-step join's second leg (ARCHITECTURE.md §4.2).
    readRowsByIds: (db, columns) =>
      readRowsByIds(
        T.pendingClaims,
        columns,
        ["observation-1"],
        (client, chunkIds) =>
          client
            .from(T.pendingClaims)
            .select(selectList(columns))
            .in("observation_id", chunkIds),
        db,
      ),
    readOne: (db, columns) =>
      readOne(
        T.pendingClaims,
        columns,
        (client) => client.from(T.pendingClaims).select(selectList(columns)).maybeSingle(),
        db,
      ),
    readCount: (db) => readCount(T.pendingClaims, (client) => countRead(client, T.pendingClaims), db),
  };

  /** One answer a host gave, and what each leg that met it must do with it. */
  interface AnswerFixture {
    readonly label: string;
    /** What the host answered, as the stub hands it to the client. */
    readonly answer: ScriptedResponse;
    /** Legs that refuse through the one rule, in its one sentence. */
    readonly refuses?: readonly Leg[];
    /** Legs that answer red — kind alone, as the count pins graded them. */
    readonly reddens?: readonly Leg[];
    /** What each admitting leg hands back, exactly. */
    readonly admits?: Readonly<Partial<Record<Leg, unknown>>>;
    /** Spellings no red answer may carry. */
    readonly never?: readonly string[];
  }

  /** The rows this read named, as PostgREST really sends them. */
  const REAL_ROWS = [
    { observation_id: "observation-1", bucket: "agreeing" },
    // A column PostgREST returned as NULL is a row: nullable columns are
    // real and `lib/format.ts` renders their absence. Only a MISSING name
    // is not a row.
    { observation_id: "observation-2", bucket: null },
  ];
  const WIDER_ROW = { observation_id: "observation-1", bucket: "agreeing", extra: 1 };
  const ONE_ROW = { observation_id: "observation-1", bucket: "agreeing" };

  /**
   * WHAT A PostgREST ANSWER IS (ARCHITECTURE.md §4.1; admin-window/BUG-0224,
   * BUG-0227, BUG-0228, BUG-0229) — one table over every answer the chain
   * measured, graded by the one bar: every leg of an answer — error, rows,
   * count — is in the shape PostgREST sends it, or the WHOLE answer is one
   * refusal naming the object, in the one sentence every ungradeable answer
   * refuses in (`unreadableAnswer`), never an emptiness and never a figure;
   * and every answer PostgREST really gives still crosses (LESSONS 8).
   */
  const ANSWERS: readonly AnswerFixture[] = [
    // ── BUG-0224: a response carrying neither what it asked for nor a failure ──
    {
      label: "no array, no count and no failure — a host answering 404 with zero bytes",
      answer: { data: null },
      refuses: ["readRows", "readCount", "readComplete"],
      // A `.maybeSingle()` over no rows really does answer `data: null`.
      admits: { readOne: null },
    },
    {
      label: "rows beside a count the host never gave",
      answer: { data: [ONE_ROW], count: null },
      refuses: ["readComplete"],
    },
    {
      label: "rows the host never sent, beside a count of 12",
      answer: { data: null, count: 12 },
      refuses: ["readComplete"],
    },
    // ── BUG-0227: a row set that did not come back as an ARRAY did not come back ──
    {
      label: "a JSON object where a row set should be",
      answer: { data: { message: "no upstream" }, count: 3 },
      refuses: ["readRows", "readComplete", "readOne"],
    },
    // ── BUG-0228: a row set is an answer whose every element carries every column this read asked for ──
    ...NOT_THIS_READS_ROWS.map(
      ([shape, body]): AnswerFixture => ({
        label: `${shape}, a JSON array that is not this read's rows`,
        answer: { data: body, count: 2 },
        refuses: ["readRows", "readComplete", "readRowsByIds"],
      }),
    ),
    {
      label: "the rows the read named, one nullable column null",
      answer: { data: REAL_ROWS },
      admits: { readRows: REAL_ROWS },
    },
    {
      label: "a row carrying more than the read named",
      answer: { data: [WIDER_ROW] },
      admits: { readRows: [WIDER_ROW] },
    },
    {
      // `[]` — the matching set of zero — still empties, and a counted zero is
      // information (criterion 3): the fix must not turn "no rows" into "refused".
      label: "the matching set of zero, counted",
      answer: { data: [], count: 0 },
      admits: { readRows: [], readComplete: [], readCount: 0 },
    },
    {
      label: "one row that really arrived",
      answer: { data: ONE_ROW },
      admits: { readOne: ONE_ROW },
    },
    // ── BUG-0228 residual and BUG-0229: a count is a number of ROWS or it did not arrive ──
    ...[Number.NaN, 1.5, Number.POSITIVE_INFINITY].map(
      (count): AnswerFixture => ({
        label: `a count of ${count}, not a whole number of rows`,
        answer: { data: [], count },
        reddens: ["readCount", "readComplete"],
        never: ["NaN"],
      }),
    ),
    ...[-1, -5, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 2, 1e20].map(
      (count): AnswerFixture => ({
        label: `a count of ${count}, a whole number but not a number of ROWS`,
        answer: { data: [], count },
        reddens: ["readCount", "readComplete"],
      }),
    ),
    ...[1, Number.MAX_SAFE_INTEGER].map(
      (count): AnswerFixture => ({
        label: `a real count of ${count}`,
        answer: { data: [], count },
        admits: { readCount: count },
      }),
    ),
  ];

  it.each(ANSWERS)(
    "what a PostgREST answer is — $label",
    async ({ answer, refuses = [], reddens = [], admits = {}, never = [] }) => {
      const over = (scripted: ScriptedResponse) =>
        stubClient({ [T.pendingClaims]: scripted }).asSupabaseClient();
      // The twin every refusal is compared to — the sentence a missing row
      // set refuses in — never pinned as a literal, so the two cannot drift
      // (LESSONS 11).
      const ungradeable = await LEGS.readRows(over({ data: null }), CLAIM_COLUMNS);
      expect(ungradeable.kind).toBe("error");
      if (ungradeable.kind !== "error") return;

      for (const leg of refuses) {
        const result = await LEGS[leg](over(answer), CLAIM_COLUMNS);
        expect(result.kind, leg).toBe("error");
        if (result.kind !== "error") continue;
        // It names the object it read, never claims the object is absent,
        // hands nothing on as rows or as a figure, and every word of it is
        // this app's own — none of them about a call site in this repo.
        expect(result.reading, leg).toBe(T.pendingClaims);
        expect(result, leg).not.toHaveProperty("data");
        expect(result.authored, leg).toEqual([
          { words: result.message, author: "this app" },
        ]);
        for (const callSite of CALL_SITE_PROSE) {
          expect(result.message, leg).not.toContain(callSite);
        }
        expect(result.message, leg).toBe(ungradeable.message);
      }
      for (const leg of reddens) {
        const result = await LEGS[leg](over(answer), CLAIM_COLUMNS);
        expect(result.kind, leg).toBe("error");
        if (result.kind !== "error") continue;
        for (const words of never) expect(result.message, leg).not.toContain(words);
      }
      for (const [leg, data] of Object.entries(admits) as ReadonlyArray<[Leg, unknown]>) {
        await expect(LEGS[leg](over(answer), CLAIM_COLUMNS), leg).resolves.toEqual({
          kind: "ok",
          data,
        });
      }
    },
  );

  it("a single-row read admits no row only from an answer that carried one", async () => {
    // §4.1 clause 3 (admin-window/BUG-0234). `data: null` is what BOTH a real
    // empty `.maybeSingle()` and supabase-js's rewrite of a bodyless 404 hand
    // back, so the null alone decides nothing: the status line is where the
    // two differ, and it is asked there. Every fixture below goes through a
    // REAL client over a scripted transport, so the rewrite is the library's
    // own and not this test's belief about it.
    const ROW = { review_item_id: "ri-1", severity: "high" };
    const COLUMNS = ["review_item_id", "severity"];
    const hostAnswering = (answer: () => Response): SupabaseClient =>
      createClient("https://one-row.invalid", "stub-key", {
        auth: { persistSession: false },
        global: { fetch: async () => answer() },
      }) as unknown as SupabaseClient;
    const seek = (db: SupabaseClient) =>
      db.from(T.reviewItems).select(COLUMNS.join(", ")).maybeSingle();

    // The fixture, established rather than assumed: a host answering 404 with
    // zero bytes reaches this app as a 204 carrying neither rows nor failure.
    const blank = hostAnswering(() => new Response("", { status: 404 }));
    const rewritten = (await blank
      .from(T.reviewItems)
      .select(COLUMNS.join(", "))
      .maybeSingle()) as unknown as DbResponse<unknown> & { status?: number };
    expect(rewritten.status).toBe(204);
    expect(rewritten.data).toBeNull();
    expect(rewritten.error).toBeNull();

    // MUST FLAG: that response is not an absence and not a row. It refuses in
    // the one sentence every ungradeable answer refuses in — compared to its
    // twin, never pinned as a literal (LESSONS 11).
    const overBlank = await readOne(T.reviewItems, COLUMNS, seek, blank);
    expect(overBlank.kind).toBe("error");
    if (overBlank.kind !== "error") return;
    expect(overBlank.reading).toBe(T.reviewItems);
    expect(overBlank).not.toHaveProperty("data");
    expect(overBlank.authored).toEqual([
      { words: overBlank.message, author: "this app" },
    ]);
    const ungradeable = await readRows(
      T.reviewItems,
      COLUMNS,
      (db) => db.from(T.reviewItems).select(COLUMNS.join(", ")),
      stubClient({ [T.reviewItems]: { data: null } }).asSupabaseClient(),
    );
    expect(ungradeable.kind).toBe("error");
    if (ungradeable.kind !== "error") return;
    expect(overBlank.message).toBe(ungradeable.message);

    // MUST NOT FLAG: a real empty `.maybeSingle()` — PostgREST answers 200
    // carrying `[]`, which supabase-js hands over as `data: null`. That is an
    // emptiness the host really sent, and it stays `ok: null`.
    const empty = hostAnswering(
      () =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await readOne(T.reviewItems, COLUMNS, seek, empty)).toEqual({
      kind: "ok",
      data: null,
    });

    // …and a row that really arrived is still handed over untouched.
    const found = hostAnswering(
      () =>
        new Response(JSON.stringify([ROW]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await readOne(T.reviewItems, COLUMNS, seek, found)).toEqual({
      kind: "ok",
      data: ROW,
    });
  });

  it("holds a read that declared no columns to the element test alone", async () => {
    // ANY_COLUMNS is the declaration of a read that selects `*` and reads no
    // column (`readSettlementReadiness`). There is no list to hold elements
    // against, so the weaker half stands on its own: an element that is not a
    // plain object is not a row PostgREST sent.
    for (const body of [["a", "b"], [null], [[{ claim_id: "c1" }]]]) {
      const result = await readRows(
        T.verdicts,
        ANY_COLUMNS,
        (db) => db.from(T.verdicts).select("*"),
        stubClient({ [T.verdicts]: { data: body } }).asSupabaseClient(),
      );
      expect(result.kind, JSON.stringify(body)).toBe("error");
    }
    // And the shape a `select("*")` really answers with still reads as rows.
    const real = [{ verdict_id: "verdict-1" }];
    expect(
      await readRows(
        T.verdicts,
        ANY_COLUMNS,
        (db) => db.from(T.verdicts).select("*"),
        stubClient({ [T.verdicts]: { data: real } }).asSupabaseClient(),
      ),
    ).toEqual({ kind: "ok", data: real });
  });

  it("returns not_provisioned when the table is not in the schema cache", async () => {
    const stub = stubClient({
      [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
    });
    const result = await readRows(
      T.verdicts,
      ANY_COLUMNS,
      (db) => db.from(T.verdicts).select("*"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "not_provisioned", missing: T.verdicts });
  });

  it("returns the database's message when the read is refused", async () => {
    const error = permissionDenied(T.observations);
    const stub = stubClient({ [T.observations]: { error } });
    const result = await readRows(
      T.observations,
      ANY_COLUMNS,
      (db) => db.from(T.observations).select("*"),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({
      kind: "error",
      reading: T.observations,
      message: expect.stringContaining(error.message),
      authored: [
        { words: error.message, author: "the machine" },
        { words: `(${error.code})`, author: "the machine" },
      ],
    });
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
      ["group_id"],
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
      readRows(T.groups, ["group_id"], (db) => db.from(T.groups).select("group_id"), client),
    ).resolves.toEqual({ kind: "ok", data: [{ group_id: "g1" }] });
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
        await readOne(SETTLE_FUNCTION, ANY_COLUMNS, rpc, stubClient(script).asSupabaseClient()),
        await readRows(SETTLE_FUNCTION, ANY_COLUMNS, rpc, stubClient(script).asSupabaseClient()),
        await readCount(SETTLE_FUNCTION, rpc, stubClient(script).asSupabaseClient()),
        await readComplete(SETTLE_FUNCTION, ANY_COLUMNS, rpc, stubClient(script).asSupabaseClient()),
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
      ["group_id"],
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
      ANY_COLUMNS,
      completeQuery(T.reviewItems),
      stub.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: items });
  });

  it("hands the cap to the query rather than letting the caller spell it", async () => {
    const stub = stubClient({ [T.reviewItems]: { data: [], count: 0 } });
    await readComplete(
      T.reviewItems,
      ANY_COLUMNS,
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
      await readComplete(T.verdicts, ANY_COLUMNS, completeQuery(T.verdicts), absent.asSupabaseClient()),
    ).toEqual({ kind: "not_provisioned", missing: T.verdicts });

    const refused = stubClient({
      [T.observations]: { error: permissionDenied(T.observations) },
    });
    expect(
      await readComplete(
        T.observations,
        ANY_COLUMNS,
        completeQuery(T.observations),
        refused.asSupabaseClient(),
      ),
    ).toEqual({
      kind: "error",
      reading: T.observations,
      message: expect.stringContaining(permissionDenied(T.observations).message),
      authored: [
        { words: permissionDenied(T.observations).message, author: "the machine" },
        { words: `(${permissionDenied(T.observations).code})`, author: "the machine" },
      ],
    });
  });

  it("a total smaller than the rows it came with is not a total of this set", async () => {
    // Two legs about ONE set, so they agree or the answer is refused, in
    // EITHER direction (ARCHITECTURE.md §4.1 clause 2, admin-window/BUG-0234).
    // The truncation arm asked only `count > rows.length`, so a host
    // publishing a total SMALLER than the rows it sent reached a surface as an
    // ok read whose head figure contradicted its own list.
    const items = reviewItemShapes();
    expect(items.length).toBeGreaterThan(1);

    // MUST FLAG: three rows arrived, the total says one.
    const short = await readComplete(
      T.reviewItems,
      ANY_COLUMNS,
      completeQuery(T.reviewItems),
      stubClient({ [T.reviewItems]: { data: items, count: 1 } }).asSupabaseClient(),
    );
    expect(short.kind).toBe("error");
    if (short.kind !== "error") return;
    expect(short.reading).toBe(T.reviewItems);
    // Never a partial array, and never the rows either: nothing downstream
    // gets to publish a figure or a list out of this answer.
    expect(short).not.toHaveProperty("data");
    expect(short.authored).toEqual([{ words: short.message, author: "this app" }]);

    // It refuses as an answer this app CANNOT GRADE — the same one sentence
    // every other ungradeable answer refuses in, compared to its twin rather
    // than pinned as a literal so the two cannot drift (LESSONS 11).
    const ungradeable = await readRows(
      T.reviewItems,
      ANY_COLUMNS,
      (db) => db.from(T.reviewItems).select("*"),
      stubClient({ [T.reviewItems]: { data: null } }).asSupabaseClient(),
    );
    expect(ungradeable.kind).toBe("error");
    if (ungradeable.kind !== "error") return;
    expect(short.message).toBe(ungradeable.message);
    // …and NOT as a truncation: no cap was reached, so a sentence naming the
    // cap would be a false account of what arrived.
    expect(short.message).not.toContain(String(ROW_CAP));
    for (const callSite of CALL_SITE_PROSE) {
      expect(short.message).not.toContain(callSite);
    }

    // MUST NOT FLAG: what a real PostgREST complete read answers — the exact
    // count of the rows it sent.
    expect(
      await readComplete(
        T.reviewItems,
        ANY_COLUMNS,
        completeQuery(T.reviewItems),
        stubClient({
          [T.reviewItems]: { data: items, count: items.length },
        }).asSupabaseClient(),
      ),
    ).toEqual({ kind: "ok", data: items });

    // And the OTHER direction keeps the account that is true only there: a
    // truncated set still names the count and the cap.
    const truncated = await readComplete(
      T.reviewItems,
      ANY_COLUMNS,
      completeQuery(T.reviewItems),
      stubClient({
        [T.reviewItems]: { data: items, count: items.length + 9 },
      }).asSupabaseClient(),
    );
    expect(truncated.kind).toBe("error");
    if (truncated.kind !== "error") return;
    expect(truncated.message).toContain(String(items.length + 9));
    expect(truncated.message).toContain(String(ROW_CAP));
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
      ANY_COLUMNS,
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
      ANY_COLUMNS,
      completeQuery(T.reviewItems),
      overflowing.asSupabaseClient(),
    );
    expect(refused.kind).toBe("error");
    if (refused.kind !== "error") return;
    expect(refused.message).toContain(String(ROW_CAP + 1));
    expect(refused).not.toHaveProperty("data");
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
      ANY_COLUMNS,
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
      await readRows(T.reviewItems, ANY_COLUMNS, (db) => db.from(T.reviewItems).select("*"), client),
      await readOne(T.reviewItems, ANY_COLUMNS, (db) => db.from(T.reviewItems).select("*").maybeSingle(), client),
      await readCount(
        T.reviewItems,
        (db) => db.from(T.reviewItems).select("*", { count: "exact", head: true }),
        client,
      ),
      await readComplete(
        T.reviewItems,
        ANY_COLUMNS,
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

    const thrown = {
      kind: "error",
      reading: T.sources,
      message: boom.message,
      authored: [{ words: boom.message, author: "the machine" }],
    };
    await expect(readRows(T.sources, ANY_COLUMNS, thrower, client)).resolves.toEqual(thrown);
    await expect(readOne(T.sources, ANY_COLUMNS, thrower, client)).resolves.toEqual(thrown);
    await expect(readCount(T.sources, thrower, client)).resolves.toEqual(thrown);
    await expect(readComplete(T.sources, ANY_COLUMNS, thrower, client)).resolves.toEqual(thrown);
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
      const result = await readRows(T.sources, ANY_COLUMNS, (db) => db.from(T.sources).select("*"));
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
    ["source_id"],
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
      ANY_COLUMNS,
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
      ANY_COLUMNS,
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
      ANY_COLUMNS,
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
      ANY_COLUMNS,
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
      ANY_COLUMNS,
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

  it("classifies a chunk whose request REJECTS instead of rejecting the fan-out", async () => {
    const issued: number[] = [];
    const result = await readRowsByIds<TaggedRow>(
      T.sources,
      ANY_COLUMNS,
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
      ANY_COLUMNS,
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

/**
 * THE ACCOUNTS `lib/db/result.ts` COMPOSES ITSELF, AND WHOSE FACE THEY READ IN
 * — QA, campaign admin-window, on the landed BUG-0196.
 *
 * BUG-0196 made authorship travel with the clause, and `classify` publishes it
 * for every account built out of what the client said. But `readComplete` and
 * `readCount` compose THREE MORE accounts of their own, about reads they could
 * not grade — a count that did not come back, and a set the cap truncated —
 * and none of them is a string any database produced. They carry no
 * authorship, so the wire's documented default applies to them and the
 * operator reads them in the mono `data` step the type scale reserves for the
 * machine's words: the exact defect of the ticket's own title, on the two arms
 * its criterion 2 enumerated past.
 *
 * Every assertion here is STRUCTURAL — who the runs say wrote them, and that
 * the flat message is still the join of them. Nothing pins a sentence, so
 * rewording any of the three moves nothing in this block.
 */
describe("an account this app composed about a read it could not grade", () => {
  /** `readComplete` on a set the cap truncated: a count above the rows back. */
  async function truncatedSet(): Promise<DbResult<unknown[]>> {
    const rows = Array.from({ length: ROW_CAP }, (_, index) => ({ id: `row-${index}` }));
    const stub = stubClient({ [T.reviewItems]: { data: rows, count: ROW_CAP + 732 } });
    return readComplete(
      T.reviewItems,
      ANY_COLUMNS,
      (db, cap) => db.from(T.reviewItems).select("*", { count: "exact" }).range(0, cap - 1),
      stub.asSupabaseClient(),
    );
  }

  /** `readComplete` on a query that answered no count at all. */
  async function completeWithoutCount(): Promise<DbResult<unknown[]>> {
    const stub = stubClient({ [T.reviewItems]: { data: [{ id: "a" }], count: null } });
    return readComplete(
      T.reviewItems,
      ANY_COLUMNS,
      (db) => db.from(T.reviewItems).select("*"),
      stub.asSupabaseClient(),
    );
  }

  /** `readCount` on a count read that answered no count at all. */
  async function countWithoutCount(): Promise<DbResult<number>> {
    const stub = stubClient({ [T.pendingClaims]: { data: null, count: null } });
    return readCount(
      T.pendingClaims,
      (db) => db.from(T.pendingClaims).select("*"),
      stub.asSupabaseClient(),
    );
  }

  // Was QA's strict xfail (`it.fails`) while the three arms carried no
  // authorship; admin-window/BUG-0200 gave them theirs, so it is a plain `it`
  // and stays green.
  it("says THIS APP wrote it, so it does not read in the machine's face", async () => {
    for (const [name, made] of [
      ["a set the cap truncated", truncatedSet],
      ["a complete read that got no count", completeWithoutCount],
      ["a count read that got no count", countWithoutCount],
    ] as ReadonlyArray<readonly [string, () => Promise<DbResult<unknown>>]>) {
      const result = await made();
      expect(result.kind, name).toBe("error");
      if (result.kind !== "error") continue;
      // No authorship at all means the wire's default: the WHOLE account is
      // the machine's, and every word of this one is ours.
      expect(result.authored, `${name}: the arm carries no authorship`).toBeDefined();
      expect(
        (result.authored ?? []).map((run) => run.author),
        `${name}: every run of an account this app wrote is this app's`,
      ).toEqual(["this app"]);
      // Whatever the runs are, the flat account stays the join of them.
      expect((result.authored ?? []).map((run) => run.words).join(" "), name).toBe(result.message);
    }
  });
});
