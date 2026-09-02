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

/* ── the state classifier (ARCHITECTURE §10, admin-window/TASK-0032) ──────── */

/**
 * The four kinds a data surface can be in (LOOK_AND_FEEL, Emptiness).
 *
 * `ok` and `empty` both COUNTED — `empty` is a real zero. `not_provisioned`
 * and `error` counted nothing at all, and they are not interchangeable: gray
 * means unavailable, red means broken.
 */
export type PageStateKind = "ok" | "empty" | "not_provisioned" | "error";

/**
 * The value the `Loading` primitive emits. It is NOT a `PageStateKind`: a live
 * test grades a finished server render, in which nothing is still loading, so
 * a loading card in the markup is unreadable rather than a fifth verdict.
 */
const LOADING = "loading";

/**
 * The one value only a SURFACE wrapper declares. None of the four `ui` state
 * primitives emits it, so a `data-state="ok"` element inside a surface is a
 * nested surface saying it read fine — never a card of the surface around it.
 */
const DECLARED_OK = "ok";

/** The kinds a SURFACE may declare on its own wrapper (`ok` included). */
const SURFACE_STATES = new Set<string>(["ok", "empty", "not_provisioned", "error"]);

/**
 * Which kind a surface is in when it carries several: an `error` is never
 * outvoted by a sibling card or by a wrapper's declaration (ARCHITECTURE §10
 * rule 6 — an error is a FAIL), an unreadable object outranks an emptiness,
 * and `ok` is only the answer when the surface carries no card at all
 * (admin-window/BUG-0035).
 */
const DOMINANCE: readonly PageStateKind[] = ["error", "not_provisioned", "empty"];

/** The kind that wins over the cards a surface holds; `ok` when it holds none. */
function dominantKind(kinds: readonly PageStateKind[]): PageStateKind {
  return DOMINANCE.find((kind) => kinds.includes(kind)) ?? "ok";
}

/** A surface was in a kind the test did not expect. Always a test failure. */
export class StateMismatchError extends Error {
  constructor(
    message: string,
    readonly within: string,
    readonly found: PageStateKind,
    readonly expected: PageStateKind,
  ) {
    super(message);
    this.name = "StateMismatchError";
  }
}

function asKind(value: string | undefined, where: string): PageStateKind {
  if (value === LOADING) {
    throw new MarkupReadError(
      `${where} is still in its LOADING state. A live test grades a finished ` +
        `server render, so there is no number here to compare and no verdict ` +
        `to give.`,
    );
  }
  if (value === undefined || !SURFACE_STATES.has(value)) {
    throw new MarkupReadError(
      `${where} carries data-state="${value ?? ""}", which is not one of the ` +
        `four kinds (${[...SURFACE_STATES].join(", ")}).`,
    );
  }
  return value as PageStateKind;
}

/**
 * Every state CARD the markup carries, in document order, by `data-state`.
 *
 * The four `ui` state primitives each emit one; a page-level wrapper that
 * declares its own kind (`[data-queue]`, `[data-surface="runs"]`) is a surface
 * rather than a card and is not listed here — `stateOf` reads those.
 *
 * Throws rather than skipping on a value it does not know: an unknown
 * `data-state` means the markup grew a fifth state nobody taught this oracle
 * about, and silently ignoring it is how a broken page goes green.
 */
export function pageStates(markup: string): PageStateKind[] {
  const $ = cheerio.load(markup);
  return $("[data-state]")
    .toArray()
    .filter((element) => $(element).attr("data-state") !== DECLARED_OK)
    .map((element) =>
      asKind($(element).attr("data-state"), `a <${(element as { tagName?: string }).tagName ?? "?"}> state card`),
    );
}

