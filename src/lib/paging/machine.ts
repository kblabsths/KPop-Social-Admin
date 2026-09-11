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

// ONE LINE EACH, deliberately: the leaf-closure guard in
// `tests/offline/db/layering.test.ts` reads imports LINE BY LINE, so a
// multi-line import's opening brace reads as an import naming no module at all
// and the leaf is reported as reaching outside itself.
import { isPageAnswer, isPageNotes, OFFSET_PARAM, type PageAnswer, type PageNote, type PageNotes } from "./bounds";
// The app's ONE definition of blank, ASKED rather than retyped (common
// violations row 15, admin-window/BUG-0176). `isAbsent` (`src/lib/format.ts`)
// is the same question one layer up and cannot be reached from a leaf —
// `format.ts` imports React, so importing it here would fail rule 7's closure
// (`tests/offline/db/layering.test.ts`) — and this is the very predicate
// `isAbsent` asks of a string, in the leaf that owns it (admin-window/BUG-0146
// took `trim()` out of `canonicalRecordId` for the same reason). A fresh
// `trim()` here would be the fourth copy of a character class four M2 bugs are
// already made of.
import { hasVisibleContent } from "@/lib/verdict/decision";

/**
 * Why a press added no rows — FACTS, in two conditions that are not the same
 * kind of thing (admin-window/BUG-0176).
 *
 * **`"broken"`** is a press THIS APP could not complete: the four red arms and
 * the route's own bound refusal. It carries the words, who wrote them, and
 * WHICH object they were about — `reading` for a failed read, the ROUTE when
 * the request or the body never got as far as an answer. `object` is `null`
 * for a bound refusal alone: the bound the server refused is the one this
 * state sent (`held`), so there is no third object to name, and the raw bound
 * is never pasted into a sentence this app wrote (common violations rows 15
 * and 20).
 *
 * **`"not provisioned"`** is the backing object being absent from this
 * database — an absence, never a breakage (LOOK_AND_FEEL, Palette: red means
 * broken, never unavailable). It carries the missing NAME and no prose at all:
 * this is a lib module and may not import a component (§4, one-way
 * dependency), so it cannot author the app's state-3 sentence, and a component
 * that owns that sentence is the only one that should. Composing a reason here
 * is also how the object came to be said twice — `pending_claims —
 * pending_claims …` — so a reason that does not name the object cannot repeat
 * it (admin-window/BUG-0176 criterion 2, structurally).
 */
export type PageRefusal =
  | {
      /** A press this app could not complete — the four red arms. */
      condition: "broken";
      reason: string;
      /**
       * Who wrote `reason` — the one question the FACE answers
       * (admin-window/BUG-0175).
       *
       *  `"this app"`    → prose this app composed; renders in the `body` sans
       *                    step, the face this app uses for its own words.
       *  `"the machine"` → words this app did not write — the answer's own
       *                    `message`, or whatever a failed fetch threw; renders
       *                    in the `data` mono step, where the operator reads it
       *                    as the machine talking.
       *
       * MEASURED defect: all five arms rendered in `type-data`, so
       * `canceling statement due to statement timeout` (Postgres said it) and
       * `the page request answered something this app cannot read` (we said it)
       * were the same 11px mono red run, and the operator lost the one signal
       * the type split exists to give.
       *
       * It is SET at `refuse()` — the single construction point every arm of
       * this condition passes through — and the component only reads it. It is
       * never recovered by comparing `reason` to one of this module's
       * constants: that is a rule retyped as data (LESSONS 4 and 5), and it
       * would silently flip a face the day one of those sentences is reworded.
       */
      reasonFrom: ReasonAuthor;
      object: string | null;
    }
  | {
      /** The backing object is not in this database — absence, not breakage. */
      condition: "not provisioned";
      /**
       * The object the ANSWER named, carried verbatim and rendered as an
       * isolated identifier by the component (admin-window/BUG-0176 criterion
       * 13). It is not always the name `tables.ts` gave the query — a
       * column-absent code mines the column out of the DATABASE's own message —
       * so nothing here or on the line may inline it into prose.
       */
      missing: string;
    };

/** The two answers to "who wrote this refusal's reason". */
export type ReasonAuthor = "this app" | "the machine";

