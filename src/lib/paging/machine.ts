/**
 * The one-press paging driver — campaign admin-window/TASK-0063.
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7). Its ONE import is another
 * leaf, `./bounds`, which rule 7 ¶2 permits: the route spelling and the answer
 * shape are that file's, asked rather than retyped here. It reaches nothing
 * that can reach a database — the request itself arrives as `fetchJson`, a
 * dependency the caller hands in.
 *
 * **Why a directiveless module and not a React hook** (§4 rule 1's amended
 * exception, 2026-09-10). This repo's offline tier has no DOM —
 * `renderToStaticMarkup` only — so a press cannot be simulated and a click
 * handler that owns its own logic cannot be tested here at all. Every decision
 * paging makes therefore lives here, where the offline suite drives it
 * DIRECTLY against a recording stub, and the client hook is a two-line binding
 * to it.
 *
 * **Nothing here throws.** A rejected fetch, a body that is not JSON and a
 * body that is JSON but not a `PageAnswer` all come back as a refusal on the
 * next state, exactly as a refused read does (§4.1: the data layer never
 * throws; the same promise across the wire).
 *
 * **`requestPage` publishes no `loading` state of its own.** It answers with
 * the state a press ENDS in; the interim is `pressing` (added by
 * admin-window/TASK-0064), which a caller publishes before awaiting, and the
 * `loading` arm below is what makes that safe — a second press on a state
 * already loading issues no request at all.
 */

// ONE line, deliberately: the leaf-closure guard in
// `tests/offline/db/layering.test.ts` reads imports LINE BY LINE, so a
// multi-line import's opening brace reads as an import naming no module at all
// and the leaf is reported as reaching outside itself.
import { isPageAnswer, isPageNotes, OFFSET_PARAM, type PageAnswer, type PageNote, type PageNotes } from "./bounds";

/**
 * Why a press added no rows, and WHICH object it was about.
 *
 * `object` is the name the answer itself named — `missing` for a
 * not-provisioned read, `reading` for a failed one, and the ROUTE when the
 * request or the body never got as far as an answer. It is `null` for a bound
 * refusal alone: the bound the server refused is the one this state sent
 * (`held`), so there is no third object to name, and the raw bound is never
 * pasted into a sentence this app wrote (common violations rows 15 and 20).
 */
export interface PageRefusal {
  reason: string;
  object: string | null;
}

/** Everything one paging surface knows between presses. */
export interface PageState<Row> {
  /** The rows PAGED IN so far — never the first screen's. */
  readonly rows: readonly Row[];
  /** First screen + paged in. This is the next bound. */
  readonly held: number;
  readonly status: "idle" | "loading" | "exhausted";
  readonly refusal: PageRefusal | null;
  /**
   * The legs that reported on the pages THIS STATE has taken in — never the
   * first screen's, which are the page's own to render, exactly as `rows`
   * holds no first-screen row (admin-window/TASK-0076).
   *
   * `null` means no page this state took in said anything about its legs: a
   * surface whose route carries no notes at all (`/claims`) never leaves this
   * field.
   */
  readonly notes: PageNotes | null;
}

/**
 * The state a press publishes BEFORE its request resolves — campaign
 * admin-window/TASK-0064.
 *
 * `idle` becomes `loading` with `rows`, `held` and `refusal` untouched; any
 * other status comes back as **the SAME object**, so a caller comparing
 * identity can see that a second press changed nothing and never publish a
 * re-render for it.
 *
 * It lives here, in the leaf, rather than in the hook that calls it, for the
 * reason every other paging decision does: this suite has no DOM, so a rule
 * written inside a click handler is a rule nothing can drive. Composed with
 * `requestPage` it is also the whole double-press proof — `requestPage` on a
 * `pressing()` state issues zero requests (rule 1 below) — and that
 * composition is what a caller is obliged to reproduce.
 *
 * The pairing with `requestPage` is deliberate and is the caller's contract:
 * the interim state is PUBLISHED, and the state handed to `requestPage` is the
 * PRE-press one, because `requestPage` refuses to work from `loading` by
 * design.
 *
 * The standing refusal is carried through rather than cleared: it is still the
 * only account of why the last press added nothing, and blanking it the moment
 * the operator acts on it would leave the retry unexplained. `requestPage`
 * clears it when a press succeeds.
 */
