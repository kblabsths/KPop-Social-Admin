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
  MarkupReadError,
  StateMismatchError,
  assertState,
  oneEach,
  pageStates,
  readNumber,
  stateOf,
  surfaceHooks,
} from "../fixtures/surface-state";
import { codeLinesIn, repoRoot } from "./source-tree";
import {
  LiveGuardError,
  declaredStagingTarget,
  hostMatchesDeclaration,
  resolveStagingTarget,
} from "../live/staging-target";
import { RESET_CALLER_NAME } from "../walk/reset-sandbox.mjs";
import { h, render } from "./ui/markup";

/**
 * The live harness, proved OFFLINE (campaign admin-window, TASK-0003), and
 * the rules the live tier lives under (Ben's testing rules of 2026-09-16,
 * installed 2026-10-16 — README "Testing", ARCHITECTURE.md §10).
 *
 * Everything here runs in the default suite, with no database and no
 * `STAGING_*` name in the environment — which is the point: the refusal path
 * is the behaviour that matters most and it must not need staging to be
 * testable. `tests/live/staging-target.ts` is pure for exactly that reason;
 * `tests/live/setup.ts` is the one module with side effects, and the
 * `npm run test:live` case runs the real thing in a child process to prove
 * the wiring.
 *
 * The markup readers the page twins grade a render with (`stateOf`,
 * `surfaceHooks`, `readNumber` — `tests/fixtures/surface-state.ts`) are
 * pinned here too, against markup rendered from the real primitives.
 *
 * The last section is the guard over `tests/live/` itself: one read-only
 * contract smoke, no write-shaped call, every case saying why it is live.
 *
 * No value of any credential appears in this file. The names are the subject.
 */


afterEach(() => {
  vi.unstubAllEnvs();
});

const URL_NAME = "STAGING_SUPABASE_URL";
const KEY_NAME = "STAGING_SUPABASE_SERVICE_ROLE_KEY";
const NAMES = { url: URL_NAME, key: KEY_NAME };

/**
 * The name a refusal is spoken in (admin-window/TASK-0036).
 *
 * The guard has two callers with two different pairs of env names, so it takes
 * the caller's name and every refusal begins with it. This one is deliberately
 * neither real caller: the cases below are about the PARAMETER being honoured,
 * and a fixture that happened to equal a real caller's name would pass even if
 * the name were still hard-coded. The real names are asserted separately —
 * see "a refusal is spoken in the caller's name".
 */
const A_CALLER = "the caller under test";

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
      resolveStagingTarget({ url: undefined, key: A_KEY, names: NAMES, services, caller: A_CALLER }),
    ).toThrow(new RegExp(URL_NAME));
  });

  it("refuses and names the service-role name when it is unset", () => {
    expect(() =>
      resolveStagingTarget({ url: STAGING_URL, key: undefined, names: NAMES, services, caller: A_CALLER }),
    ).toThrow(new RegExp(KEY_NAME));
  });

  it("names both when both are missing, and treats blank as unset", () => {
    let raised: unknown;
    try {
      resolveStagingTarget({ url: "", key: "   ", names: NAMES, services, caller: A_CALLER });
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
        caller: A_CALLER,
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
        caller: A_CALLER,
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
        caller: A_CALLER,
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
      caller: A_CALLER,
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
          caller: A_CALLER,
        });
      } catch (error) {
        expect((error as Error).message).not.toContain(A_KEY);
      }
    }
  });
});

/**
 * The refusals are spoken in the CALLER's name (admin-window/TASK-0036).
 *
 * The guard acquired a second caller — `tests/walk/reset-sandbox.mts`, which
 * reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` out of its own
 * environment — and inherited refusal text that announced the live suite. One
 * branch went further and told the reader that the caller does NOT read those
 * two names, which for the reset tool is the opposite of the truth: a walker
 * who mistyped a name would have been told to fix the thing they did right.
 */
