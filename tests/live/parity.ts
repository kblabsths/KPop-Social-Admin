/**
 * The per-page parity mechanism (campaign admin-window, admin-window/TASK-0003).
 *
 * Acceptance test 2 — "every page renders real staging data, and a parity
 * check per page asserts the rendered numbers against direct SQL on staging".
 * ARCHITECTURE.md §10 states the rule this file exists to make cheap:
 *
 *   the number the page RENDERED is compared with a count the TEST issues
 *   itself, written independently of the `lib/db` function the page called.
 *   Two paths to one number, or it proves nothing.
 *
 * So this module deliberately offers no way to ask `lib/db` for the expected
 * value. It hands the test its own Supabase client (`independentClient()`,
 * a separate instance from the app's singleton) and a thin `countRows()` that
 * runs whatever query the test writes. The page's read path and the test's
 * read path share nothing but the database.
 *
 * Usage in a page's live test:
 *
 *   const markup = await renderPage(DashboardPage, {});
 *   await assertParity({
 *     markup,
 *     label: "Open decisions",
 *     expected: () =>
 *       countRows(() =>
 *         independentClient()
 *           .from("review_items")
 *           .select("*", { head: true, count: "exact" })
 *           .eq("status", "open"),
 *       ),
 *   });
 *
 * This module is import-safe offline: it reads no environment and opens no
 * socket until one of its functions is called, which is what lets
 * `tests/offline/live-guard.test.ts` test the extraction and the comparison
 * without a database.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EM_DASH } from "@/lib/format";

/** A parity comparison that came out unequal. */
export class ParityError extends Error {
  constructor(
    message: string,
    readonly label: string,
    readonly rendered: number,
    readonly expected: number,
  ) {
    super(message);
    this.name = "ParityError";
  }
}

/**
 * The test's own count query came back without a count.
 *
 * Distinct from a query that errored: PostgREST answers a plain `select()`
 * with `error: null` and `count: null`, and treating that as `0` is what
 * admin-window/BUG-0007 was — a parity pass against a number the database
 * never returned.
 */
export class ParityCountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParityCountError";
  }
}

/** The markup did not carry the number the test asked for. */
export class MarkupReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkupReadError";
  }
}

/**
 * Render a page function to static markup.
 *
 * A route's page function is the only async component in this app
 * (ARCHITECTURE.md §5), so awaiting it and rendering the result synchronously
 * is the whole story — no jsdom, no Testing Library.
 */
export async function renderPage<Props>(
  page: (props: Props) => ReactNode | Promise<ReactNode>,
  props: Props,
): Promise<string> {
  const element = await page(props);
  return renderToStaticMarkup(element);
}

function normalize(text: string): string {
  // `&nbsp;` survives server rendering; a parity read must not care.
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Parse a rendered figure back to a number.
 *
 * The whole string has to be the number — `count()` renders `1,234`, and a
 * sub-detail line like `3 sources` is prose, not this card's figure.
 */
function parseFigure(text: string): number | null {
  const compact = normalize(text).replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(compact)) return null;
  const value = Number(compact);
  return Number.isFinite(value) ? value : null;
}

type Beside =
  | { kind: "number"; value: number }
  | { kind: "absent" }
  | { kind: "none" };

/**
 * The number shown NEXT TO a labelling element, given the text of every
 * element that follows it.
 *
 * Structural, not stylistic: a `StatCard` renders label, then figure, then an
 * optional sub-line; a table row renders header then cell. The first
 * following text that is wholly a number is the figure. Class names and copy
 * are never read — a restyle must not redden a parity test.
 */
function numberBeside(followingTexts: readonly string[]): Beside {
  let sawAbsence = false;
  for (const text of followingTexts) {
    const parsed = parseFigure(text);
    if (parsed !== null) return { kind: "number", value: parsed };
    if (text === EM_DASH) sawAbsence = true;
  }
  return sawAbsence ? { kind: "absent" } : { kind: "none" };
}