export function pressing<Row>(state: PageState<Row>): PageState<Row> {
  if (state.status !== "idle") return state;
  return {
    rows: state.rows,
    held: state.held,
    status: "loading",
    refusal: state.refusal,
    // Carried through untouched: a press in flight has not changed what the
    // pages already taken in reported about their legs.
    notes: state.notes,
  };
}

/**
 * The state a surface starts a press-less life in: the server rendered `held`
 * rows and this module holds none of them, and `more` — the first screen's own
 * answer about whether anything follows — decides whether a press is offered
 * at all. `more: false` starts exhausted, because a control that cannot be
 * honoured is never offered (SPEC F10's rule).
 */
export function initialPage<Row>(held: number, more: boolean): PageState<Row> {
  // `notes: null` — a surface's FIRST screen renders its own legs
  // server-side; this state holds only what PRESSES brought.
  return { rows: [], held, status: more ? "idle" : "exhausted", refusal: null, notes: null };
}

/** What one press needs: where to ask, what to carry, and how to ask. */
export interface PageDeps {
  /** `PAGE_ROUTES[...]` — this app's own route, by a relative path. */
  readonly route: string;
  /** The surface's own facets, already serialized (`a=1&b=2`, or empty). */
  readonly params: string;
  /**
   * The window the SERVER decides. It is never read from the URL.
   *
   * READ HERE, by rule 2: it is the number a page is graded full-or-short
   * against, and the one the invariant on `held` is checked with. A surface
   * spells it ONCE and hands the same value to the widget through
   * `usePageRows` — a second copy typed beside this one is what let `held`
   * leave the grid in the first place (admin-window/BUG-0168).
   */
  readonly size: number;
  /** One request, already parsed. It may reject; a refusal is the answer. */
  readonly fetchJson: (url: string) => Promise<unknown>;
}

/**
 * The URL one press asks for — `route?params&offset=<offset>`.
 *
 * The bound OVERRIDES rather than joins: whatever a surface serialized into
 * `params`, the query this returns carries `OFFSET_PARAM` exactly ONCE and
 * that occurrence is this press's bound. It is composed with
 * `URLSearchParams`, not by concatenation, because appending is not overriding
 * (admin-window/BUG-0166): `?offset=99&offset=4` is a legal query whose FIRST
 * occurrence is what a handler reading `searchParams.get()` gets — the stale
 * 99 — so the server would serve a window this press never asked for, which
 * `requestPage` cannot notice because it deliberately never reads the answer's
 * own `offset` back into state.
 *
 * `delete` then `append`, rather than `set`, so the bound is still written
 * LAST: `set` keeps a stale parameter's original position. The surface's own
 * facets survive in the order the caller wrote them, and a leading `?` or `&`
 * on `params` is tolerated because a caller composing a query string has every
 * reason to include one.
 */
export function pageUrl(deps: PageDeps, offset: number): string {
  const facets = new URLSearchParams(deps.params.replace(/^[?&]+/, "").replace(/&+$/, ""));
  facets.delete(OFFSET_PARAM);
  facets.append(OFFSET_PARAM, String(offset));
  return `${deps.route}?${facets.toString()}`;
}

/**
 * A refusal that adds no rows: the list, the bound, the order and the standing
 * leg notes all stand.
 *
 * The notes survive a refusal for the same reason the rows do — they are the
 * account of columns that are STILL unfilled on screen, and a press that added
 * nothing cannot have filled them.
 */
function refuse<Row>(state: PageState<Row>, reason: string, object: string | null): PageState<Row> {
  return {
    rows: state.rows,
    held: state.held,
    status: "idle",
    refusal: { reason, object },
    notes: state.notes,
  };
}