/**
 * An `Error` whose message THIS APP composed — admin-window/BUG-0175.
 *
 * Declared once, here, beside the fact it decides. `fetchJson`
 * (`src/components/ui/paging.tsx`) throws its two authored sentences as one of
 * these; every other rejection that reaches `requestPage` carries a runtime's
 * own words (a network `TypeError`, a string, a non-`Error` value) and is
 * `"the machine"`.
 *
 * **Authorship travels with the THROW, never with the words.** The alternative
 * — asking whether a caught message equals `ANSWERED_BY_SOMETHING_ELSE` — is
 * the same rule written twice in two files, and a reworded sentence would move
 * a face without anything failing. A plain `Error` carrying, by coincidence,
 * the very text of one of this app's sentences is still the machine's: nothing
 * this app wrote threw it.
 */
export class AppAuthoredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppAuthoredError";
  }
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
 * 99 — so the server would serve a window this press never asked for. Since
 * admin-window/BUG-0176 `requestPage` refuses such an answer out loud rather
 * than appending it (rule 7), which is a louder failure and not a fix: a
 * surface whose every press is refused still never advances.
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
function withRefusal<Row>(state: PageState<Row>, refusal: PageRefusal): PageState<Row> {
  return {
    rows: state.rows,
    held: state.held,
    status: "idle",
    refusal,
    notes: state.notes,
  };
}

/**
 * What the line says when the refusal that reached it carried NO WORDS —
 * admin-window/BUG-0176, criterion 14.
 *
 * MEASURED: `{kind:"refused", reason:""}` reached the operator as an empty
 * `type-body` span followed by "Press it again to ask for the same rows." —
 * copy bar 3 inverted, what-to-do with nothing that failed, inside a
 * `role="alert"` that announces it.
 *
 * It is the PAGING layer's own clause, about a PRESS. `lib/db/result.ts` has a
 * twin for a READ; it is module-private there, it is about a different event,
 * and one identifier meaning two things is common violations row 18 — so
 * neither that constant nor its sentence appears here. Like it, this says only
 * what the app knows: nothing is attributed to the database, no number is
 * invented, and no HTTP status is named (nothing in this module can see one).
 */
const WORDLESS_REFUSAL = "this press was refused and nothing came back to say why";

/**
 * A refusal that adds no rows, for the BROKEN condition — the words, their
 * author, and the object they were about.
 *
 * **A refusal with no words is worded by this app** (admin-window/BUG-0176).
 * The substitution is here, at the single construction point every
 * reason-carrying arm passes through, so no arm has to remember it and the
 * component gains no branch. The author flips WITH the words: the clause is
 * this app's sentence, so a wordless `error` arm must not render it in the
 * machine's face. Blank is the app's ONE definition of blank, asked of
 * `hasVisibleContent` — never a fresh `trim()` and never a second predicate.
 *
 * The not-provisioned condition does not come through here: after
 * admin-window/BUG-0176 it carries a fact and no reason at all, and its words
 * are the component's.
 */
function refuse<Row>(
  state: PageState<Row>,
  reason: string,
  object: string | null,
  /**
   * Stated by the arm, never inferred from `reason`. It has no default on
   * purpose: a new arm must answer the question rather than inherit whichever
   * face the last one happened to want (admin-window/BUG-0175).
   */
  reasonFrom: ReasonAuthor,
): PageState<Row> {
  const wordless = !hasVisibleContent(reason);
  return withRefusal(state, {
    condition: "broken",
    reason: wordless ? WORDLESS_REFUSAL : reason,
    reasonFrom: wordless ? "this app" : reasonFrom,
    object,
  });
}

/**
 * The absent-object refusal: the NAME the answer gave, and nothing else.
 *
 * No sentence is composed around it — see `PageRefusal` above. The component
 * renders the app's one spelling of state 3 (`NotProvisionedClause`,
 * `src/components/ui/not-provisioned.tsx`), in gray, with the object in its own
 * isolated identifier box and no instruction to press anything: a press does
 * not provision a table (admin-window/BUG-0176).
 */
