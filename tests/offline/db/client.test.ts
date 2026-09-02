import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The credential seam (campaign admin-window). `src/lib/db/client.ts` is the
 * only file under `src/` that reads database credentials, it reads the
 * DEPLOYED app's names, and an unset name is a refusal — never a fallback to
 * another name. Values never appear here: the names are the whole subject.
 */

const URL_NAME = "SUPABASE_URL";
const KEY_NAME = "SUPABASE_SERVICE_ROLE_KEY";

// A syntactically valid but obviously non-real endpoint; the client is lazy
// and makes no request at construction, so nothing leaves the machine.
const OFFLINE_URL = "https://offline.invalid";
const OFFLINE_KEY = "offline-fixture-not-a-key";

/** A fresh module graph per case, so the singleton never leaks across tests. */
async function freshClientModule() {
  vi.resetModules();
  return import("@/lib/db/client");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDbClient", () => {
  it("refuses when the url name is unset, naming the name", async () => {
    vi.stubEnv(URL_NAME, "");
    vi.stubEnv(KEY_NAME, OFFLINE_KEY);
    const { getDbClient } = await freshClientModule();
    expect(() => getDbClient()).toThrowError(new RegExp(URL_NAME));
  });

  it("refuses when the service-role name is unset, naming the name", async () => {
    vi.stubEnv(URL_NAME, OFFLINE_URL);
    vi.stubEnv(KEY_NAME, "");
    const { getDbClient } = await freshClientModule();
    expect(() => getDbClient()).toThrowError(new RegExp(KEY_NAME));
  });

  it("never falls back to a staging name", async () => {
    // Staging names present, deployed names absent: the answer is still a
    // refusal. An unset name is never a fallback (acceptance doc ground rule).
    vi.stubEnv("STAGING_SUPABASE_URL", OFFLINE_URL);
    vi.stubEnv("STAGING_SUPABASE_SERVICE_ROLE_KEY", OFFLINE_KEY);
    vi.stubEnv(URL_NAME, "");
    vi.stubEnv(KEY_NAME, "");
    const { getDbClient } = await freshClientModule();
    expect(() => getDbClient()).toThrow();
  });

  it("builds one client and reuses it", async () => {
    vi.stubEnv(URL_NAME, OFFLINE_URL);
    vi.stubEnv(KEY_NAME, OFFLINE_KEY);
    const { getDbClient } = await freshClientModule();

    const first = getDbClient();
    expect(first).toBe(getDbClient());
    // It is a usable PostgREST client, not a stub.
    expect(typeof first.from).toBe("function");
  });

  it("publishes the names it reads, so nothing else has to spell them", async () => {
    const { DB_URL_ENV_NAME, DB_KEY_ENV_NAME } = await freshClientModule();
    expect(DB_URL_ENV_NAME).toBe(URL_NAME);
    expect(DB_KEY_ENV_NAME).toBe(KEY_NAME);
  });
});
