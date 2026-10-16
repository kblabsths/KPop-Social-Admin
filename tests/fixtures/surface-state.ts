/**
 * The markup readers every page twin grades a render with (campaign
 * admin-window; moved here from `tests/live/parity.ts` on 2026-10-16 when the
 * live tier became a read-only contract smoke and the parity oracles were
 * deleted — Ben's testing rules of 2026-09-16, README "Testing").
 *
 * Everything in this module is PURE: it reads a string of markup and answers
 * a question about it. It opens no socket, reads no environment and knows
 * nothing about any database. The offline suite renders a page against a
 * stub client and grades the result with these; nothing else uses them.
 *
 *  - `stateOf` / `assertState` / `pageStates` — the state classifier: which of
 *    the four kinds (`ok`, `empty`, `not_provisioned`, `error`) a surface is
 *    in, read structurally from `data-state` on the four `ui` state
 *    primitives, never from the prose inside a card.
 *  - `surfaceHooks` / `oneEach` — where each named `data-surface` hook lands.
 *  - `readNumber` — the figure a labelled card or cell shows.
 *
 * `tests/offline/live-guard.test.ts` pins each of these against markup
 * rendered from the real primitives.
 */
import * as cheerio from "cheerio";
import { EM_DASH } from "@/lib/format";

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
      `${where} is still in its LOADING state. A page twin grades a finished ` +
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
 *
 * INSIDE is literal: only a PROPER DESCENDANT of `within` can be excluded. An
 * `excluding` that also matches the surface itself, or any wrapper around it,
 * silences nothing — it can never empty the surface of its own cards, because
 * a surface holding an error line says `error` whatever a selector asks
 * (admin-window/BUG-0036).
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

  // The sub-surfaces `excluding` actually names HERE: the ones a `find` from
  // the graded surface reaches, which is every proper descendant of it and
  // nothing else. The surface itself and every wrapper around it are outside
  // this set by construction (admin-window/BUG-0036).
  const subSurfaces = new Set<unknown>(
    excluding === undefined ? [] : surface.find(excluding).toArray(),
  );

  const cards = surface
    .find("[data-state]")
    .toArray()
    .filter((element) => $(element).attr("data-state") !== DECLARED_OK)
    .filter((element) => {
      if (excluding === undefined || subSurfaces.size === 0) return true;
      // `closest()` starts at the card and walks EVERY ancestor — the surface
      // and the page around it included — so the match it returns silences
      // this card only where it is a PROPER DESCENDANT sub-surface. Without
      // that bound, an exclusion selector matching the surface itself dropped
      // every card the surface held, its ERROR line among them, and graded a
      // page in its error state `ok` (admin-window/BUG-0036).
      const owner = $(element).closest(excluding).toArray()[0];
      return owner === undefined || !subSurfaces.has(owner);
    })
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
 * Where each named surface hook lands in one render — the ADDRESSING that
 * every `stateOf` call on that markup depends on, read once and reported as
 * data (campaign admin-window/DEBT-0002).
 *
 * `stateOf` refuses any selector matching other than exactly one element, so
 * an oracle's addressing is a precondition, not a detail. Until
 * admin-window/DEBT-0002 six live oracles addressed their surfaces by POSITION
 * (`section:nth-of-type(n)`, sometimes compounded with a child position), and
 * on `/cycles` a single added section plus one `<div>` wrapper made one
 * selector match two surfaces: four live tests threw `MarkupReadError` at once
 * and none of them said why (admin-window/BUG-0040, admin-window/BUG-0056).
 * Asserting this report BEFORE grading turns the next such rearrangement into
 * one legible failure that names the hook.
 *
 * Two things are reported, because two different things go wrong:
 *
 *  - `counts` — how many elements each hook reaches. `1` for a surface that
 *    always renders; `0` is legitimate for one that does not render on this
 *    branch (the standing tab of `/claims` draws no bucket table), which is
 *    why the expected number is the caller's to state. Anything above 1 is the
 *    bug.
 *  - `nested` — every pair where one named surface sits INSIDE another, as
 *    `"outer contains inner"`. A hook can be unique and still wrong: a surface
 *    that swallows its neighbour grades its neighbour's state cards as its own.
 *
 * Returning data rather than asserting keeps one `expect` in the test, with a
 * diff that names the hook and the number — and keeps this module free of the
 * runner.
 */
export function surfaceHooks(
  markup: string,
  hooks: readonly string[],
): { counts: Record<string, number>; nested: string[] } {
  const $ = cheerio.load(markup);
  const counts: Record<string, number> = {};
  for (const hook of hooks) counts[hook] = $(hook).length;

  const nested: string[] = [];
  for (const outer of hooks) {
    for (const inner of hooks) {
      if (outer === inner) continue;
      if ($(outer).find(inner).length > 0) nested.push(`${outer} contains ${inner}`);
    }
  }
  return { counts, nested };
}

/** Every hook mapped to exactly one element — the usual expectation. */
export function oneEach(hooks: readonly string[]): Record<string, number> {
  return Object.fromEntries(hooks.map((hook) => [hook, 1]));
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
