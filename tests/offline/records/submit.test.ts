import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  recordFieldApiPath,
  submitFieldEdit,
  type FetchLike,
} from "@/components/records/submit";

/**
 * The browser's half of an inline edit (campaign admin-window/TASK-0018).
 *
 * `EditableCell` renders and reverts; the ROUTE decides and writes; this is
 * the wire between them, and these tests are what stops it silently sending a
 * body the route refuses or swallowing the refusal it gets back.
 *
 * `fetch` is a parameter, so nothing here opens a socket.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const ID = "01920000-0000-7000-8000-0000000000a1";

/** A `fetch` that records the one call it was given and answers as scripted. */
function scriptedFetch(response: {
  status: number;
  body?: unknown;
  /** A body that is not JSON at all, as a failing edge answers. */
  text?: string;
}) {
  const calls: { url: string; init: { method: string; body: string } }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const payload =
      response.text !== undefined ? response.text : JSON.stringify(response.body ?? {});
    return new Response(payload, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { impl, calls };
}

function bodyOf(calls: { init: { body: string } }[]): Record<string, unknown> {
  return JSON.parse(calls[0].init.body) as Record<string, unknown>;
}

/* ── the URL ──────────────────────────────────────────────────────────────── */

describe("the path it writes to", () => {
  it("is the route that exists in the app, segment for segment", () => {
    // Derived from the route file's own location, so moving or renaming the
    // route reddens this rather than turning every save into a 404.
    const routeFile = "src/app/api/admin/records/[table]/[id]/route.ts";
    expect(fs.existsSync(path.join(repoRoot, routeFile))).toBe(true);
    const fromTree = path
      .dirname(routeFile)
      .replace(/^src\/app/, "")
      .replace("[table]", "groups")
      .replace("[id]", ID);
    expect(recordFieldApiPath("groups", ID)).toBe(fromTree);
  });

  it("escapes a segment rather than letting it change the path", () => {
    const path_ = recordFieldApiPath("groups", "a/b?c");
    expect(path_.endsWith("a%2Fb%3Fc")).toBe(true);
  });
});

/* ── the body ─────────────────────────────────────────────────────────────── */

describe("the body it sends", () => {
  it("names the field and PATCHes", async () => {
    const { impl, calls } = scriptedFetch({ status: 200, body: { ok: true } });
    await submitFieldEdit("groups", ID, "bio", "hello", impl);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("PATCH");
    expect(bodyOf(calls)).toMatchObject({ field: "bio", value: "hello" });
  });

  it("carries an explicit null when the field is cleared, never an absent key", async () => {
    // admin-window/BUG-0011: `JSON.stringify` drops an `undefined` value, and
    // an omitted `value` reaching the route as "clear this column" is how a
    // widget bug nulls a vetted catalog column and is answered {"ok":true}.
    const { impl, calls } = scriptedFetch({ status: 200, body: { ok: true } });
    await submitFieldEdit("groups", ID, "bio", null, impl);
    const body = bodyOf(calls);
    expect(Object.prototype.hasOwnProperty.call(body, "value")).toBe(true);
    expect(body.value).toBeNull();
  });

  it("sends exactly one field per edit — no second column rides along", async () => {
    const { impl, calls } = scriptedFetch({ status: 200, body: { ok: true } });
    await submitFieldEdit("groups", ID, "bio", "hello", impl);
    expect(Object.keys(bodyOf(calls)).sort()).toEqual(["field", "value"]);
  });
});

/* ── what it reports back ─────────────────────────────────────────────────── */

describe("the outcome it reports", () => {
  it("reports the value the database actually kept, not the one typed", async () => {
    const { impl } = scriptedFetch({
      status: 200,
      body: { ok: true, record: { id: ID, bio: "normalised" } },
    });
    const outcome = await submitFieldEdit("groups", ID, "bio", "  typed  ", impl);
    expect(outcome).toEqual({ ok: true, value: "normalised" });
  });

  it("reports a cleared column as an absence, not as the string 'null'", async () => {
    const { impl } = scriptedFetch({
      status: 200,
      body: { ok: true, record: { id: ID, bio: null } },
    });
    expect(await submitFieldEdit("groups", ID, "bio", null, impl)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("says nothing about the value when the answer carried no record", async () => {
    const { impl } = scriptedFetch({ status: 200, body: { ok: true } });
    // `undefined` is EditableCell's "keep what you have" — never a false clear.
    expect(await submitFieldEdit("groups", ID, "bio", "hello", impl)).toEqual({
      ok: true,
    });
  });

  it("passes a refusal through in the words the route used", async () => {
    const refusal = "spotify_id is not an editable field of groups";
    const { impl } = scriptedFetch({ status: 403, body: { error: refusal } });
    const outcome = await submitFieldEdit("groups", ID, "spotify_id", "x", impl);
    expect(outcome).toEqual({ ok: false, message: refusal });
  });

  it("still names a refusal that carried no readable body", async () => {
    const { impl } = scriptedFetch({ status: 502, text: "<html>bad gateway" });
    const outcome = await submitFieldEdit("groups", ID, "bio", "x", impl);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message.length).toBeGreaterThan(0);
    expect(outcome.ok === false && outcome.message).toContain("502");
  });

  it("reports a dead network as a failure rather than throwing at the widget", async () => {
    const impl: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    const outcome = await submitFieldEdit("groups", ID, "bio", "x", impl);
    expect(outcome).toEqual({ ok: false, message: "Failed to fetch" });
  });
});
