import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  SCHEMA_DESCRIPTION_MEDIA_TYPE,
  readFunctionInstalled,
  restEndpointOf,
} from "@/lib/db/schema";
import { FN } from "@/lib/db/tables";

/**
 * The app's read of PostgREST's own schema description — campaign
 * admin-window/BUG-0223, `src/lib/db/schema.ts`.
 *
 * Every case here runs against a REAL `@supabase/supabase-js` client with its
 * `fetch` replaced (the pattern `tests/offline/db/result.test.ts` already
 * uses), which is the point: this module reads the endpoint and the
 * authenticated fetch OFF the client, and the published types call that
 * property `protected`. A stub shaped by hand would prove that the code works
 * against the shape we believe in; a real client proves the shape is the one
 * the library actually builds — so a version bump that moved it reddens here
 * instead of quietly withdrawing the override control in production.
 *
 * No network: every client below answers from a scripted fetch.
 */

/** One request the app made, as the scripted fetch received it. */
interface Asked {
  url: string;
  method: string | undefined;
  accept: string | null;
  /** Did the client's own wrapper put a credential on it? Presence, never the value. */
  authenticated: boolean;
}

/** A PostgREST schema description exposing `functions` and nothing else. */
function description(functions: readonly string[]): string {
  const paths: Record<string, unknown> = { "/": {} };
  for (const fn of functions) paths[`/rpc/${fn}`] = {};
  return JSON.stringify({ swagger: "2.0", paths });
}

/**
 * A real client over a scripted answer. `at` is this client's own project
 * address: the schema module remembers what a given ENDPOINT exposed, so a
 * case that must ask again gives its client an address of its own.
 */
function clientAnswering(
  at: string,
  answer: (asked: Asked) => Response,
): { client: SupabaseClient; asked: Asked[] } {
  const asked: Asked[] = [];
  const client = createClient(at, "stub-key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const request: Asked = {
          url: String(input),
          method: init?.method,
          accept: headers.get("Accept"),
          authenticated: headers.has("apikey") && headers.has("Authorization"),
        };
        asked.push(request);
        return answer(request);
      },
    },
  }) as unknown as SupabaseClient;
  return { client, asked };
}

/** A client whose description lists `functions`. */
function databaseExposing(at: string, functions: readonly string[]) {
  return clientAnswering(
    at,
    () =>
      new Response(description(functions), {
        status: 200,
        headers: { "content-type": "application/openapi+json" },
      }),
  );
}

describe("the endpoint behind a client", () => {
  it("is what the real supabase client carries, not a shape we invented", () => {
    // The whole library coupling, in one assertion. `rest` is `protected` in
    // the published types and present at runtime; if an upgrade renames it,
    // this fails — and the app fails CLOSED, which is the other half of the
    // contract (see the case below).
    const { client } = databaseExposing("https://endpoint-shape.invalid", []);
    const endpoint = restEndpointOf(client);
    expect(endpoint).not.toBeNull();
    expect(endpoint?.url).toBe("https://endpoint-shape.invalid/rest/v1");
    expect(typeof endpoint?.fetch).toBe("function");
  });

  it("is null for a client that carries none, and that answer refuses rather than guesses", async () => {
    // The fixture that MUST flag, beside the one above that must not
    // (LESSONS 8). A client without the endpoint cannot establish anything, so
    // the answer is an error naming what was asked about — never `ok`, which
    // would offer a control whose save cannot land.
    expect(restEndpointOf({} as SupabaseClient)).toBeNull();

    const result = await readFunctionInstalled(FN.settleReviewItem, {} as SupabaseClient);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(FN.settleReviewItem);
  });
});