/**
 * The standing notes, plus what this page reported — MERGED per key, campaign
 * admin-window/TASK-0076.
 *
 * A key already carrying a note KEEPS it; a key that is absent or `null` takes
 * whatever the new page carried. **Why merge and not replace:** the rows a
 * refused leg left unfilled are still on screen after the next press, so a
 * note that vanished when a later page's legs answered would be the
 * silently-empty-column defect one press later.
 *
 * Nothing is read, trimmed, reworded or rendered here: the note objects reach
 * the state byte-identical to what the answer carried, because the words an
 * operator reads are the database's own (§4.1, common violations row 15).
 *
 * Built through `Object.fromEntries` rather than by assigning a computed key:
 * the keys come off a JSON body, and `merged["__proto__"] = note` would set a
 * prototype instead of adding an entry.
 */
function mergedNotes(standing: PageNotes | null, arrived: PageNotes): PageNotes {
  const merged = new Map<string, PageNote | null>(Object.entries(standing ?? {}));
  for (const [key, note] of Object.entries(arrived)) {
    // Absent or null takes the new report; a standing note is never overwritten.
    if ((merged.get(key) ?? null) === null) merged.set(key, note);
  }
  return Object.fromEntries(merged);
}

/**
 * The three ways an `ok` answer is not a page this view may hold — campaign
 * admin-window/BUG-0168, the client half of full-or-exhausted (ARCHITECTURE.md
 * §4.3 read kind 3).
 *
 * They carry no figure on purpose. This module is a pure leaf and cannot reach
 * `lib/format`'s `counted`, which is the app's ONE pluralisation rule, and a
 * hand-written "1 rows" beside a window of one is exactly the disagreement
 * that rule exists to stop. The window is the surface's own number and the
 * operator is already told it by the control's label.
 */
const SHORT_PAGE =
  "the page arrived short of this view's window and did not say the set had ended, so it may be missing rows";
const OVERLONG_PAGE =
  "the page arrived with more rows than this view's window, so it is not the page this view asked for";
const WINDOWLESS =
  "this view has no window size to read a page by, so no page can be honoured";

/**
 * A page whose legs reported in a vocabulary this app does not know — campaign
 * admin-window/TASK-0076.
 *
 * Appending the rows and dropping the notes is the defect this sentence exists
 * to close; rendering a note this app cannot read is the one thing worse than
 * dropping it. Like its two neighbours it carries no figure and — decisively —
 * not one character of the foreign field it refused (common violations row 15).
 */
const UNREADABLE_NOTES =
  "the page reported on its own columns in a form this app cannot read, so none of it was taken in";

/** The words a thrown or rejected value carries, without asking it to be an Error. */
function reasonOf(thrown: unknown): string {
  if (thrown instanceof Error && thrown.message.length > 0) return thrown.message;
  if (typeof thrown === "string" && thrown.length > 0) return thrown;
  return String(thrown);
}

/**
 * ONE press. Returns the next state; never throws.
 *
 * In order (ARCHITECTURE.md §4.3 read kind 3, SPEC F14):
 *
 *  1. **One press, one request; no press, no request.** From `loading` or
 *     `exhausted` this calls `fetchJson` ZERO times and returns the state
 *     unchanged — the same object, so a caller comparing identity sees that
 *     nothing happened. From `idle` it makes exactly ONE call.
 *  2. **An `ok` answer is FULL-OR-EXHAUSTED, or it is refused out loud**
 *     (ruled 2026-09-10, admin-window/BUG-0168; DECISIONS.md, "a paged answer
 *     is full-or-exhausted"). A full window — `rows.length === deps.size` —
 *     appends in the order received, grows `held` by the WINDOW and clears the
 *     refusal. A page that says the set has ended may be shorter, and appends
 *     what it carries. Anything else — short and still continuing, or longer
 *     than the window — is a refusal by rule 4, because the alternative is
 *     inferring the end of a set from a row count and telling the operator a
 *     truncated read is the whole of it.
 *  3. **An `ok` answer with zero rows is exhaustion**, not a refusal: the end
 *     of a set is an answer, and the rows are unchanged.
 *  4. **A refusal never extends the list** (M3 EC5): the rows come back with
 *     the same length, the same members and the same order, `held` is
 *     unchanged so the next press asks for the same bound, the refusal names
 *     the object, and `status` returns to `idle` so the operator may retry.
 *  5. **Foreign data is a refusal, never a throw**: a rejected `fetchJson`, a
 *     body that never parsed, and a body `isPageAnswer` rejects all refuse
 *     naming the route.
 *  6. **The legs a page brought reach the state, or the press is refused**
 *     (admin-window/TASK-0076). An `ok` answer carrying a `notes` field must
 *     satisfy `isPageNotes`; a readable one MERGES per key into `state.notes`
 *     and an unreadable one refuses naming the route, appending nothing. An
 *     answer with no `notes` field leaves the standing notes exactly as they
 *     were. A page whose provenance leg refused must not reach the operator as
 *     rows with a silently empty column, and no surface can render what the
 *     state does not carry.
 *
 * The answer's own `offset` is not read into the state: `held` grows by the
 * rows that actually arrived, so a server echoing some other bound can never
 * make this surface claim rows it does not hold. Under rule 2 those rows are
 * exactly one window on every continuing page, which is what keeps the
 * invariant true: after any press, either `pageBound(String(held), deps.size)`
 * is `ok` or the status is `exhausted` — `held` leaves the bound grid only on
 * the final page.
 */
