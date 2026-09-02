import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataTable,
  Empty,
  ErrorLine,
  Loading,
  NotProvisioned,
  StatCard,
} from "@/components/ui";
import { EM_DASH } from "@/lib/format";
import {
  statementTimeout,
  stubClient,
  unparseableFailure,
} from "../fixtures/stub-client";
import {
  MarkupReadError,
  ParityCountError,
  ParityError,
  StateMismatchError,
  assertParity,
  assertState,
  countOrAbsent,
  countRows,
  exactCount,
  gradeSurface,
  pageStates,
  readNumber,
  stateOf,
  whileStill,
} from "../live/parity";
import { codeLines, repoRoot } from "./source-tree";
import {
  LiveGuardError,
  declaredStagingTarget,
  hostMatchesDeclaration,
  resolveStagingTarget,
} from "../live/staging-target";
import { SweepError, createSweep, withSweep } from "../live/sweep";
import { h, render } from "./ui/markup";

/**
 * The live harness, proved OFFLINE (campaign admin-window, TASK-0003).
 *
 * Everything here runs in the default suite, with no database and no
 * `STAGING_*` name in the environment — which is the point: the refusal path
 * is the behavior that matters most and it must not need staging to be
 * testable. `tests/live/staging-target.ts`, `parity.ts` and `sweep.ts` are
 * pure or client-injected for exactly that reason; `tests/live/setup.ts` is
 * the one module with side effects, and the last case here runs the real
 * `npm run test:live` in a child process to prove the wiring.
 *
 * No value of any credential appears in this file. The names are the subject.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const URL_NAME = "STAGING_SUPABASE_URL";
const KEY_NAME = "STAGING_SUPABASE_SERVICE_ROLE_KEY";
const NAMES = { url: URL_NAME, key: KEY_NAME };

// A syntactically valid, obviously non-real target. Nothing is ever dialled.
const STAGING_URL = "https://stagingprojectref00.supabase.co";
const STAGING_REF = "stagingprojectref00";
const A_KEY = "offline-fixture-not-a-key";

/** A `SERVICES.md` that declares `target` under a real `## supabase` heading. */
function servicesDeclaring(target: string): string {
  return [
    "# External services",
    "",
    "## railway",
    "- staging target agents may touch: some-railway-thing",
    "",
    "## supabase",
    "- what it is for: the catalog",
    `- staging target agents may touch: ${target}`,
    "- provisioned by: a human, 2026-09-02",
    "",
  ].join("\n");
}

describe("the staging-target declaration", () => {
  it("reads the target out of the supabase section", () => {
    expect(declaredStagingTarget(servicesDeclaring(STAGING_REF))).toBe(
      STAGING_REF,
    );
  });

  it("finds none when the doc has no supabase section", () => {
    expect(declaredStagingTarget("# External services\n\n## railway\n- x: y\n"))
      .toBeNull();
  });

  it("finds none when the doc is absent altogether", () => {
    expect(declaredStagingTarget(null)).toBeNull();
  });

  it("does not read the doc's own indented entry template as a declaration", () => {
    // SERVICES.md ships the template inside an indented block. An indented
    // `## supabase` is not a heading, and a copied-but-unfilled placeholder is
    // not a declaration — either one passing would make the guard theatre.
    const templateOnly = [
      "Entry template (copy per service):",
      "",
      "    ## supabase",
      "    - staging target agents may touch: <project/env name or id>",
      "",
    ].join("\n");
    expect(declaredStagingTarget(templateOnly)).toBeNull();

    const unfilled = servicesDeclaring("<project/env name or id>");
    expect(declaredStagingTarget(unfilled)).toBeNull();
  });

  it("does not read a FILLED-IN example inside a fenced block as a declaration", () => {
    // The docstring's promise, made structural: a doc that shows what a good
    // declaration looks like must not thereby become one. Indentation and a
    // placeholder shape are not what makes the template inert.
    const fenced = [
      "# External services",
      "",
      "For example:",
      "",
      "```md",
      "## supabase",
      `- staging target agents may touch: ${STAGING_REF}`,
      "```",
      "",
    ].join("\n");
    expect(declaredStagingTarget(fenced)).toBeNull();

    const tilde = fenced.replace(/```md/, "~~~").replace(/```/, "~~~");
    expect(declaredStagingTarget(tilde)).toBeNull();
  });

  it("does not read an indented example under a real heading as a declaration", () => {
    const indented = [
      "## supabase",
      "- what it is for: the catalog",
      "",
      "    Example of the line a human writes:",
      `    - staging target agents may touch: ${STAGING_REF}`,
      "",
    ].join("\n");
    expect(declaredStagingTarget(indented)).toBeNull();
  });

  it("still reads a real declaration that follows a fenced example", () => {
    const both = [
      "# External services",
      "",
      "```md",
      "## supabase",
      "- staging target agents may touch: an-example-ref",
      "```",
      "",
      servicesDeclaring(STAGING_REF),
    ].join("\n");
    expect(declaredStagingTarget(both)).toBe(STAGING_REF);
  });
});