describe("reading whether a function is installed", () => {
  it("GETs the REST root asking for the schema description, on the client's own fetch", async () => {
    const { client, asked } = databaseExposing("https://reads-the-root.invalid", [
      FN.settleReviewItem,
    ]);
    await readFunctionInstalled(FN.settleReviewItem, client);

    expect(asked).toHaveLength(1);
    expect(asked[0].url).toBe("https://reads-the-root.invalid/rest/v1/");
    // A GET: supabase-js's fetch wrapper sends no method for one, and nothing
    // here sets another.
    expect(asked[0].method).toBeUndefined();
    expect(asked[0].accept).toBe(SCHEMA_DESCRIPTION_MEDIA_TYPE);
    // The credential rode on the CLIENT's wrapper — this module never touched
    // one. Presence, never a value.
    expect(asked[0].authenticated).toBe(true);
  });

  it("answers ok when the description lists it, and not_provisioned naming it when it does not", async () => {
    const there = databaseExposing("https://listed.invalid", [
      "apply_resolution",
      FN.settleReviewItem,
    ]);
    await expect(
      readFunctionInstalled(FN.settleReviewItem, there.client),
    ).resolves.toEqual({ kind: "ok", data: "installed" });

    // The same document, read on a database that exposes 59 other things and
    // not this one: an absence claim about the object that was ASKED for.
    const absent = databaseExposing("https://not-listed.invalid", ["apply_resolution"]);
    await expect(
      readFunctionInstalled(FN.settleReviewItem, absent.client),
    ).resolves.toEqual({ kind: "not_provisioned", missing: FN.settleReviewItem });
  });

  it("never claims an absence from a description it could not read", async () => {
    // Three ways the read fails, and none of them is an absence: a refusal, a
    // host answering for something else, and a transport that threw. Each is
    // an error NAMING the function, because "the object is not there" and "the
    // question was not answered" are different facts and only one of them is
    // about the object (`functionsOnStaging`, tests/live/parity.ts).
    const refused = clientAnswering(
      "https://refuses.invalid",
      () => new Response("no", { status: 500 }),
    );
    const foreign = clientAnswering(
      "https://foreign.invalid",
      () =>
        new Response(JSON.stringify({ message: "no upstream" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const thrown = clientAnswering("https://throws.invalid", () => {
      throw new Error("bad port");
    });

    for (const { client } of [refused, foreign, thrown]) {
      const result = await readFunctionInstalled(FN.settleReviewItem, client);
      expect(result.kind).toBe("error");
      if (result.kind !== "error") continue;
      expect(result.reading).toBe(FN.settleReviewItem);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("a description whose paths is not an object is unreadable, not an absence", async () => {
    // The schema-description leg of the one admission rule (ARCHITECTURE.md
    // §4.1, admin-window/BUG-0234). PostgREST is specified to answer this read
    // with a document whose `paths` is a JSON OBJECT keying every route it
    // exposes; the question asked was `typeof paths === "object"`, which a
    // JSON ARRAY also satisfies — and `Object.keys` of an array is its
    // indices, so an array `paths` yielded an EMPTY function set and this app
    // reported `not_provisioned`: a false absence about the database, out of a
    // document it could not read.
    const bodies: ReadonlyArray<readonly [string, string]> = [
      ["paths as a JSON array", JSON.stringify({ swagger: "2.0", paths: ["/rpc/x"] })],
      ["paths as an EMPTY array", JSON.stringify({ swagger: "2.0", paths: [] })],
      ["paths as a string", JSON.stringify({ swagger: "2.0", paths: "/rpc/x" })],
      ["paths as null", JSON.stringify({ swagger: "2.0", paths: null })],
      ["a body that is an array", JSON.stringify([{ paths: {} }])],
    ];

    // MUST FLAG: every one of them is a read that did not answer, so the
    // answer names the function and refuses — never `not_provisioned`, which
    // would be a claim about the DATABASE made from a document this app could
    // not read, and never `ok`, which would offer a control whose save cannot
    // land.
    for (const [index, [shape, body]] of bodies.entries()) {
      const { client } = clientAnswering(
        `https://paths-${index}.invalid`,
        () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/openapi+json" },
          }),
      );
      const result = await readFunctionInstalled(FN.settleReviewItem, client);
      expect(result.kind, shape).toBe("error");
      if (result.kind !== "error") continue;
      expect(result.reading, shape).toBe(FN.settleReviewItem);
      expect(result.message.length, shape).toBeGreaterThan(0);
    }

    // MUST NOT FLAG (LESSONS 8): the document PostgREST really sends. Its
    // `paths` is an object, and both of the answers it can carry survive —
    // the function listed, and a REAL absence that is still an absence.
    const installed = databaseExposing("https://paths-object.invalid", [
      FN.settleReviewItem,
    ]);
    await expect(
      readFunctionInstalled(FN.settleReviewItem, installed.client),
    ).resolves.toEqual({ kind: "ok", data: "installed" });

    const absent = databaseExposing("https://paths-object-absent.invalid", []);
    await expect(
      readFunctionInstalled(FN.settleReviewItem, absent.client),
    ).resolves.toEqual({ kind: "not_provisioned", missing: FN.settleReviewItem });
  });

  it("settles an INSTALLED answer for the process, and re-asks every other", async () => {
    // The document is 387 KB and took 1048 / 415 / 319 ms to read on the
    // declared staging target (measured read-only 2026-09-14), so a page
    // cannot pay for it on every render. The asymmetry is the design: once an
    // endpoint has been seen exposing the name, this process stops asking —
    // while an ABSENCE is asked again every time, because the world this
    // ticket is about is the install window, and the render after the install
    // must see it without a restart.
    const installed = databaseExposing("https://cached.invalid", [FN.settleReviewItem]);
    await readFunctionInstalled(FN.settleReviewItem, installed.client);
    await readFunctionInstalled(FN.settleReviewItem, installed.client);
    expect(installed.asked).toHaveLength(1);

    const absent = databaseExposing("https://re-asked.invalid", []);
    await readFunctionInstalled(FN.settleReviewItem, absent.client);
    await readFunctionInstalled(FN.settleReviewItem, absent.client);
    expect(absent.asked).toHaveLength(2);

    // …and one endpoint's answer is never another's: the cache is keyed by
    // which database was asked.
    const elsewhere = databaseExposing("https://elsewhere.invalid", []);
    await expect(
      readFunctionInstalled(FN.settleReviewItem, elsewhere.client),
    ).resolves.toEqual({ kind: "not_provisioned", missing: FN.settleReviewItem });
  });

  it("makes no rpc call on any path", async () => {
    // Criterion 4. A call placed to discover whether a procedure exists is a
    // write attempt dressed as a probe — on 2026-09-11 one applied a real
    // admin override (admin-window/BUG-0215). Every request this module can
    // make is visible here, and all of them are the same GET.
    for (const [at, functions] of [
      ["https://no-rpc-installed.invalid", [FN.settleReviewItem]],
      ["https://no-rpc-absent.invalid", []],
    ] as const) {
      const { client, asked } = databaseExposing(at, functions);
      await readFunctionInstalled(FN.settleReviewItem, client);
      expect(asked.map((request) => request.url)).toEqual([`${at}/rest/v1/`]);
      expect(asked.some((request) => request.url.includes("/rpc/"))).toBe(false);
      expect(asked.some((request) => request.method === "POST")).toBe(false);
    }
  });
});

describe("the install window itself (QA/BUG-0223)", () => {
  /** One endpoint whose description changes under a running process. */
  function databaseInstallingMidProcess(at: string) {
    let functions: readonly string[] = [];
    let status = 200;
    const { client, asked } = clientAnswering(at, () =>
      status === 200
        ? new Response(description(functions), {
            status: 200,
            headers: { "content-type": "application/openapi+json" },
          })
        : new Response("no", { status }),
    );
    return {
      client,
      asked,
      install: () => {
        functions = [FN.settleReviewItem];
      },
      refuse: () => {
        status = 500;
      },
      serve: () => {
        status = 200;
      },
    };
  }

  it("sees the install on the very next read, with no restart", async () => {
    // THE property this ticket exists for, asked of ONE endpoint rather than
    // two: the window measured on staging 2026-09-11 was four minutes long
    // (23:22Z table only, 23:26Z both), and the process that rendered the
    // refusal is the same process that must render the control afterwards.
    // Two clients at two addresses cannot show that — a cache keyed by
    // endpoint answers them independently whether or not an absence is cached.
    const staging = databaseInstallingMidProcess("https://install-window.invalid");

    await expect(
      readFunctionInstalled(FN.settleReviewItem, staging.client),
    ).resolves.toEqual({ kind: "not_provisioned", missing: FN.settleReviewItem });

    staging.install();

    await expect(
      readFunctionInstalled(FN.settleReviewItem, staging.client),
    ).resolves.toEqual({ kind: "ok", data: "installed" });
    expect(staging.asked).toHaveLength(2);
  });

  it("never lets a failed read stand in for an answer, before or after", async () => {
    // A read that could not be made is not an absence and not an affirmative:
    // neither may be remembered from it. So an endpoint that refuses, then
    // answers, still answers for itself — and the refusal in between costs the
    // control for exactly as long as it lasts.
    const flaky = databaseInstallingMidProcess("https://flaky-description.invalid");
    flaky.install();
    flaky.refuse();

    const refused = await readFunctionInstalled(FN.settleReviewItem, flaky.client);
    expect(refused.kind).toBe("error");

    flaky.serve();
    await expect(
      readFunctionInstalled(FN.settleReviewItem, flaky.client),
    ).resolves.toEqual({ kind: "ok", data: "installed" });
    expect(flaky.asked).toHaveLength(2);
  });

  it("carries no part of the description, and no credential, into its answer", async () => {
    // The document is 387 KB of this database's whole shape and the read rides
    // the client's authenticated fetch. What comes back out is three words
    // about one object: an answer that leaked either would be a 387 KB page
    // and a burned key.
    const { client } = clientAnswering(
      "https://leak-check.invalid",
      () =>
        new Response(
          JSON.stringify({
            swagger: "2.0",
            info: { title: "stub-key-should-never-appear" },
            paths: { "/secret_table": {}, "/rpc/apply_resolution": {} },
          }),
          { status: 200, headers: { "content-type": "application/openapi+json" } },
        ),
    );
    const result = await readFunctionInstalled(FN.settleReviewItem, client);
    expect(result).toEqual({ kind: "not_provisioned", missing: FN.settleReviewItem });
    expect(JSON.stringify(result)).not.toContain("secret_table");
    expect(JSON.stringify(result)).not.toContain("stub-key");
  });
});