export async function requestPage<Row>(
  state: PageState<Row>,
  deps: PageDeps,
): Promise<PageState<Row>> {
  if (state.status !== "idle") return state;

  let body: unknown;
  try {
    body = await deps.fetchJson(pageUrl(deps, state.held));
  } catch (thrown) {
    return refuse(state, reasonOf(thrown), deps.route);
  }

  if (!isPageAnswer(body)) {
    return refuse(state, "the page request answered something this app cannot read", deps.route);
  }
  const answer = body as PageAnswer<Row>;

  switch (answer.kind) {
    case "ok": {
      const served = answer.rows.length;

      // A window that is not a window grades nothing: no page can be checked
      // against it, and `pageBound` refuses every bound built from it, so the
      // honest answer is a refusal rather than a list grown by an amount
      // nobody can check.
      if (!Number.isInteger(deps.size) || deps.size <= 0) {
        return refuse(state, WINDOWLESS, deps.route);
      }

      // An empty page is the end of the set, and is the ONE row count this
      // arm still reads that way: there is no row to append, no bound to move,
      // and a page past the end is an answer rather than a refusal (rule 3).
      // Unchanged by admin-window/BUG-0168.
      if (served === 0) {
        // The standing notes stand: an empty page appended no row, so it left
        // no column for a leg to have failed to fill.
        return {
          rows: state.rows,
          held: state.held,
          status: "exhausted",
          refusal: null,
          notes: state.notes,
        };
      }

      // Full-or-exhausted, the client half (rule 2). Neither refusal is
      // reachable from this app's own route, which derives `exhausted` from
      // the read it just made and never serves a partial or over-long window:
      // they exist for foreign data on a wire, exactly as `isPageAnswer`'s arm
      // does.
      if (served > deps.size) {
        return refuse(state, OVERLONG_PAGE, deps.route);
      }
      if (served < deps.size && !answer.exhausted) {
        return refuse(state, SHORT_PAGE, deps.route);
      }

      // THE LEGS TRAVEL TO THE STATE, OR THE PRESS IS REFUSED — never dropped.
      // Read AFTER the full-or-exhausted rules and BEFORE the append, so a
      // page refused for its row count never reaches the notes at all and a
      // page refused for its notes appends nothing.
      //
      // An answer with NO `notes` property changes nothing: `/claims`' route
      // carries none, and its state keeps whatever it held.
      let notes = state.notes;
      if (Object.hasOwn(answer, "notes")) {
        const reported = (answer as { notes?: unknown }).notes;
        if (!isPageNotes(reported)) return refuse(state, UNREADABLE_NOTES, deps.route);
        notes = mergedNotes(state.notes, reported);
      }

      return {
        rows: [...state.rows, ...answer.rows],
        // By the WINDOW on every continuing page, so the next bound is on the
        // grid `pageBound` enforces BY CONSTRUCTION; only a final page — which
        // ends `exhausted` — may leave it.
        held: state.held + served,
        status: answer.exhausted ? "exhausted" : "idle",
        refusal: null,
        notes,
      };
    }
    case "not_provisioned":
      return refuse(state, `${answer.missing} is not provisioned`, answer.missing);
    case "error":
      return refuse(state, answer.message, answer.reading);
    case "refused":
      return refuse(state, answer.reason, null);
  }
}