describe("whose refusal is it", () => {
  const services = servicesDeclaring(STAGING_REF);

  /** The four refusal branches, each as the input that provokes it. */
  const branches: ReadonlyArray<{
    what: string;
    input: Parameters<typeof resolveStagingTarget>[0];
  }> = [
    {
      what: "a missing name",
      input: { url: undefined, key: A_KEY, names: NAMES, services, caller: A_CALLER },
    },
    {
      what: "an unparseable URL",
      input: { url: "not-a-url", key: A_KEY, names: NAMES, services, caller: A_CALLER },
    },
    {
      what: "no declaration",
      input: { url: STAGING_URL, key: A_KEY, names: NAMES, services: null, caller: A_CALLER },
    },
    {
      what: "a host that is not the declared one",
      input: {
        url: "https://someotherproject.supabase.co",
        key: A_KEY,
        names: NAMES,
        services,
        caller: A_CALLER,
      },
    },
  ];

  function refusalFrom(input: Parameters<typeof resolveStagingTarget>[0]): string {
    try {
      resolveStagingTarget(input);
    } catch (error) {
      expect(error).toBeInstanceOf(LiveGuardError);
      return (error as Error).message;
    }
    throw new Error("expected a refusal, got a resolved target");
  }

  it("begins every refusal with the caller it was given", () => {
    for (const branch of branches) {
      const message = refusalFrom(branch.input);
      expect(message, branch.what).toMatch(
        new RegExp(`^${A_CALLER} refuses: `),
      );
    }
  });

  it("names a DIFFERENT caller differently, so the name is a parameter", () => {
    // The other half of the pair: the same branch, two callers, two prefixes.
    // Without both, a guard that still hard-coded one name could pass.
    for (const branch of branches) {
      const asReset = refusalFrom({ ...branch.input, caller: RESET_CALLER_NAME });
      expect(asReset, branch.what).toMatch(
        new RegExp(`^${RESET_CALLER_NAME} refuses: `),
      );
      expect(asReset, branch.what).not.toContain(A_CALLER);
    }
  });

  it("says the walk-sandbox reset tool refuses, when that is who asked", () => {
    // The concrete regression: the tool's own name reaches the walker who ran
    // it, rather than a claim about a suite they were not running.
    const message = refusalFrom({
      url: undefined,
      key: undefined,
      names: { url: "SUPABASE_URL", key: "SUPABASE_SERVICE_ROLE_KEY" },
      services,
      caller: RESET_CALLER_NAME,
    });
    expect(message.startsWith("the walk-sandbox reset tool refuses: ")).toBe(true);
    expect(RESET_CALLER_NAME).toBe("the walk-sandbox reset tool");
  });

  it("does not tell a caller it ignores the very names it reads", () => {
    // The reset tool reads exactly SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
    // The missing-name refusal must therefore mention SUPABASE_URL as the name
    // that is unset and NOWHERE else — the old wording named it twice, once as
    // the problem and once as a name the caller supposedly does not consult.
    const message = refusalFrom({
      url: "",
      key: A_KEY,
      names: { url: "SUPABASE_URL", key: "SUPABASE_SERVICE_ROLE_KEY" },
      services,
      caller: RESET_CALLER_NAME,
    });
    expect(message).toContain("SUPABASE_URL");
    expect(message.split("SUPABASE_URL").length - 1).toBe(1);
    expect(message).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    // And it still says the load-bearing thing: no fallback, no default.
    expect(message).toContain("never a fallback");
  });
});

