import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one seam that reads database credentials from `process.env`
 * (ARCHITECTURE.md §4 rule 3). No other file under `src/` may.
 *
 * It reads the DEPLOYED app's existing names, unchanged — the Railway service
 * is never repointed by this campaign (acceptance doc ground rules), so the
 * names here are `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` and nothing else.
 * The staging names belong to the live-test setup under `tests/live/` and must
 * never appear under `src/` — not even in a comment, which is why this one
 * does not spell their prefix. An unset name is a refusal, never a fallback to
 * some other name.
 *
 * Server-side only: the service role bypasses RLS and must never reach a client
 * bundle. Nothing in this module is importable from a `"use client"` file.
 */

/** The env names this app reads. Names, never values. */
export const DB_URL_ENV_NAME = "SUPABASE_URL";
export const DB_KEY_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";

let cached: SupabaseClient | null = null;

/**
 * The app's service-role Supabase client, created once and reused.
 *
 * Throws when either name is unset — that is the honest refusal, and it is
 * safe because every read in `lib/db/**` resolves its client inside the same
 * `try` that classifies errors (see `result.ts`), so an unset name renders as
 * an error state rather than crashing a page.
 */
export function getDbClient(): SupabaseClient {
  if (cached) return cached;

  // Direct member access, not `process.env[name]`: Next replaces the former at
  // build time and cannot see the latter.
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error(`${DB_URL_ENV_NAME} is not set`);
  if (!serviceRoleKey) throw new Error(`${DB_KEY_ENV_NAME} is not set`);

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cached;
}