/**
 * The kind of ONE surface: the state card inside `within` (a selector), or
 * `ok` when that surface rendered without a state card at all.
 *
 * Structural, never prose. `Empty` and `NotProvisioned` draw the identical
 * container and differ only in their words, so reading the copy graded an
 * honest emptiness as an unprovisioned table (`/queues`, `/sources`) — and
 * "the markup mentions `pending_claims`" was satisfied by the red error line
 * as well as by the gray card, which is how four live assertions passed on a
 * page in its error state (admin-window/TASK-0032; ARCHITECTURE §10).
 *
 * A surface holding several cards is in the kind that DOMINATES them: `error`
 * first, then `not_provisioned`, then `empty`; `ok` only where it carries no
 * card at all. A second read that came back empty does not outvote a read that
 * refused (admin-window/BUG-0035).
 *
 * A wrapper may declare its own kind (`[data-queue]`, `[data-surface]`); when
 * it does, that declaration is the answer only where the cards inside it agree
 * — an `error` among them outranks it outright, and any other disagreement is
 * a refusal. A block can never say `ok` while rendering an error line.
 *
 * A `data-state` value outside the four kinds is a REFUSAL naming the value,
 * never a skip: the misspelling `not-provisioned` is one character away from
 * this codebase's own hyphenated idiom, and skipping it graded an unprovisioned
 * surface green.
 *
 * `excluding` names SUB-SURFACES inside `within` that make their own read and
 * carry their own state — the dial embedded in a review item's evidence view,
 * for one. Their cards belong to them, not to this surface: a page that renders
 * its claims perfectly well while an embedded gauge cannot read its view is
 * not a page whose claims are broken. A test that excludes a sub-surface says
 * so, and grades that sub-surface on its own or leaves it to the file that
 * owns it.
 */
export function stateOf(
  markup: string,
  within: string,
  excluding?: string,
): PageStateKind {
  const $ = cheerio.load(markup);
  const surface = $(within);
  if (surface.length === 0) {
    throw new MarkupReadError(
      `the markup carries no surface matching '${within}', so there is no ` +
        `state to read. A surface that did not render at all is not a state.`,
    );
  }
  if (surface.length > 1) {
    throw new MarkupReadError(
      `'${within}' matches ${surface.length} surfaces in this markup; a state ` +
        `is read of one surface, so the selector has to name one.`,
    );
  }

  const cards = surface
    .find("[data-state]")
    .toArray()
    .filter((element) => $(element).attr("data-state") !== DECLARED_OK)
    .filter(
      (element) => excluding === undefined || $(element).closest(excluding).length === 0,
    )
    .map((element) => asKind($(element).attr("data-state"), `the card inside '${within}'`));
  const distinct = [...new Set(cards)];
  const held = dominantKind(distinct);

  const declared = surface.attr("data-state");
  if (declared === undefined) return held;

  const kind = asKind(declared, `the surface '${within}'`);
  // Rule 6 is unconditional: a surface that rendered an error line IS in its
  // error state, whatever its wrapper declares and whatever else it holds. The
  // failure that follows names the read and the database's own words, which a
  // refusal about contradictory markup would have buried
  // (admin-window/BUG-0035).
  if (held === "error") return "error";
  if (distinct.length > 0 && held !== kind) {
    throw new MarkupReadError(
      `'${within}' declares data-state="${kind}" but the state ` +
        `${distinct.length === 1 ? "card" : "cards"} inside it ` +
        `${distinct.length === 1 ? "says" : "say"} "${distinct.join(", ")}". ` +
        `The block and its ${distinct.length === 1 ? "card" : "cards"} ` +
        `disagree about which state the surface is in.`,
    );
  }
  return kind;
}

/** The words a state card carries, for a FAILURE MESSAGE — never for a verdict. */
function cardText(markup: string, within: string, kind: PageStateKind): string {
  const $ = cheerio.load(markup);
  const scope = $(within);
  const card = scope.is(`[data-state="${kind}"]`)
    ? scope
    : scope.find(`[data-state="${kind}"]`).first();
  return normalize(card.text());
}

/**
 * Assert the kind of one surface, and say which kind was found and where when
 * it is not the one expected.
 *
 * An `error` found where anything else was expected reports the line the page
 * rendered, which carries the read's name and the database's own words
 * (`ui/error-line.tsx`) — rule 6: an error is a failure that NAMES the read.
 */
export function assertState(
  markup: string,
  within: string,
  expected: PageStateKind,
): void {
  const found = stateOf(markup, within);
  if (found === expected) return;
  const detail =
    found === "error"
      ? ` The page says: ${cardText(markup, within, "error")}`
      : found === "not_provisioned"
        ? ` The page says: ${cardText(markup, within, "not_provisioned")}`
        : "";
  throw new StateMismatchError(
    `'${within}' is in its ${found.toUpperCase()} state; this test expected ` +
      `${expected.toUpperCase()}.${detail}`,
    within,
    found,
    expected,
  );
}