describe("readNumber, the figure a label stands over", () => {
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
    // And it says WHO refused (admin-window/TASK-0036): the guard's caller
    // name is a parameter now, and this is the end-to-end proof that
    // `tests/live/setup.ts` passes its own.
    expect(output).toContain("the live suite refuses");
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
    // …and a sub-surface inside a sub-surface is still the inner one's read.
    const twice = surface(
      rows() + `<div data-dial><div data-dial>${errorLine()}</div></div>`,
    );
    expect(stateOf(twice, SURFACE, "[data-dial]")).toBe("ok");
    // What the exclusion may never reach is a card the SURFACE holds itself:
    // silencing the dial's refusal does not silence the surface's own beside
    // it (admin-window/BUG-0036).
    const both = surface(errorLine() + `<div data-dial>${errorLine()}</div>`);
    expect(stateOf(both, SURFACE, "[data-dial]")).toBe("error");
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
    // The case the two above cannot reach: a selector that matches the surface
    // AND a genuine sub-surface inside it, so the exclusion really has work to
    // do. Each half of the bound holds at once — the surface's own error line
    // survives, and the sub-surface's read is still the sub-surface's.
    const claims = (body: string) => `<div data-surface="claims">${body}</div>`;
    const CLAIMS = '[data-surface="claims"]';
    const sub = `<div data-surface="dial">${notProvisioned()}</div>`;
    expect(stateOf(claims(errorLine() + sub), CLAIMS, SURFACE)).toBe("error");
    expect(
      stateOf(claims(rows() + `<div data-surface="dial">${errorLine()}</div>`), CLAIMS, SURFACE),
    ).toBe("ok");
    // Same for a wrapper selector that matches an ancestor of the surface and
    // a descendant of it in one read: the ancestor match silences nothing.
    const wrapped = `<main data-page>${surface(errorLine() + `<div data-page>${empty()}</div>`)}</main>`;
    expect(stateOf(wrapped, SURFACE, "[data-page]")).toBe("error");
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

describe("QA: surfaceHooks, attacked", () => {
  /**
   * The helper ten files lean on, pinned HERE rather than only through them
   * (campaign admin-window, DEBT-0002).
   *
   * `surfaceHooks` is the precondition every live oracle asserts before it
   * grades anything, and each of the five page twins states its expectation as
   * `oneEach(HOOKS)`. That shape is self-fulfilling: measured 2026-09-03, a
   * `surfaceHooks` stubbed to return `{counts: oneEach(hooks), nested: []}`
   * unconditionally left 54 of 56 offline files GREEN — every `oneEach`
   * assertion passed against a helper that never counted, and the only two
   * failures were the tests that happen to expect a ZERO (the standing tab's
   * absent bucket table, and the review item that has no row). The helper's
   * own three behaviours therefore need saying somewhere that does not use
   * `oneEach` to say them.
   */
  const surface = (name: string, inner = "") =>
    `<section data-surface="${name}">${inner}</section>`;
  const HOOK = (name: string) => `[data-surface="${name}"]`;

  it("counts a duplicated name as more than one — the failure it exists to catch", () => {
    // BUG-0040's shape: a later ticket wraps a window and a second element
    // ends up answering to a name that already had an owner.
    const markup = `<main>${surface("runs")}${surface("runs")}${surface("cycles")}</main>`;
    expect(surfaceHooks(markup, [HOOK("runs"), HOOK("cycles")]).counts).toEqual({
      [HOOK("runs")]: 2,
      [HOOK("cycles")]: 1,
    });
  });

  it("counts a hook nothing answers to as zero, never as one", () => {
    const markup = `<main>${surface("cycles")}</main>`;
    expect(surfaceHooks(markup, [HOOK("runs"), HOOK("cycles")]).counts).toEqual({
      [HOOK("runs")]: 0,
      [HOOK("cycles")]: 1,
    });
  });

  it("reports one named surface swallowing another, and stays silent for siblings", () => {
    // A hook can be unique and still wrong: a surface holding its neighbour
    // grades the neighbour's state cards as its own.
    const siblings = `<main>${surface("what_happened")}${surface("evidence")}</main>`;
    expect(surfaceHooks(siblings, [HOOK("what_happened"), HOOK("evidence")]).nested).toEqual(
      [],
    );

    const swallowed = `<main>${surface("what_happened", surface("evidence"))}</main>`;
    const report = surfaceHooks(swallowed, [HOOK("what_happened"), HOOK("evidence")]);
    // Still one element each — the counts alone would call this healthy.
    expect(report.counts).toEqual({ [HOOK("what_happened")]: 1, [HOOK("evidence")]: 1 });
    expect(report.nested).toEqual([`${HOOK("what_happened")} contains ${HOOK("evidence")}`]);
  });

  it("names the containment in one direction only, so the report says which swallowed which", () => {
    const markup = `<main>${surface("a", surface("b"))}</main>`;
    expect(surfaceHooks(markup, [HOOK("a"), HOOK("b")]).nested).toHaveLength(1);
  });

  it("asks nothing of a page when given no hooks", () => {
    expect(surfaceHooks("<main></main>", [])).toEqual({ counts: {}, nested: [] });
  });

  it("oneEach states the expectation for exactly the hooks it was given", () => {
    expect(oneEach([HOOK("a"), HOOK("b")])).toEqual({ [HOOK("a")]: 1, [HOOK("b")]: 1 });
    expect(oneEach([])).toEqual({});
  });
});

/* ── the live tier is one read-only contract smoke (Ben, 2026-09-16) ─────── */

/**
 * The rules, stated where they can be checked (README "Testing", rules 2–4;
 * installed 2026-10-16 by the external live-tier ticket):
 *
 *  1. No file under `tests/live/` carries a write-shaped call — `.insert(`,
 *     `.upsert(`, `.update(`, `.delete(` — or a request issued with a writing
 *     method, or a procedure call other than the ONE allowlisted refusal: the
 *     empty decision sent to `settle_review_item`, which raises KS029 before
 *     it touches a row (the contract file's header says where that is read).
 *  2. No file under `tests/live/` imports from `tests/walk/` — the walk tools
 *     write `walk_sandbox` by design, and a live test reaching them is a
 *     writer by another name.
 *  3. Every `it(` in a live test file is preceded by a `// LIVE BECAUSE:`
 *     line — one line saying why the question cannot be answered offline.
 *  4. The live tier is `tests/live/contract.live.test.ts` ALONE, of at most
 *     ten cases: a second live file, or an eleventh case, is the oracle suite
 *     growing back (BUG-0215, BUG-0219, BUG-0208 — the incident record).
 *
 * Each rule is a pure function over a file's TEXT, so it is proved red here on
 * a planted string — never on a probe file written into the tree other
 * tree-walking tests are reading (admin-window/BUG-0029's hazard) — and then
 * run over the real directory. Code lines only, so a comment explaining why a
 * write is absent does not redden it (ARCHITECTURE §10, common violation 4);
 * the `LIVE BECAUSE:` rule reads raw lines, because the thing it looks for IS
 * a comment.
 */
describe("the live tier: one read-only contract smoke", () => {
  const LIVE_DIR = "tests/live";
  const CONTRACT_FILE = "contract.live.test.ts";
  const LIVE_TEST_FILE = /\.live\.test\.ts$/;
  const CASE_BUDGET = 10;

  const WRITE_SHAPED = /\.(insert|upsert|update|delete)\(/;
  const PROCEDURE_CALL = /\.rpc\(/;
  const WRITING_METHOD = /method:\s*["'](POST|PATCH|PUT|DELETE)["']/i;
  const WALK_IMPORT = /from\s+["'][^"']*\/walk\//;
  /** The one procedure call a live file may carry: the empty decision, refused. */
  const ALLOWED_REFUSAL =
    /\.rpc\(\s*FN\.settleReviewItem\s*,\s*\{\s*\[SETTLE_ARGUMENT\]:\s*\{\}\s*\}\s*\)/;
  const CASE = /^\s*it(?:\.(?:each|only|skip|todo|concurrent))?\s*\(/;
  const LIVE_BECAUSE = /^\s*\/\/\s*LIVE BECAUSE:\s*\S/;
  const COMMENT_OR_BLANK = /^\s*(?:$|\/\/|\*|\/\*)/;

  /** Rules 1 and 2 over one file's text: every offending code line, named. */
  function writeShapedOffences(name: string, text: string): string[] {
    const offences: string[] = [];
    for (const line of codeLinesIn(text)) {
      if (WRITE_SHAPED.test(line)) offences.push(`${name}: write-shaped: ${line.trim()}`);
      if (WRITING_METHOD.test(line)) offences.push(`${name}: writing method: ${line.trim()}`);
      if (WALK_IMPORT.test(line)) offences.push(`${name}: imports a walk tool: ${line.trim()}`);
      if (PROCEDURE_CALL.test(line) && !ALLOWED_REFUSAL.test(line)) {
        offences.push(`${name}: procedure call outside the allowlisted refusal: ${line.trim()}`);
      }
    }
    return offences;
  }

  /** Rule 3 over one file's text: every `it(` with no `LIVE BECAUSE:` above it. */
  function unexplainedCases(name: string, text: string): string[] {
    const lines = text.split("\n");
    const offences: string[] = [];
    lines.forEach((line, index) => {
      if (!CASE.test(line)) return;
      // Walk up through the comment block (and blank lines) directly above
      // the case; the first code line ends it. The reason has to be IN that
      // block — a reason two cases up explains a different case.
      let explained = false;
      for (let above = index - 1; above >= 0; above -= 1) {
        if (!COMMENT_OR_BLANK.test(lines[above])) break;
        if (LIVE_BECAUSE.test(lines[above])) {
          explained = true;
          break;
        }
      }
      if (!explained) offences.push(`${name}:${index + 1}: ${line.trim()}`);
    });
    return offences;
  }

  const liveFiles = () =>
    fs
      .readdirSync(path.join(repoRoot, LIVE_DIR))
      .filter((name) => name.endsWith(".ts"))
      .sort();
  const textOf = (name: string) =>
    fs.readFileSync(path.join(repoRoot, LIVE_DIR, name), "utf8");

  /* ── the rules, proved red on planted text ─────────────────────────────── */

  it("flags each write shape, a writing method, a walk import and a stray procedure call", () => {
    const planted = [
      'import { resetSandbox } from "../walk/reset-sandbox.mjs";',
      "const a = await db.from(t).insert(row);",
      "const b = await db.from(t).upsert(row);",
      "const c = await db.from(t).update(row).eq(k, v);",
      "const d = await db.from(t).delete().eq(k, v);",
      'const e = await fetch(url, { method: "PATCH", body });',
      "const f = await db.rpc(FN.settleReviewItem, { [SETTLE_ARGUMENT]: decision });",
      'const g = await db.rpc("apply_resolution", {});',
    ].join("\n");
    const offences = writeShapedOffences("planted.live.test.ts", planted);
    expect(offences).toHaveLength(8);
    expect(offences.filter((line) => line.includes("write-shaped"))).toHaveLength(4);
    expect(offences.filter((line) => line.includes("writing method"))).toHaveLength(1);
    expect(offences.filter((line) => line.includes("walk tool"))).toHaveLength(1);
    expect(offences.filter((line) => line.includes("procedure call"))).toHaveLength(2);
  });

  it("lets the allowlisted refusal through, and nothing else that calls a procedure", () => {
    const refusal =
      "const { error } = await getDbClient().rpc(FN.settleReviewItem, { [SETTLE_ARGUMENT]: {} });";
    expect(writeShapedOffences("planted.live.test.ts", refusal)).toEqual([]);
    // One key, one value, one character: a decision that says anything is a
    // settlement attempt, and the allowlist does not stretch to it.
    const filled =
      'const { error } = await getDbClient().rpc(FN.settleReviewItem, { [SETTLE_ARGUMENT]: { action: "settle" } });';
    expect(writeShapedOffences("planted.live.test.ts", filled)).toHaveLength(1);
  });

  it("reads code lines only, so a comment may name the write it explains away", () => {
    const commented = [
      "// There is no .insert( here, and no .rpc( either — this says why.",
      " * nor an .update( in a docblock, nor `method: \"POST\"`.",
      "const rows = await db.from(t).select(c).limit(0);",
    ].join("\n");
    expect(writeShapedOffences("planted.live.test.ts", commented)).toEqual([]);
  });

  it("flags a case with no LIVE BECAUSE above it, and clears one that has it", () => {
    const explained = [
      "describe('x', () => {",
      "  // LIVE BECAUSE: the stub cannot answer this.",
      "  it('asks the service', async () => {});",
      "",
      "  // a different remark",
      "  // LIVE BECAUSE: nor this.",
      "",
      "  it('asks again', async () => {});",
      "});",
    ].join("\n");
    expect(unexplainedCases("planted.live.test.ts", explained)).toEqual([]);

    const unexplained = [
      "describe('x', () => {",
      "  // LIVE BECAUSE: explains the FIRST case only.",
      "  it('asks the service', async () => {});",
      "  it('asks with no reason', async () => {});",
      "  // LIVE BECAUSE: with no colon-and-reason this is",
      "  it.each([1])('asks with a bare marker %s', async () => {});",
      "});",
    ].join("\n");
    const offences = unexplainedCases("planted.live.test.ts", unexplained);
    expect(offences).toHaveLength(1);
    expect(offences[0]).toContain(":4:");
    // A reason that stops at the colon is not a reason.
    expect(unexplainedCases("p.ts", "// LIVE BECAUSE:\nit('bare', () => {});")).toHaveLength(1);
  });

  /* ── the rules, run over the real directory ────────────────────────────── */

  it("is one test file beside the setup and the guard, and nothing else", () => {
    expect(liveFiles()).toEqual([CONTRACT_FILE, "setup.ts", "staging-target.ts"]);
    expect(liveFiles().filter((name) => LIVE_TEST_FILE.test(name))).toEqual([CONTRACT_FILE]);
  });

  it("carries no write-shaped call, no writing method, no walk import and no stray procedure call", () => {
    const offences = liveFiles().flatMap((name) => writeShapedOffences(name, textOf(name)));
    expect(offences).toEqual([]);
  });

  it("explains every case with a LIVE BECAUSE line", () => {
    const offences = liveFiles()
      .filter((name) => LIVE_TEST_FILE.test(name))
      .flatMap((name) => unexplainedCases(name, textOf(name)));
    expect(offences).toEqual([]);
  });

  it("stays within its budget of ten cases", () => {
    const cases = textOf(CONTRACT_FILE)
      .split("\n")
      .filter((line) => CASE.test(line)).length;
    expect(cases).toBeGreaterThan(0);
    expect(cases).toBeLessThanOrEqual(CASE_BUDGET);
  });
});
