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