/**
 * Refuse a page that carries an ERROR anywhere in it.
 *
 * The default guard of `assertParity` when no surface is named: a number read
 * off a page one of whose reads refused is exactly the vacuous pass this rule
 * exists to stop (ticket title — an ERROR page may not pass).
 */
export function assertNoErrorState(markup: string, label: string): void {
  const errors = cheerio.load(markup)('[data-state="error"]');
  if (errors.length === 0) return;
  throw new StateMismatchError(
    `the page is in an ERROR state, so "${label}" cannot be compared: ` +
      normalize(errors.first().text()),
    ":root",
    "error",
    "ok",
  );
}

/** PostgREST's and Postgres's own codes for "that object is not here". */
export const ABSENCE_CODES: readonly string[] = ["PGRST205", "42P01"];

/** The `code` of a PostgREST error, or `""` when it carries none. */
export function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code ?? "")
    : "";
}

/**
 * Does THIS TEST's own read of `object` get the absence code?
 *
 * Rule 5: `not_provisioned` is a pass only when the test's own read of that
 * same object returns `PGRST205` / `42P01`. It is never inferred from "no rows
 * rendered", and never from the words on the card.
 */
export async function objectIsAbsent(object: string): Promise<boolean> {
  const { error } = await independentClient().from(object).select("*").limit(1);
  return ABSENCE_CODES.includes(codeOf(error));
}

/** A test's own count, or `"absent"` when the object is not in this database. */
export type Counted = number | "absent";

/**
 * Run the test's own count and answer `"absent"` — rather than throwing —
 * when the database says the object is not there.
 *
 * The two honest outcomes of a count are "this many" and "there is no such
 * object", and they are the two the oracle grades against: a page may render
 * `not_provisioned` only when THIS read got the absence code (rule 5). Every
 * other failure still throws, because a read that broke is not a read that
 * counted nothing.
 */