function refuseAbsent<Row>(state: PageState<Row>, missing: string): PageState<Row> {
  return withRefusal(state, { condition: "not provisioned", missing });
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
 * The page answered a DIFFERENT point in the set from the one this press asked
 * for — admin-window/BUG-0176, criterion 11 (QA's residual off BUG-0174).
 *
 * Same class as its two neighbours and carrying no figure for the same reason:
 * not the bound this press sent, and decisively not the one the answer
 * declared (common violations row 15 — a figure this app did not compute is
 * not quoted back as ours).
 */
const UNASKED_PAGE =
  "the page arrived for a different point in the set than this press asked for, so it is not the page this view asked for";

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
 * A rejection, as a refusal: its words AND who wrote them, decided together at
 * one point so the two can never disagree (admin-window/BUG-0175).
 *
 * This is the ONE site that cannot answer the authorship question at the call:
 * a rejected `fetchJson` carries either a sentence this app composed or a
 * runtime's own words, and only the thrown VALUE says which. `instanceof` is
 * the whole derivation — no message is compared to anything.
 */
function refusalFor(thrown: unknown): { reason: string; reasonFrom: ReasonAuthor } {
  if (thrown instanceof AppAuthoredError && thrown.message.length > 0) {
    return { reason: thrown.message, reasonFrom: "this app" };
  }
  return { reason: reasonOf(thrown), reasonFrom: "the machine" };
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
 *  7. **A page this press did not ask for is refused** (admin-window/BUG-0176).
 *     Every `ok` answer declares the bound it was served for; one that is not
 *     the bound this press carried is refused on rule 4's terms, before the
 *     rows, the exhaustion arm and the notes are read at all.
 *
 * The answer's own `offset` is read as a GRADE and never as a value (rule 7):
 * it decides whether this is the page this press asked for, and `held` still
 * grows by the rows that actually arrived, so a server echoing some other
 * bound can never make this surface claim rows it does not hold. Under rule 2
 * those rows are exactly one window on every continuing page, which is what
 * keeps the invariant true: after any press, either
 * `pageBound(String(held), deps.size)` is `ok` or the status is `exhausted` —
 * `held` leaves the bound grid only on the final page.
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
    const { reason, reasonFrom } = refusalFor(thrown);
    return refuse(state, reason, deps.route, reasonFrom);
  }

  if (!isPageAnswer(body)) {
    // This app's own sentence about what arrived — it quotes nothing.
    return refuse(
      state,
      "the page request answered something this app cannot read",
      deps.route,
      "this app",
    );
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
        return refuse(state, WINDOWLESS, deps.route, "this app");
      }

      // THE PAGE THIS PRESS ASKED FOR, OR NO PAGE AT ALL — admin-window/BUG-0176.
      //
      // `requestPage` asks for `state.held` and every `ok` answer DECLARES the
      // bound it was served for (`isPageAnswer` requires the field), so the two
      // are compared. Read HERE — before the empty-page arm and before the
      // notes — so a page this press did not ask for reaches the state by no
      // path at all: not as rows, not as exhaustion, not as a leg's note. A
      // full window of offset-0 rows answered to a press carrying 50 used to be
      // appended in silence, so the list held one window twice, while an
      // OVER-LONG page from that same answer was refused out loud.
      //
      // Refused on exactly OVERLONG_PAGE's terms, and reachable only if a route
      // misanswers: both of this app's own routes echo `pageBound`'s own
      // `offset` (`src/app/api/admin/claims/rows/route.ts`,
      // `src/app/api/admin/browse/rows/route.ts`), so nothing this app serves
      // is refused by this line.
      if (answer.offset !== state.held) {
        return refuse(state, UNASKED_PAGE, deps.route, "this app");
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
        return refuse(state, OVERLONG_PAGE, deps.route, "this app");
      }
      if (served < deps.size && !answer.exhausted) {
        return refuse(state, SHORT_PAGE, deps.route, "this app");
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
        if (!isPageNotes(reported)) return refuse(state, UNREADABLE_NOTES, deps.route, "this app");
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
      // The FACT alone: the name the answer gave, and no prose composed around
      // it (admin-window/BUG-0176). The words, the gray ink and the absence of
      // any press-again instruction belong to the component, which renders the
      // app's one spelling of this sentence.
      return refuseAbsent(state, answer.missing);
    case "error":
      // The only arm whose reason is not ours: the database's own string,
      // carried across the wire byte-identical (§4.1).
      return refuse(state, answer.message, answer.reading, "the machine");
    case "refused":
      // The route's own bound refusal, written by `src/lib/paging/bounds.ts` —
      // which is this app, on the other side of a fetch.
      return refuse(state, answer.reason, null, "this app");
  }
}