/**
 * The number the markup shows under `label`.
 *
 * Throws rather than returning a sentinel: a parity test that silently reads
 * `0` out of a page that rendered nothing is worse than no parity test. An
 * em dash — the app's rendering of absence — is reported as absence, because
 * "the page shows no value" and "the page shows the wrong value" are
 * different failures.
 */
export function readNumber(markup: string, label: string): number {
  const $ = cheerio.load(markup);
  const wanted = normalize(label);

  const found = new Set<number>();
  let absent = false;
  let labelled = false;

  $("*").each((_, element) => {
    const node = $(element);
    if (normalize(node.text()) !== wanted) return;
    labelled = true;
    const following = node
      .nextAll()
      .toArray()
      .map((sibling) => normalize($(sibling).text()));
    const beside = numberBeside(following);
    if (beside.kind === "number") found.add(beside.value);
    if (beside.kind === "absent") absent = true;
  });

  if (!labelled) {
    throw new MarkupReadError(
      `the markup shows nothing labelled "${label}".`,
    );
  }
  if (found.size === 0) {
    throw new MarkupReadError(
      absent
        ? `"${label}" renders an absence (${EM_DASH}), not a number.`
        : `"${label}" is in the markup but no number stands beside it.`,
    );
  }
  if (found.size > 1) {
    throw new MarkupReadError(
      `"${label}" labels more than one number in this markup ` +
        `(${[...found].join(", ")}); the label is ambiguous.`,
    );
  }
  return [...found][0];
}

/**
 * Run the count query the TEST wrote and return its number.
 *
 * Two refusals, no sentinels — a parity test must never quietly compare
 * against `0` because its own query broke or never asked for a count:
 *
 *  - a query that ERRORED throws with the database's own message;
 *  - a query that came back WITHOUT a count throws too. PostgREST answers a
 *    `select()` written without `{ head: true, count: "exact" }` with
 *    `error: null` and `count: null`, and coercing that to `0` gave any page
 *    rendering zero a free parity pass (admin-window/BUG-0007).
 */
export async function countRows(
  run: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count, error } = await run();
  if (error !== null && error !== undefined) {
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
    throw new Error(`the parity count query failed: ${message}`);
  }
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new ParityCountError(
      `the parity count query returned no count. A count query must be ` +
        `written with { head: true, count: "exact" }; without it PostgREST ` +
        `answers with no error and no count, and a parity check against a ` +
        `count nobody made proves nothing.`,
    );
  }
  return count;
}

let independent: SupabaseClient | null = null;

/**
 * A Supabase client for the TEST's own query.
 *
 * A separate instance from the app's singleton (`src/lib/db/client.ts`) on
 * purpose: the two read paths share the database and nothing else. It reads
 * the APP's names, which `tests/live/setup.ts` has already pointed at
 * staging — this file never touches a `STAGING_` name, and it refuses rather
 * than inventing a target if the setup did not run.
 */
export function independentClient(): SupabaseClient {
  if (independent) return independent;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "the parity client has no target: SUPABASE_URL / " +
        "SUPABASE_SERVICE_ROLE_KEY are unset, which means tests/live/setup.ts " +
        "did not run. Live tests must run through `npm run test:live`.",
    );
  }
  independent = createClient(url, key, { auth: { persistSession: false } });
  return independent;
}

export interface ParityInput {
  /** The markup the page rendered (see `renderPage`). */
  markup: string;
  /** The label the number is shown under, as an operator would read it. */
  label: string;
  /**
   * The count THIS TEST issues, written independently of the `lib/db` read
   * the page used.
   */
  expected: () => number | Promise<number>;
}

/**
 * Assert that the rendered number and the independently-counted number agree,
 * and return the number.
 *
 * Throws a `ParityError` naming both sides, so a failure reads as "the page
 * says 41, the database says 42" rather than "expected true to be false".
 */
export async function assertParity(input: ParityInput): Promise<number> {
  const rendered = readNumber(input.markup, input.label);
  const expected = await input.expected();
  if (rendered !== expected) {
    throw new ParityError(
      `parity failed for "${input.label}": the page rendered ${rendered}, ` +
        `the database counted ${expected}.`,
      input.label,
      rendered,
      expected,
    );
  }
  return rendered;
}
