import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatCard } from "@/components/ui";
import { EM_DASH } from "@/lib/format";
import { stubClient } from "../fixtures/stub-client";
import {
  MarkupReadError,
  ParityError,
  assertParity,
  countRows,
  readNumber,
} from "../live/parity";
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
    const db = stubClient({ review_items: { count: 0 } }).asSupabaseClient();
    await expect(
      countRows(() =>
        db.from("review_items").select("*", { head: true, count: "exact" }),
      ),
    ).resolves.toBe(0);
  });

  // PIN admin-window/BUG-0007 — `it.fails` is strict: the day
  // `countRows` starts refusing, this XPASSes and goes red, which is the
  // signal to flip it back to a plain `it` and close the bug.
  it.fails("refuses a count the database never returned, instead of fabricating zero", async () => {
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

  // PIN admin-window/BUG-0007 (same defect, seen from the mechanism).
  it.fails("does not pass parity by comparing a page's zero against a count it never got", async () => {
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