describe("host matching", () => {
  it("accepts the project ref and the full host, however decorated", () => {
    const host = "stagingprojectref00.supabase.co";
    expect(hostMatchesDeclaration(host, STAGING_REF)).toBe(true);
    expect(hostMatchesDeclaration(host, host)).toBe(true);
    expect(hostMatchesDeclaration(host, `\`${host}\`.`)).toBe(true);
    expect(hostMatchesDeclaration(host, `https://${host}/`)).toBe(true);
    expect(hostMatchesDeclaration(host, "  STAGINGPROJECTREF00  ")).toBe(true);
  });

  it("refuses a near miss rather than matching on a prefix", () => {
    const host = "stagingprojectref00.supabase.co";
    expect(hostMatchesDeclaration(host, "stagingprojectref")).toBe(false);
    expect(hostMatchesDeclaration(host, "stagingprojectref00-prod")).toBe(false);
    expect(hostMatchesDeclaration(host, "otherref.supabase.co")).toBe(false);
    expect(hostMatchesDeclaration(host, "")).toBe(false);
  });

  it("refuses a foreign domain that merely shares the declared ref", () => {
    // A bare ref names a Supabase project, so it resolves against that
    // domain and nothing else; `<ref>.somewhere-else.tld` is a different
    // service that happens to share a first label.
    expect(
      hostMatchesDeclaration(`${STAGING_REF}.evil.example`, STAGING_REF),
    ).toBe(false);
    expect(hostMatchesDeclaration(`${STAGING_REF}.local`, STAGING_REF)).toBe(
      false,
    );
    // A host outside the Supabase domain is reachable only by declaring it
    // in full — the escape hatch stays open for a self-hosted target.
    expect(
      hostMatchesDeclaration(
        `${STAGING_REF}.evil.example`,
        `${STAGING_REF}.evil.example`,
      ),
    ).toBe(true);
  });
});