export async function countOrAbsent(
  run: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<Counted> {
  try {
    return await countRows(run);
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (ABSENCE_CODES.some((code) => message.includes(code))) return "absent";
    throw failure;
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
 * A GET-shaped exact count over `object`, for a test to narrow itself.
 *
 * `{ count: "exact" }` WITHOUT `head: true`, plus a one-row range: the count
 * comes back in `Content-Range` either way, but a `head: true` count is a HEAD
 * request, and a HEAD response carries **no body** — so supabase-js parses no
 * error out of a failure and hands back `code=undefined, msg=""` (measured on
 * a real `57014` statement timeout, admin-window/TASK-0032). A timeout
 * reported as a blank is how a broken read looks like an empty one. The range
 * keeps the body to a single row, so this costs one row more than a HEAD and
 * buys the database's own error code.
 *
 * Every live test counts through this. `head: true` has no place in
 * `tests/live/**` — `tests/offline/live-guard.test.ts` pins that.
 */
export function exactCount(object: string, db?: SupabaseClient) {
  return (db ?? independentClient())
    .from(object)
    .select("*", { count: "exact" })
    .range(0, 0);
}

/**
 * The database's own account of a failure, as far as it can be told, with
 * NOTHING of the payload in it.
 *
 * `code` and `message` only: `details` is where supabase-js puts a transport
 * failure's cause chain, which carries the HOST — and a live suite never
 * prints a host (parent ticket's ground rules). When neither field says
 * anything, the keys are named and the values are not.
 */
function accountOf(error: unknown): string {
  const code = codeOf(error);
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message ?? "")
      : String(error);
  if (code !== "" && message !== "") return `${code} ${EM_DASH} ${message}`;
  if (code !== "") return `code ${code}, with no message`;
  if (message !== "" && message !== "[object Object]") {
    return `${message} (the database returned no code)`;
  }
  const keys =
    typeof error === "object" && error !== null ? Object.keys(error).join(", ") : typeof error;
  return (
    `it returned no parseable error — no code and no message. The response ` +
    `carried these keys and no readable account: [${keys}]`
  );
}

/**
 * Run the count query the TEST wrote and return its number.
 *
 * Two refusals, no sentinels — a parity test must never quietly compare
 * against `0` because its own query broke or never asked for a count:
 *
 *  - a query that ERRORED throws, naming the database's own code and words —
 *    or saying in as many words that it could not tell, which is the one
 *    honest thing to say about a response that carried neither;
 *  - a query that came back WITHOUT a count throws too. PostgREST answers a
 *    `select()` written without `count: "exact"` with `error: null` and
 *    `count: null`, and coercing that to `0` gave any page rendering zero a
 *    free parity pass (admin-window/BUG-0007).
 */
export async function countRows(
  run: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count, error } = await run();
  if (error !== null && error !== undefined) {
    throw new Error(`the parity count query failed: ${accountOf(error)}`);
  }
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new ParityCountError(
      `the parity count query returned no count. A count query must be ` +
        `written with { count: "exact" } — \`exactCount()\` builds one; ` +
        `without it PostgREST answers with no error and no count, and a ` +
        `parity check against a count nobody made proves nothing.`,
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
  /**
   * The surface this number belongs to. Its state kind is asserted BEFORE the
   * number is read, so a `MarkupReadError` can never again be the way a test
   * discovers the page was in another state (ARCHITECTURE §10).
   */
  within?: string;
  /**
   * The kind that surface is expected to be in. `ok` unless the test says
   * otherwise — `empty` is the other one that carries a number, and it is a
   * pass with a stated 0.
   */
  kind?: PageStateKind;
}

/**
 * Assert that the rendered number and the independently-counted number agree,
 * and return the number.
 *
 * The STATE KIND is named first, always: with `within`, that surface must be
 * in the expected kind; without it, the page must carry no error card at all
 * — because a figure read off a page whose reads refused is precisely the
 * vacuous pass this mechanism exists to stop.
 *
 * Throws a `ParityError` naming both sides, so a failure reads as "the page
 * says 41, the database says 42" rather than "expected true to be false".
 */
export async function assertParity(input: ParityInput): Promise<number> {
  if (input.within === undefined) {
    assertNoErrorState(input.markup, input.label);
  } else {
    assertState(input.markup, input.within, input.kind ?? "ok");
  }
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

/* ── grading one surface against the test's own count ─────────────────────── */

export interface SurfaceGrade {
  /** The markup the page rendered. */
  markup: string;
  /** The selector naming the ONE surface being graded. */
  within: string;
  /**
   * The object that surface reads, spelled as the query spells it (`T.*`).
   * Used only to check a `not_provisioned` claim against the database.
   */
  object: string;
  /**
   * What THIS TEST's own count of that surface answered — a number, or
   * `"absent"` when its own read got the absence code (see `countOrAbsent`).
   * It is what decides the kind the test expects: `"absent"` means
   * `not_provisioned`, 0 means `empty`, more means `ok`.
   *
   * A thunk is run only once the surface is known not to be in its ERROR
   * state, because rule 6 is unconditional: an error is a failure whatever
   * the test's own read would have said — and where the page's read timed
   * out, the test's own read of the same object usually times out too, which
   * would bury the page's own account of the failure under the test's.
   */
  counted: Counted | (() => PromiseLike<Counted>);
  /**
   * The label of the figure the surface shows, when it shows one. Where the
   * count is 0 it must read exactly 0 — an emptiness is a pass WITH a number,
   * never an absence (LOOK_AND_FEEL bar 1, admin-window/BUG-0027).
   */
  figure?: string;
  /**
   * Does a counted zero render the `Empty` card on this surface?
   *
   * True for a surface whose rows are the surface (a queue, a table). FALSE
   * for one that states its figure in every counted state and never draws an
   * empty card — the Dashboard's attention cards show `0` and stay `ok`, which
   * is the whole of LOOK_AND_FEEL bar 1. Defaults to true.
   */
  emptyAtZero?: boolean;
  /**
   * Sub-surfaces inside `within` that make their own read and carry their own
   * state, and so are not this surface's to answer for (see `stateOf`).
   */
  excluding?: string;
}

/**
 * Name the kind a surface is in, grade it against the test's own count, and
 * return it — the one place the four rules of ARCHITECTURE §10 are spelled.
 *
 *  - `error` is a FAIL, naming the surface and the page's own error line
 *    (which carries the read and the database's words).
 *  - `not_provisioned` passes only if this test's own read of `object` gets
 *    the absence code. Never inferred from "no rows rendered".
 *  - `empty` passes only with a counted 0 on both sides, and the labelled
 *    figure reading 0 where the surface has one.
 *  - `ok` is the only kind that goes on to compare rows, and it must not be
 *    what the page shows when the test counted nothing.
 *
 * The caller compares numbers only when this returns `"ok"`.
 */
export async function gradeSurface(input: SurfaceGrade): Promise<PageStateKind> {
  const kind = stateOf(input.markup, input.within, input.excluding);

  if (kind === "error") {
    throw new StateMismatchError(
      `'${input.within}' is in its ERROR state reading '${input.object}', so ` +
        `nothing on it may be graded green: ` +
        cardText(input.markup, input.within, "error"),
      input.within,
      "error",
      "ok",
    );
  }

  // The kind this test EXPECTS, decided by its OWN count and not by anything
  // the page said — the whole of rule 1.
  const counted =
    typeof input.counted === "function" ? await input.counted() : input.counted;
  const expected: PageStateKind =
    counted === "absent"
      ? "not_provisioned"
      : counted === 0 && (input.emptyAtZero ?? true)
        ? "empty"
        : "ok";

  if (kind === "not_provisioned") {
    // Rule 5: only this test's OWN read of the same object may establish an
    // absence, never "no rows rendered" and never the words on the card.
    if (counted !== "absent" && !(await objectIsAbsent(input.object))) {
      throw new StateMismatchError(
        `'${input.within}' says '${input.object}' is not provisioned, but ` +
          `this test's own read of it did not get an absence code ` +
          `(${ABSENCE_CODES.join(" / ")}); it counted ${counted}.`,
        input.within,
        "not_provisioned",
        expected,
      );
    }
    return kind;
  }

  if (counted === "absent") {
    throw new StateMismatchError(
      `this test's own read of '${input.object}' got the absence code, but ` +
        `'${input.within}' rendered its ${kind.toUpperCase()} state.`,
      input.within,
      kind,
      "not_provisioned",
    );
  }

  // `empty` and `ok` are both COUNTED states, so both are graded against the
  // number this test got, and against the figure the surface states.
  if (kind !== expected) {
    throw new StateMismatchError(
      `'${input.within}' rendered its ${kind.toUpperCase()} state, but this ` +
        `test counted ${counted} row(s) of '${input.object}', which is ` +
        `${expected.toUpperCase()}.`,
      input.within,
      kind,
      expected,
    );
  }
  if (input.figure !== undefined && counted === 0) {
    const shown = readNumber(input.markup, input.figure);
    if (shown !== 0) {
      throw new ParityError(
        `'${input.within}' counted nothing, so "${input.figure}" must read 0; ` +
          `it reads ${shown}.`,
        input.figure,
        shown,
        0,
      );
    }
  }
  return kind;
}

/* ── comparing against a database that is being written to ────────────────── */

/**
 * Make something from the page and read the database around it, and only hand
 * both back when the database did not move in between.
 *
 * Staging is LIVE: the resolver files a cycle every cadence and the adapters
 * file runs, so a row can arrive between a page's render and the query a test
 * compares it with — measured 2026-09-02, a `/cycles` comparison that rendered
 * 38 rows against a database that by then held 39. That is not a defect in the
 * page and it must not be reported as one.
 *
 * So `read` is issued BEFORE and AFTER `make`, and the pair is returned only
 * when the two reads agree that nothing moved; otherwise the whole thing is
 * tried again. It is not a retry-until-green: every attempt makes the SAME
 * exact comparison, and running out of attempts throws rather than passing —
 * a database that will not hold still is a fact the test states, not one it
 * swallows.
 */
export async function whileStill<Held, Made>(
  read: () => Promise<Held>,
  make: () => Promise<Made>,
  attempts = 3,
): Promise<{ made: Made; held: Held }> {
  let moved = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = await read();
    const made = await make();
    const held = await read();
    if (JSON.stringify(before) === JSON.stringify(held)) return { made, held };
    moved = `${JSON.stringify(before).length} then ${JSON.stringify(held).length} bytes`;
  }
  throw new Error(
    `the database changed under this comparison on all ${attempts} attempts ` +
      `(${moved}), so the page and the query were never looking at the same ` +
      `rows. This is a statement about staging, not a verdict on the page.`,
  );
}