describe("the live guard", () => {
  const services = servicesDeclaring(STAGING_REF);

  it("refuses and names the url when it is unset", () => {
    expect(() =>
      resolveStagingTarget({ url: undefined, key: A_KEY, names: NAMES, services }),
    ).toThrow(new RegExp(URL_NAME));
  });

  it("refuses and names the service-role name when it is unset", () => {
    expect(() =>
      resolveStagingTarget({ url: STAGING_URL, key: undefined, names: NAMES, services }),
    ).toThrow(new RegExp(KEY_NAME));
  });

  it("names both when both are missing, and treats blank as unset", () => {
    let raised: unknown;
    try {
      resolveStagingTarget({ url: "", key: "   ", names: NAMES, services });
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(LiveGuardError);
    expect((raised as Error).message).toContain(URL_NAME);
    expect((raised as Error).message).toContain(KEY_NAME);
  });

  it("refuses when no staging target is declared", () => {
    expect(() =>
      resolveStagingTarget({
        url: STAGING_URL,
        key: A_KEY,
        names: NAMES,
        services: null,
      }),
    ).toThrow(LiveGuardError);
  });

  it("refuses a host that is not the declared target", () => {
    let raised: unknown;
    try {
      resolveStagingTarget({
        url: "https://someotherproject.supabase.co",
        key: A_KEY,
        names: NAMES,
        services,
      });
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(LiveGuardError);
    // The refusal has to be actionable: both sides of the mismatch.
    expect((raised as Error).message).toContain("someotherproject.supabase.co");
    expect((raised as Error).message).toContain(STAGING_REF);
  });

  it("refuses a url that is not a url, without echoing it", () => {
    const secretish = "not-a-url-but-still-someones-value";
    let raised: unknown;
    try {
      resolveStagingTarget({
        url: secretish,
        key: A_KEY,
        names: NAMES,
        services,
      });
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(LiveGuardError);
    expect((raised as Error).message).not.toContain(secretish);
  });

  it("resolves the host and the ref when the declaration matches", () => {
    const target = resolveStagingTarget({
      url: STAGING_URL,
      key: A_KEY,
      names: NAMES,
      services,
    });
    expect(target.host).toBe("stagingprojectref00.supabase.co");
    expect(target.ref).toBe(STAGING_REF);
    expect(target.declared).toBe(STAGING_REF);
    expect(target.url).toBe(STAGING_URL);
  });

  it("never leaks the key into a refusal", () => {
    for (const services_ of [null, servicesDeclaring("someone-else")]) {
      try {
        resolveStagingTarget({
          url: STAGING_URL,
          key: A_KEY,
          names: NAMES,
          services: services_,
        });
      } catch (error) {
        expect((error as Error).message).not.toContain(A_KEY);
      }
    }
  });
});

describe("the parity mechanism", () => {
  const card = (label: string, value: number | string | null) =>
    render(h(StatCard, { label, value }));

  it("reads the number a card renders under its label", () => {
    expect(readNumber(card("Open decisions", 7), "Open decisions")).toBe(7);
  });

  it("reads a thousand-separated figure back as a number", () => {
    expect(readNumber(card("Events", 12_345), "Events")).toBe(12345);
  });

  it("ignores a sub-detail line that is not the figure", () => {
    const markup = render(
      h(StatCard, { label: "Open decisions", value: 4, sub: "3 sources" }),
    );
    expect(readNumber(markup, "Open decisions")).toBe(4);
  });

  it("reports absence as absence, not as zero", () => {
    expect(() => readNumber(card("Open decisions", null), "Open decisions"))
      .toThrow(MarkupReadError);
    expect(() => readNumber(card("Open decisions", null), "Open decisions"))
      .toThrow(new RegExp(EM_DASH));
  });

  it("refuses a label the markup does not show", () => {
    expect(() => readNumber(card("Open decisions", 7), "Open signals"))
      .toThrow(MarkupReadError);
  });

  it("refuses an ambiguous label rather than picking one", () => {
    const markup =
      card("Open decisions", 7) + card("Open decisions", 9);
    expect(() => readNumber(markup, "Open decisions")).toThrow(MarkupReadError);
  });

  it("passes when the rendered number equals the independent count", async () => {
    await expect(
      assertParity({
        markup: card("Open decisions", 7),
        label: "Open decisions",
        expected: () => 7,
      }),
    ).resolves.toBe(7);
  });

  it("fails naming both numbers when they disagree", async () => {
    const failure = await assertParity({
      markup: card("Open decisions", 7),
      label: "Open decisions",
      expected: async () => 8,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ParityError);
    expect((failure as ParityError).rendered).toBe(7);
    expect((failure as ParityError).expected).toBe(8);
  });

  it("throws rather than counting zero when the test's own query errors", async () => {
    const db = stubClient({
      review_items: { error: { code: "42501", message: "permission denied" } },
    }).asSupabaseClient();

    await expect(
      countRows(() =>
        db.from("review_items").select("*", { head: true, count: "exact" }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses to build its own client when the setup did not run", async () => {
    vi.resetModules();
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const fresh = await import("../live/parity");
    expect(() => fresh.independentClient()).toThrow(/SUPABASE_URL/);
  });

  it("returns zero only when the database actually counted zero", async () => {
    // "Only" is the whole property: a counted zero resolves, and an answer
    // that carried no count at all does NOT resolve to the same zero.
    const counted = stubClient({ review_items: { count: 0 } }).asSupabaseClient();
    await expect(
      countRows(() =>
        counted.from("review_items").select("*", { head: true, count: "exact" }),
      ),
    ).resolves.toBe(0);

    const uncounted = stubClient({ review_items: {} }).asSupabaseClient();
    await expect(
      countRows(() =>
        uncounted.from("review_items").select("*", { head: true, count: "exact" }),
      ),
    ).rejects.toThrow(ParityCountError);
  });

  // Regression guard for admin-window/BUG-0007.
  it("refuses a count the database never returned, instead of fabricating zero", async () => {
    // The query a page ticket writes when it forgets `count: "exact"`:
    // PostgREST answers with no error AND no count. `countRows` promises the
    // opposite of this ("a parity test must never quietly compare against 0
    // because its own query broke", tests/live/parity.ts) — and the whole
    // mechanism is worthless if the second path can be a fabricated zero.
    const db = stubClient({ review_items: {} }).asSupabaseClient();

    await expect(
      countRows(() => db.from("review_items").select("*")),
    ).rejects.toThrow();
  });

  // The same defect seen from the mechanism (admin-window/BUG-0007).
  it("does not pass parity by comparing a page's zero against a count it never got", async () => {
    const db = stubClient({ review_items: {} }).asSupabaseClient();

    const outcome = await assertParity({
      markup: card("Open decisions", 0),
      label: "Open decisions",
      expected: () => countRows(() => db.from("review_items").select("*")),
    }).then(
      () => "parity passed",
      () => "refused",
    );

    expect(outcome).toBe("refused");
  });
});

describe("the sweep", () => {
  it("puts back the values it recorded", async () => {
    const stub = stubClient({ events: { data: { title: "before" } } });
    const db = stub.asSupabaseClient();

    await withSweep(db, async (sweep) => {
      await sweep.restore("events", { id: 1 }, ["title"]);
      expect(sweep.pending).toBe(1);
    });

    const update = stub.calls.find((call) =>
      call.steps.some((step) => step.method === "update"),
    );
    expect(update?.table).toBe("events");
    expect(
      update?.steps.find((step) => step.method === "update")?.args[0],
    ).toEqual({ title: "before" });
    expect(
      update?.steps.find((step) => step.method === "match")?.args[0],
    ).toEqual({ id: 1 });
  });

  it("sweeps even when the body fails, and still reports the body's failure", async () => {
    const stub = stubClient({ events: { data: { title: "before" } } });
    const db = stub.asSupabaseClient();
    const boom = new Error("assertion failed mid-test");

    await expect(
      withSweep(db, async (sweep) => {
        await sweep.restore("events", { id: 1 }, ["title"]);
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(
      stub.calls.some((call) =>
        call.steps.some((step) => step.method === "update"),
      ),
    ).toBe(true);
  });

  it("deletes a row that did not exist when it was recorded", async () => {
    const stub = stubClient({ verdicts: { data: null } });
    const db = stub.asSupabaseClient();

    await withSweep(db, async (sweep) => {
      await sweep.restore("verdicts", { id: 9 }, ["kind"]);
    });

    expect(
      stub.calls.some((call) =>
        call.steps.some((step) => step.method === "delete"),
      ),
    ).toBe(true);
  });

  it("deletes what `remove` recorded", async () => {
    const stub = stubClient({ verdicts: { data: null } });
    const db = stub.asSupabaseClient();

    await withSweep(db, async (sweep) => {
      sweep.remove("verdicts", { id: 9 });
      expect(sweep.pending).toBe(1);
    });

    const deletion = stub.calls.find((call) =>
      call.steps.some((step) => step.method === "delete"),
    );
    expect(deletion?.table).toBe("verdicts");
  });

  it("undoes newest first", async () => {
    const stub = stubClient({ verdicts: { data: null } });
    const sweep = createSweep(stub.asSupabaseClient());
    sweep.remove("verdicts", { id: 1 });
    sweep.remove("verdicts", { id: 2 });
    await sweep.run();

    const ids = stub.calls
      .filter((call) => call.steps.some((step) => step.method === "delete"))
      .map(
        (call) =>
          (call.steps.find((step) => step.method === "match")?.args[0] as {
            id: number;
          }).id,
      );
    expect(ids).toEqual([2, 1]);
    expect(sweep.pending).toBe(0);
  });

  it("makes a failed restore loud, because residue is a failure", async () => {
    const stub = stubClient({
      events: [{ data: { title: "before" } }, { error: { message: "no write" } }],
    });

    await expect(
      withSweep(stub.asSupabaseClient(), async (sweep) => {
        await sweep.restore("events", { id: 1 }, ["title"]);
      }),
    ).rejects.toThrow(SweepError);
  });

  it("reports the body failure and the sweep failure together", async () => {
    const stub = stubClient({
      events: [{ data: { title: "before" } }, { error: { message: "no write" } }],
    });
    const boom = new Error("assertion failed mid-test");

    const failure = await withSweep(stub.asSupabaseClient(), async (sweep) => {
      await sweep.restore("events", { id: 1 }, ["title"]);
      throw boom;
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    const errors = (failure as AggregateError).errors;
    expect(errors[0]).toBe(boom);
    expect(errors[1]).toBeInstanceOf(SweepError);
  });
});

describe("npm run test:live", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");

  it("refuses, non-zero, naming the missing name — and never falls back", () => {
    // Both STAGING names are present-but-empty, which `dotenv` will not
    // override, so this case is decided by the guard and not by whatever
    // `.env` holds on this machine. The app's own names are set to a decoy:
    // if the setup ever fell back to them, this run would proceed.
    const run = spawnSync(
      path.join(repoRoot, "node_modules", ".bin", "vitest"),
      ["run", "--project=live"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "true",
          STAGING_SUPABASE_URL: "",
          STAGING_SUPABASE_SERVICE_ROLE_KEY: "",
          SUPABASE_URL: "https://decoy.invalid",
          SUPABASE_SERVICE_ROLE_KEY: "decoy-not-a-key",
        },
      },
    );
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

    expect(run.status).not.toBe(0);
    expect(output).toContain(URL_NAME);
    expect(output).toContain(KEY_NAME);
    // The refusal must come from the guard, not from an empty project.
    expect(output).not.toContain("No test files found");
    expect(output).not.toContain("decoy.invalid");
  }, 180_000);
});

/* ── the state classifier (admin-window/TASK-0032) ────────────────────────── */

/** One row of the table the classifier reads as an `ok` surface. */
type StateRow = { id: string };

describe("the state classifier", () => {
  /**
   * The markup under test is rendered from the REAL primitives, not typed by
   * hand: the whole point of `data-state` is that the four `ui` cards emit it,
   * so a hand-written state attribute would prove the test, not the app.
   */
  const empty = () =>
    render(h(Empty, { holds: "open decisions", filledBy: "the resolver files one" }));
  const notProvisioned = () =>
    render(
      h(NotProvisioned, {
        missing: "review_items",
        arrivesWith: "the scraper repo's migration",
      }),
    );
  const errorLine = () =>
    render(
      h(ErrorLine, {
        reading: "review_items",
        failed: "canceling statement due to statement timeout",
        retry: "Reload to try the read again.",
      }),
    );
  const rows = () =>
    render(
      h(DataTable<StateRow>, {
        label: "items",
        columns: [{ key: "id", label: "id", cell: (row: StateRow) => row.id }],
        rows: [{ id: "one" }],
        rowKey: (row: StateRow) => row.id,
      }),
    );

  /** A page-shaped fragment: one named surface holding one body. */
  const surface = (body: string, attrs = 'data-surface="q"') =>
    `<div ${attrs}>${body}</div>`;
  const SURFACE = "[data-surface]";

  it("names each of the four cards by what it emits, not by what it says", () => {
    expect(stateOf(surface(empty()), SURFACE)).toBe("empty");
    expect(stateOf(surface(notProvisioned()), SURFACE)).toBe("not_provisioned");
    expect(stateOf(surface(errorLine()), SURFACE)).toBe("error");
    expect(stateOf(surface(rows()), SURFACE)).toBe("ok");
  });

  it("tells an empty surface from an unprovisioned one, which prose cannot", () => {
    // The two draw the same container and differ only in their WORDS, which is
    // why the old oracle graded an honest EMPTY page as an unprovisioned one
    // (`/queues`, `/sources`). Structurally they are never the same thing.
    expect(stateOf(surface(empty()), SURFACE)).not.toBe(
      stateOf(surface(notProvisioned()), SURFACE),
    );
  });

  // The regression this ticket exists for: 4 of 6 live cases passed against a
  // page in its ERROR state, because the fallback branch only asked that the
  // markup mention the object — which the red line carries exactly as well as
  // the gray card does.
  it("refuses to let an ERROR page satisfy a not-provisioned expectation", () => {
    const broken = surface(errorLine());

    // Prose cannot tell them apart — both name the object, verbatim:
    expect(broken).toContain("review_items");
    expect(surface(notProvisioned())).toContain("review_items");

    // The kind can, and an error is never a not-provisioned pass.
    expect(stateOf(broken, SURFACE)).toBe("error");
    expect(() => assertState(broken, SURFACE, "not_provisioned")).toThrow(
      StateMismatchError,
    );
    // …nor an empty one, nor an ok one.
    expect(() => assertState(broken, SURFACE, "empty")).toThrow(StateMismatchError);
    expect(() => assertState(broken, SURFACE, "ok")).toThrow(StateMismatchError);
    expect(() => assertState(broken, SURFACE, "error")).not.toThrow();
  });

  it("says which kind it found, and what the page said, when it refuses", () => {
    const failure = (() => {
      try {
        assertState(surface(errorLine()), SURFACE, "ok");
        return null;
      } catch (thrown) {
        return thrown as StateMismatchError;
      }
    })();
    expect(failure).toBeInstanceOf(StateMismatchError);
    expect(failure?.found).toBe("error");
    expect(failure?.expected).toBe("ok");
    // The read and the database's own words reach the message — rule 6.
    expect(failure?.message).toContain("review_items");
    expect(failure?.message).toContain("statement timeout");
  });

  it("reads a wrapper's own declared kind, and refuses one that contradicts its card", () => {
    // The idiom `[data-queue]` and the Cycles runs surface already carry.
    expect(
      stateOf(surface(empty(), 'data-surface="q" data-state="empty"'), SURFACE),
    ).toBe("empty");
    expect(stateOf(surface(rows(), 'data-surface="q" data-state="ok"'), SURFACE)).toBe(
      "ok",
    );
    // A declaration that contradicts the card inside it is unreadable markup.
    expect(() =>
      stateOf(surface(empty(), 'data-surface="q" data-state="ok"'), SURFACE),
    ).toThrow(MarkupReadError);
  });

  it("lets an ERROR card outrank the wrapper's declaration rather than refusing", () => {
    // admin-window/BUG-0035: a block that rendered an error line IS in its
    // error state whatever it declares — and saying so lets the failure carry
    // the read and the database's own words (rule 6), which a refusal about
    // contradictory markup buried.
    const declared = surface(errorLine(), 'data-surface="q" data-state="ok"');
    expect(stateOf(declared, SURFACE)).toBe("error");
    expect(() => assertState(declared, SURFACE, "ok")).toThrow(StateMismatchError);
    expect(() => assertState(declared, SURFACE, "ok")).toThrow(/review_items/);
    expect(() => assertState(declared, SURFACE, "error")).not.toThrow();
  });

  it("names the kind that dominates a surface holding several cards", () => {
    // An error is never outvoted by a sibling read that answered; an object
    // that could not be read outranks an emptiness; `ok` is only the answer
    // where the surface carries no card at all (admin-window/BUG-0035).
    expect(stateOf(surface(empty() + errorLine()), SURFACE)).toBe("error");
    expect(stateOf(surface(notProvisioned() + errorLine()), SURFACE)).toBe("error");
    expect(stateOf(surface(rows() + empty() + errorLine()), SURFACE)).toBe("error");
    expect(stateOf(surface(empty() + notProvisioned()), SURFACE)).toBe(
      "not_provisioned",
    );
    expect(stateOf(surface(rows() + empty()), SURFACE)).toBe("empty");
    expect(stateOf(surface(rows()), SURFACE)).toBe("ok");
    // And the same surface satisfies no expectation but the one it is in.
    for (const expected of ["ok", "empty", "not_provisioned"] as const) {
      expect(() => assertState(surface(empty() + errorLine()), SURFACE, expected)).toThrow(
        StateMismatchError,
      );
    }
  });

  it("refuses a data-state value outside the four kinds, naming the value", () => {
    // The hyphen misspelling this codebase's attribute idiom invites
    // (`data-bucket-claims`, `data-window-limit`): skipping it graded an
    // unprovisioned surface green (admin-window/BUG-0035).
    const typo = surface('<div data-state="not-provisioned">review_items</div>');
    expect(() => stateOf(typo, SURFACE)).toThrow(MarkupReadError);
    expect(() => stateOf(typo, SURFACE)).toThrow(/not-provisioned/);
    // A fifth state nobody taught the oracle about, wherever it sits.
    expect(() => stateOf(surface('<p data-state="degraded">slow</p>'), SURFACE)).toThrow(
      /degraded/,
    );
    expect(() =>
      stateOf(surface(rows(), 'data-surface="q" data-state="degraded"'), SURFACE),
    ).toThrow(/degraded/);
    expect(() => pageStates('<p data-state="degraded">slow</p>')).toThrow(
      MarkupReadError,
    );
  });

  it("lists every card the page carries, in document order", () => {
    expect(pageStates(empty() + errorLine() + notProvisioned())).toEqual([
      "empty",
      "error",
      "not_provisioned",
    ]);
    expect(pageStates(rows())).toEqual([]);
  });

  it("refuses a page still loading rather than calling it a fifth verdict", () => {
    const loading = render(h(Loading, { what: "review items" }));
    expect(loading).toContain("loading");
    expect(() => pageStates(loading)).toThrow(MarkupReadError);
    expect(() => stateOf(surface(loading), SURFACE)).toThrow(/LOADING/i);
  });

  it("refuses a surface that is not there, and one the selector cannot single out", () => {
    expect(() => stateOf(surface(empty()), "[data-nothing]")).toThrow(MarkupReadError);
    expect(() => stateOf(surface(empty()) + surface(rows()), SURFACE)).toThrow(
      MarkupReadError,
    );
    // …and it says so only when the selector really did match more than one:
    // a single surface holding two cards is a state, not a selector fault
    // (admin-window/BUG-0035).
    expect(() => stateOf(surface(empty()) + surface(rows()), SURFACE)).toThrow(
      /more than one|2 surfaces/,
    );
    const contradiction = (() => {
      try {
        stateOf(surface(empty(), 'data-surface="q" data-state="ok"'), SURFACE);
        return "";
      } catch (thrown) {
        return (thrown as Error).message;
      }
    })();
    expect(contradiction).toContain("disagree");
    expect(contradiction).not.toContain("more than one surface");
  });

  it("leaves a sub-surface's own state to the sub-surface", () => {
    // A dial embedded in an evidence view is its own read; its failure is not
    // the evidence's failure (admin-window/TASK-0032, review-item's oracle).
    const withDial = surface(rows() + `<div data-dial>${errorLine()}</div>`);
    expect(stateOf(withDial, SURFACE)).toBe("error");
    expect(stateOf(withDial, SURFACE, "[data-dial]")).toBe("ok");
    // …however deep inside the surface the sub-surface sits, and whether the
    // excluded element carries the state itself or wraps the card that does.
    const nested = surface(rows() + `<section><div data-dial>${errorLine()}</div></section>`);
    expect(stateOf(nested, SURFACE, "[data-dial]")).toBe("ok");
  });

  it("excludes only PROPER DESCENDANTS, never the surface or a wrapper of it", () => {
    // admin-window/BUG-0036: the card scan walks every ancestor of a card, so
    // an exclusion selector matching the surface itself — or the page around
    // it — used to drop every card the surface held and grade an error line
    // `ok`. An exclusion may silence a sub-surface's read, never the surface's
    // own.
    const held = surface(errorLine());
    expect(stateOf(held, SURFACE, SURFACE)).toBe("error");
    expect(stateOf(`<main data-page>${held}</main>`, SURFACE, "[data-page]")).toBe(
      "error",
    );
    // The same bound holds for the kinds that are not failures: an exclusion
    // that names no sub-surface changes no verdict at all.
    expect(stateOf(surface(empty()), SURFACE, SURFACE)).toBe("empty");
    expect(stateOf(surface(notProvisioned()), SURFACE, "[data-surface]")).toBe(
      "not_provisioned",
    );
  });
});

describe("grading a surface against the test's own count", () => {
  const card = (label: string, value: number) => render(h(StatCard, { label, value }));
  const wrap = (body: string) => `<div data-surface="q">${body}</div>`;
  const SURFACE = "[data-surface]";
  const emptyCard = render(
    h(Empty, { holds: "open decisions", filledBy: "the resolver files one" }),
  );
  const errorCard = render(
    h(ErrorLine, { reading: "review_items", failed: "57014", retry: "Reload." }),
  );
  const absentCard = render(
    h(NotProvisioned, { missing: "review_items", arrivesWith: "a migration" }),
  );
  const table = render(
    h(DataTable<StateRow>, {
      label: "items",
      columns: [{ key: "id", label: "id", cell: (row: StateRow) => row.id }],
      rows: [{ id: "one" }],
      rowKey: (row: StateRow) => row.id,
    }),
  );

  const grade = (markup: string, counted: number | "absent", figure?: string) =>
    gradeSurface({
      markup,
      within: SURFACE,
      object: "review_items",
      counted,
      figure,
    });

  it("passes an EMPTY surface with a counted zero, and its figure reading 0", async () => {
    await expect(
      grade(wrap(card("Open decisions", 0) + emptyCard), 0, "Open decisions"),
    ).resolves.toBe("empty");
  });

  it("fails an EMPTY surface whose figure is not the zero it counted", async () => {
    // A figure that disappears at zero, or shows something else, is the half of
    // rule 2 that makes an emptiness a NUMBER rather than an absence.
    await expect(
      grade(wrap(card("Open decisions", 3) + emptyCard), 0, "Open decisions"),
    ).rejects.toThrow(ParityError);
    await expect(grade(wrap(emptyCard), 0, "Open decisions")).rejects.toThrow(
      MarkupReadError,
    );
  });

  it("fails an EMPTY surface the database says holds rows, and the reverse", async () => {
    await expect(grade(wrap(emptyCard), 4)).rejects.toThrow(StateMismatchError);
    await expect(grade(wrap(table), 0)).rejects.toThrow(StateMismatchError);
  });

  it("fails an ERROR surface whatever the count says", async () => {
    for (const counted of [0, 7, "absent"] as const) {
      await expect(grade(wrap(errorCard), counted)).rejects.toThrow(StateMismatchError);
    }
    // …and the refusal names the read and what the database said.
    await expect(grade(wrap(errorCard), 0)).rejects.toThrow(/review_items/);
  });

  it("passes NOT_PROVISIONED only on the test's own absence code", async () => {
    await expect(grade(wrap(absentCard), "absent")).resolves.toBe("not_provisioned");
    // Counted rows against a not-provisioned card is the inference rule 5
    // forbids — and the check would need a live client, which offline has none
    // of, so it refuses rather than passing.
    await expect(grade(wrap(absentCard), 0)).rejects.toThrow();
  });

  it("fails a surface that rendered anything at all when the object is absent", async () => {
    await expect(grade(wrap(table), "absent")).rejects.toThrow(StateMismatchError);
    await expect(grade(wrap(emptyCard), "absent")).rejects.toThrow(StateMismatchError);
  });

  it("counts a zero as OK where the surface states its figure at zero", async () => {
    // The Dashboard's attention cards: two figures in fixed positions, whatever
    // the morning holds (LOOK_AND_FEEL bar 1). Their zero is `ok`, not `empty`.
    await expect(
      gradeSurface({
        markup: wrap(card("Open decisions", 0)),
        within: SURFACE,
        object: "review_items",
        counted: 0,
        emptyAtZero: false,
        figure: "Open decisions",
      }),
    ).resolves.toBe("ok");
  });
});

describe("parity, once the kind is named", () => {
  const wrap = (body: string) => `<div data-surface="q">${body}</div>`;
  const SURFACE = "[data-surface]";

  it("names the state kind before it reads the number", async () => {
    // The failure a page in its error state must produce is a STATE failure,
    // never the MarkupReadError of a number that was never rendered — that is
    // how a test used to discover the page was broken, and it read as a
    // parsing problem.
    const broken = wrap(
      render(
        h(ErrorLine, { reading: "review_items", failed: "57014", retry: "Reload." }),
      ),
    );
    const failure = await assertParity({
      markup: broken,
      within: SURFACE,
      label: "Open decisions",
      expected: () => 3,
    }).catch((thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(StateMismatchError);
    expect(failure).not.toBeInstanceOf(MarkupReadError);
  });

  it("refuses a page carrying an error anywhere when no surface is named", async () => {
    const page =
      render(h(StatCard, { label: "Open decisions", value: 3 })) +
      render(h(ErrorLine, { reading: "runs", failed: "57014", retry: "Reload." }));
    await expect(
      assertParity({ markup: page, label: "Open decisions", expected: () => 3 }),
    ).rejects.toThrow(StateMismatchError);
  });

  it("still compares the number once the kind is the expected one", async () => {
    const page = wrap(render(h(StatCard, { label: "Open decisions", value: 3 })));
    await expect(
      assertParity({
        markup: page,
        within: SURFACE,
        label: "Open decisions",
        expected: () => 3,
      }),
    ).resolves.toBe(3);
    await expect(
      assertParity({
        markup: page,
        within: SURFACE,
        label: "Open decisions",
        expected: () => 4,
      }),
    ).rejects.toThrow(ParityError);
  });
});

describe("the count a live test issues", () => {
  const HEAD_SHAPED = new RegExp("head:\\s*true");

  it("is GET-shaped, so a failure comes back with a body", async () => {
    const db = stubClient({ review_items: { count: 2 } });
    await countRows(() => exactCount("review_items", db.asSupabaseClient()));

    const steps = db.calls[0].steps;
    const select = steps.find((step) => step.method === "select");
    expect(select?.args[1]).toEqual({ count: "exact" });
    // `head` is what emptied the error, and it is gone from the shape.
    expect(JSON.stringify(select?.args)).not.toContain("head");
    // A range keeps the body to one row: enough to carry an error, not a scan.
    expect(steps.map((step) => step.method)).toContain("range");
  });

  it("reports the database's own code for a failed count", async () => {
    // The measured failure: `pending_claims` times out at ~8.1s on staging
    // (57014, admin-window/TASK-0031). Through a GET-shaped count the code and
    // the message both arrive.
    const db = stubClient({ pending_claims: { error: statementTimeout() } });
    const failure = await countRows(() =>
      exactCount("pending_claims", db.asSupabaseClient()),
    ).then(
      (counted) => new Error(`the count resolved to ${counted}`),
      (thrown: unknown) => thrown as Error,
    );

    expect(failure.message).toContain("57014");
    expect(failure.message).toContain("statement timeout");
  });

  it("says it could not tell, rather than reporting a blank", async () => {
    // The SAME failure as a head-shaped count received it: no body, so no code
    // and an empty message. A timeout reported as "" is the defect.
    const db = stubClient({ pending_claims: { error: unparseableFailure() } });
    const failure = await countRows(() =>
      exactCount("pending_claims", db.asSupabaseClient()),
    ).then(
      (counted) => new Error(`the count resolved to ${counted}`),
      (thrown: unknown) => thrown as Error,
    );

    expect(failure.message).toMatch(/no parseable error/);
    expect(failure.message.trim()).not.toMatch(/failed:$/);
  });

  it("answers 'absent' for the absence code, and rethrows anything else", async () => {
    const absent = stubClient({
      review_items: { error: { code: "PGRST205", message: "not in schema cache" } },
    });
    await expect(
      countOrAbsent(() => exactCount("review_items", absent.asSupabaseClient())),
    ).resolves.toBe("absent");

    const timedOut = stubClient({ review_items: { error: statementTimeout() } });
    await expect(
      countOrAbsent(() => exactCount("review_items", timedOut.asSupabaseClient())),
    ).rejects.toThrow(/57014/);
  });

  it("leaves no head-shaped count on any query a live TEST issues", () => {
    // The rule, stated where it can be checked: a count the test writes —
    // anything built from `independentClient()` — is never head-shaped, because
    // a HEAD response carries no body and its failures arrive blank. The app's
    // own read path is not covered: `lib/db` counts with `head: true`, and
    // `harness.live.test.ts` exercises it deliberately, in the app's shape.
    //
    // Statement-level and over CODE lines only, so a comment explaining why the
    // head-shaped count is gone does not redden it (ARCHITECTURE §10, common
    // violation 4).
    const dir = "tests/live";
    const offenders = fs
      .readdirSync(path.join(repoRoot, dir))
      .filter((name) => name.endsWith(".ts"))
      .filter((name) =>
        codeLines(`${dir}/${name}`)
          .join("\n")
          .split(";")
          .some(
            (statement) =>
              HEAD_SHAPED.test(statement) && statement.includes("independentClient("),
          ),
      );
    expect(offenders).toEqual([]);
  });
});

/* ── QA attack on the classifier seam (admin-window/TASK-0032) ───────────── */

describe("QA: the classifier, attacked", () => {
  const empty = () =>
    render(h(Empty, { holds: "open decisions", filledBy: "the resolver files one" }));
  const errorLine = () =>
    render(
      h(ErrorLine, {
        reading: "pending_claims",
        failed: "canceling statement due to statement timeout",
        retry: "Reload to try the read again.",
      }),
    );
  const rows = () =>
    render(
      h(DataTable<{ id: string }>, {
        label: "items",
        columns: [{ key: "id", label: "id", cell: (row: { id: string }) => row.id }],
        rows: [{ id: "one" }],
        rowKey: (row: { id: string }) => row.id,
      }),
    );

  /**
   * A surface holding TWO reads — one that came back empty, one that refused.
   * However the classifier answers this, the one answer it may never give is a
   * green one: rule 6 is unconditional, and "the page rendered an error line"
   * is not a fact a second card can outvote. This is the guarantee that holds
   * today (`stateOf` refuses to name a mixed surface at all), and it must
   * still hold when admin-window/BUG-0035 is fixed and `error` wins outright —
   * so it is written against the verdict, not against which refusal arrives.
   *
   * BUG-0035 is now fixed and `error` does win outright: the verdict this test
   * guards is unchanged (never a passing kind), and the last line names the one
   * kind it may be instead of only demanding that something was thrown.
   */
  it("never grades a surface as OK or EMPTY while it carries an error card", () => {
    const both = `<div data-surface="q">${empty()}${errorLine()}</div>`;
    expect(() => assertState(both, "[data-surface]", "ok")).toThrow();
    expect(() => assertState(both, "[data-surface]", "empty")).toThrow();
    expect(() => assertState(both, "[data-surface]", "not_provisioned")).toThrow();
    // And a grade of the same surface never returns a passing kind either.
    expect(stateOf(both, "[data-surface]")).toBe("error");
  });

  // ── admin-window/BUG-0035: QA's three pins, written as strict expected
  // failures against the broken classifier and converted to plain `it` by the
  // fix. Each still attacks exactly what it attacked; only the third's
  // assertion moved, because the fixed classifier REFUSES an unknown value
  // rather than returning a kind, so a probe that grades its return value can
  // no longer reach one.

  it("admin-window/BUG-0035: a wrapper's declared kind never outranks an ERROR card inside it", () => {
    // The declaration used to be cross-checked against the card only when
    // there was exactly ONE distinct kind inside, so a surface with two reads
    // took the wrapper's word — and passed on a page in its error state.
    const declared = `<div data-surface="q" data-state="ok">${empty()}${errorLine()}</div>`;
    expect(() => assertState(declared, "[data-surface]", "ok")).toThrow();
    expect(stateOf(declared, "[data-surface]")).toBe("error");
  });

  it("admin-window/BUG-0035: an unknown data-state is refused, not skipped", () => {
    // `pageStates` promised this in its own docstring while doing the
    // opposite: "silently ignoring it is how a broken page goes green."
    const fifth = `<div data-surface="q"><p data-state="degraded">slow</p>${rows()}</div>`;
    expect(() => pageStates(fifth)).toThrow(MarkupReadError);
    expect(() => stateOf(fifth, "[data-surface]")).toThrow(/degraded/);
  });

  it("admin-window/BUG-0035: a hyphen-misspelled not_provisioned card never reads as OK", () => {
    // The typo this codebase's attribute idiom invites (`data-bucket-claims`,
    // `data-window-limit`): one character, and an unprovisioned surface graded
    // green. It now refuses naming the value — so the probe asserts the
    // refusal, which is the strict form of "not ok": there is no verdict at
    // all to be green.
    const typo = `<div data-surface="q"><div data-state="not-provisioned">review_items</div></div>`;
    expect(() => stateOf(typo, "[data-surface]")).toThrow(MarkupReadError);
    expect(() => stateOf(typo, "[data-surface]")).toThrow(/not-provisioned/);
  });

  // admin-window/BUG-0036: QA's pin, written as a strict expected failure
  // against the broken classifier and converted to a plain `it` by the fix.
  // It attacks exactly what it attacked; the exclusion is now confined to
  // proper sub-surfaces of the graded surface, so the surface's own error
  // line can no longer be silenced by a selector.
  it("admin-window/BUG-0036: an `excluding` selector that also matches the surface hides its ERROR card", () => {
    // `excluding` names SUB-SURFACES inside the graded surface, and the card
    // scan drops a card whose `closest(excluding)` matches — but `closest`
    // starts at the card and walks EVERY ancestor, the surface itself and the
    // page around it included. So an exclusion selector that also matches the
    // surface (or anything wrapping it) drops every card the surface holds,
    // and a surface rendering nothing but an error line grades OK.
    const broken = `<div data-surface="q">${errorLine()}</div>`;
    expect(stateOf(broken, "[data-surface]")).toBe("error");
    expect(stateOf(broken, "[data-surface]", "[data-surface]")).toBe("error");
    expect(() => assertState(broken, "[data-surface]", "ok")).toThrow();
  });
});

/**
 * `whileStill` had no test of any kind, and three live files pin their row
 * comparisons with it (dashboard, cycles, runs). What it must never do is hand
 * back a pair the database moved under — a retry-until-green would turn a
 * dropped row into a pass.
 */
describe("QA: whileStill, attacked", () => {
  it("hands back a pair only when the read did not move around the make", async () => {
    const order: string[] = [];
    const outcome = await whileStill(
      async () => {
        order.push("read");
        return { rows: 38 };
      },
      async () => {
        order.push("make");
        return "markup";
      },
    );
    expect(outcome).toEqual({ made: "markup", held: { rows: 38 } });
    // The make happens BETWEEN the two reads, or the pair proves nothing.
    expect(order).toEqual(["read", "make", "read"]);
  });

  it("refuses rather than comparing across a move, and re-makes every attempt", async () => {
    let tick = 0;
    let makes = 0;
    const attempt = whileStill(
      async () => ({ rows: 38 + tick++ }),
      async () => {
        makes += 1;
        return "markup";
      },
      3,
    );
    await expect(attempt).rejects.toThrow(/changed under this comparison/);
    // Every attempt makes the SAME comparison afresh — never a stale render
    // compared against a newer read.
    expect(makes).toBe(3);
  });

  it("settles once the database does, without lowering what it compares", async () => {
    let tick = 0;
    const outcome = await whileStill(
      async () => {
        tick += 1;
        return { rows: tick <= 2 ? tick : 9 };
      },
      async () => "markup",
      4,
    );
    expect(outcome.held).toEqual({ rows: 9 });
  });
});
