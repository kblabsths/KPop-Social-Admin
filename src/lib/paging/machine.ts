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
// The app's ONE spelling of "who wrote these words", and the join that makes a
// flat account the join of its runs (admin-window/BUG-0196). `ReasonAuthor`
// was declared HERE until that ticket; it moved down so `lib/db/result.ts` —
// which decides the fact where each clause is authored — can reach the same
// type, and it is re-exported below so this module's name for it still
// resolves.
import { accountText, type AccountSegment, type ReasonAuthor } from "@/lib/account/authored";
// The app's ONE definition of blank, ASKED rather than retyped (common
// violations row 15, admin-window/BUG-0176). `isAbsent` (`src/lib/format.ts`)
// is the same question one layer up and cannot be reached from a leaf —
// `format.ts` imports React, so importing it here would fail rule 7's closure
// (`tests/offline/db/layering.test.ts`) — and this is the very predicate
// `isAbsent` asks of a string, in the leaf that owns it (admin-window/BUG-0146
// took `trim()` out of `canonicalRecordId` for the same reason). A fresh
// `trim()` here would be the fourth copy of a character class four M2 bugs are
// already made of.
import { isAbsentText } from "@/lib/verdict/decision";

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
      /**
       * The whole account as ONE string — the JOIN of `account`, derived at
       * `refuse()`, the single construction point, and never authored beside
       * it (`accountText`, admin-window/BUG-0196). It is what the "no words"
       * question is asked of, because a refusal that puts no ink on the page
       * is wordless whatever its runs.
       */
      reason: string;
      /**
       * The account as its RUNS — the words of each part and WHO WROTE THEM,
       * in order. The one question the FACE answers (admin-window/BUG-0175,
       * widened to a list by admin-window/BUG-0196).
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
       * the type split exists to give. MEASURED again one milestone later: a
       * failed READ's account carries BOTH authors in one sentence — the
       * database's words and this app's counted clause about the part it
       * refused to quote — which is why one author per refusal was not enough
       * and this is a list.
       *
       * Every arm but the failed read's has exactly ONE run: it is one
       * sentence with one author. It is SET at `refuse()` — the single
       * construction point every arm of this condition passes through — and
       * the component only reads it. It is never recovered by comparing
       * `reason` to one of this module's constants: that is a rule retyped as
       * data (LESSONS 4 and 5), and it would silently flip a face the day one
       * of those sentences is reworded.
       */
      account: readonly AccountSegment[];
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

/**
 * The two answers to "who wrote this refusal's reason", RE-EXPORTED from the
 * leaf that now owns them (`src/lib/account/authored.ts`).
 *
 * One vocabulary for this fact in this app: the type is declared once, below
 * both sides, so `lib/db/result.ts` — which decides the fact where each clause
 * is written — and this module name the SAME two spellings. A second
 * two-valued type would be the defect, not a style choice
 * (admin-window/BUG-0196 criterion 5a). The name stays reachable here because
 * this is where every caller already asks for it.
 */
export type { ReasonAuthor };

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
  /**
   * THE ROW EVERY PAGE THIS STATE TOOK IN COMES AFTER — the last row of the
   * FIRST SCREEN this state continues (admin-window/BUG-0216).
   *
   * A paged surface renders the first screen's rows CONCATENATED with the rows
   * this state holds, and that concatenation is one contiguous run of one
   * order only while the first screen still ends where this state started
   * counting from. The first screen is the SERVER's, and the server can render
   * it again under a client that kept its state — `router.refresh()`, and in
   * `next dev` the `[Fast Refresh]` that follows compiling a route handler on
   * demand. When a claim settles ahead of the bound between those two renders,
   * every later row moves up one: the row this state took in as the first of
   * its second page is now the LAST row of the new first screen, and the
   * surface renders it twice while the row that moved into its place is never
   * rendered at all.
   *
   * So the state DECLARES what it continues, and `continuing()` below is the
   * one comparison that decides whether it still may. It is an id and not a
   * row count: a first screen the same size whose last row changed is a
   * different bound, and one whose rows churned ABOVE an unchanged last row is
   * the same bound — which is exactly what contiguity at the boundary turns
   * on.
   *
   * The empty string is a state that continues no particular first screen —
   * what a driver walked from a synthetic start holds. It only ever compares
   * equal to another empty string, so a surface that spells a bound is never
   * silently matched against one that does not.
   */
  readonly after: string;
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
    // Nor which first screen it continues — the bound a press asks from is the
    // one this state was seeded with (admin-window/BUG-0216).
    after: state.after,
  };
}

/**
 * The state a surface starts a press-less life in: the server rendered `held`
 * rows and this module holds none of them, and `more` — the first screen's own
 * answer about whether anything follows — decides whether a press is offered
 * at all. `more: false` starts exhausted, because a control that cannot be
 * honoured is never offered (SPEC F10's rule).
 */
export function initialPage<Row>(
  held: number,
  more: boolean,
  /**
   * The id of the first screen's LAST row — the bound every page this state
   * takes in will come after (admin-window/BUG-0216). It is a REQUIRED
   * argument rather than one with a default because a surface that does not
   * say what it continues cannot be told that the thing it continues changed,
   * and that silence is the defect (LESSONS 8). `""` is the honest value for a
   * driver started from a synthetic first screen.
   */
  after: string,
): PageState<Row> {
  // `notes: null` — a surface's FIRST screen renders its own legs
  // server-side; this state holds only what PRESSES brought.
  return {
    rows: [],
    held,
    status: more ? "idle" : "exhausted",
    refusal: null,
    notes: null,
    after,
  };
}

/**
 * THE BOUND A FIRST SCREEN ENDS AT — the `after` every paged surface hands
 * `initialPage` (admin-window/BUG-0216).
 *
 * One exported spelling rather than `rows[rows.length - 1]?.id ?? ""` retyped
 * on each surface (LESSONS 5), and the `id` it is given must be the SAME one
 * the list draws its React keys from: the bound is what the surface renders
 * its rows under, so a bound derived from a different field would compare two
 * screens by something the operator is not looking at.
 *
 * A first screen with no rows ends at no bound and answers `""`. No paged
 * surface draws a control over an empty first screen, so this is the state
 * that never presses rather than a bound anything continues from.
 */
export function boundOf<Row>(rows: readonly Row[], id: (row: Row) => string): string {
  const last = rows[rows.length - 1];
  return last === undefined ? "" : id(last);
}

/**
 * THE STATE A SURFACE MAY STILL DRAW — campaign admin-window/BUG-0216.
 *
 * A paged surface renders `[...firstScreen, ...state.rows]`, and the FIRST
 * SCREEN is the server's: it is re-rendered, with fresh rows, whenever the
 * router refreshes the route under a client that kept its state. `usePageRows`
 * seeds its `useState` from the first screen ONCE, at mount, so before this
 * function the rows a press had appended survived a first screen they no
 * longer continued — and one claim settled ahead of the bound put the same
 * claim on screen twice and left the claim that replaced it off the surface
 * altogether (measured on staging 2026-09-11: `01a058f1-02c7-…`, 100 rows, 99
 * distinct, React's duplicate-key warning in the console).
 *
 * The rule, stated as the property rather than as the defect: **what a paged
 * surface renders is always ONE contiguous run of ONE order — the first screen
 * it now holds, plus the pages taken from the bound THAT screen ends at.** So
 * a state whose `after` is not the current first screen's `after` does not
 * continue it, and the surface starts again from the screen it actually has.
 * Nothing is merged, de-duplicated or repaired: a continuation that is not one
 * is dropped whole, because the rows it holds are a window of an order the
 * operator is no longer looking at.
 *
 * It also decides the press that was IN FLIGHT when the screen changed: that
 * press's answer is published carrying the OLD `after` (every transition
 * carries it through), so the next render hands it here and it is dropped by
 * the same one comparison — no second guard, no cancellation token.
 */
export function continuing<Row>(
  state: PageState<Row>,
  initial: PageState<Row>,
): PageState<Row> {
  return state.after === initial.after ? state : initial;
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
    after: state.after,
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
 * machine's face.
 *
 * **"No words" is the app's ABSENCE question, asked of `isAbsentText`**
 * (`lib/verdict/decision.ts`, admin-window/BUG-0184) — never a fresh `trim()`,
 * never a retyped character and never a second predicate. It asks the WHOLE
 * question rather than its first clause: a reason that puts no ink on the page
 * is wordless, and so is a reason that is nothing but the app's own em dash,
 * which is what `nullDash()` draws for a value nobody filled in. Asking
 * `hasVisibleContent` here let a lone dash through as words, and the operator
 * met a red alert that named no failure and still told them to press again.
 * The predicate moved into the leaf so this module — which may import neither
 * React nor `lib/format.ts` — can reach the same one body `isAbsent` uses.
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
  return refuseAccount(state, [{ words: reason, author: reasonFrom }], object);
}

/**
 * The same refusal, for an account that is more than one sentence — campaign
 * admin-window/BUG-0196.
 *
 * THE construction point: `refuse` above is this function with a list of one,
 * which is what every arm but the failed read's carries. The wordless
 * substitution and the flat `reason` are therefore written ONCE, and a new arm
 * inherits both by construction.
 *
 * `reason` is DERIVED here — `accountText(account)` — and never passed in
 * beside the runs, so the string an operator reads as one sentence and the
 * runs that decide its faces cannot disagree. It is the same relationship
 * `message` has to the same runs one seam earlier (§4.1,
 * `src/lib/db/result.ts`).
 *
 * The account is carried VERBATIM otherwise: nothing here re-reads it, merges
 * it, trims it or re-authors it. The run-splitting a renderer needs is one
 * derivation in the leaf (`accountRuns`), asked at the point of drawing.
 */
function refuseAccount<Row>(
  state: PageState<Row>,
  account: readonly AccountSegment[],
  object: string | null,
): PageState<Row> {
  const reason = accountText(account);
  const wordless = isAbsentText(reason);
  return withRefusal(state, {
    condition: "broken",
    reason: wordless ? WORDLESS_REFUSAL : reason,
    // The author flips WITH the words: a wordless account is replaced by this
    // app's own clause, so its one run is this app's.
    account: wordless ? [{ words: WORDLESS_REFUSAL, author: "this app" }] : account,
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
function refusalFor(thrown: unknown): AccountSegment[] {
  if (thrown instanceof AppAuthoredError && thrown.message.length > 0) {
    return [{ words: thrown.message, author: "this app" }];
  }
  return [{ words: reasonOf(thrown), author: "the machine" }];
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
 * those rows are exactly ONE WINDOW on every continuing page, so `held` walks
 * the grid `pageBound` (`./bounds`) enforces instead of wandering off it.
 *
 * **The two places `held` may sit OFF that grid** — both of them honest, and
 * neither of them this module's to repair (admin-window/DEBT-0017; the
 * sentence that stood here named only the first and was false at the second):
 *
 *  1. **The FINAL page**, short or empty, which ends `exhausted`. There is no
 *     next bound to serve, so a refused `pageBound(String(held), deps.size)`
 *     is the honest answer and the widget's exhausted arm is what is drawn.
 *  2. **The CEILING.** `pageBound` refuses every bound above
 *     `MAX_PAGE_OFFSET`, and a full window served AT that ceiling appends by
 *     rule 2 like any other page: `held` becomes `MAX_PAGE_OFFSET +
 *     deps.size`, the answer's `exhausted` is false, and the status is
 *     `idle`. Nothing here clamps it and nothing here may: the set is not
 *     over, and a driver that said it was would be inventing the end of a set
 *     from a number — the very defect rule 2 exists to stop. `PageMore`
 *     (`src/components/ui/paging.tsx`) asks `pageBound` of that next bound and
 *     draws its LIMIT arm, which withdraws the control without claiming the
 *     set finished; that is where this state is answered, by the ruling of
 *     2026-09-10 (admin-window/TASK-0067).
 *
 * So the rule that HOLDS after any press is: `held` grew by one window, by a
 * short final page, or not at all, and the bound the next press would carry
 * is servable unless the status is `exhausted` or the bound is past
 * `MAX_PAGE_OFFSET`. Both escapes are driven in
 * `tests/offline/paging/machine.test.ts`.
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
    return refuseAccount(state, refusalFor(thrown), deps.route);
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
          after: state.after,
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
        // grid `pageBound` enforces BY CONSTRUCTION — except at the two places
        // the header names: a final page, which ends `exhausted`, and the
        // `MAX_PAGE_OFFSET` ceiling, where a full window still lands and the
        // widget's limit arm is the answer.
        held: state.held + served,
        status: answer.exhausted ? "exhausted" : "idle",
        refusal: null,
        notes,
        // The bound this state continues is the one it was seeded with: a page
        // taken in does not move the first screen it was taken after
        // (admin-window/BUG-0216).
        after: state.after,
      };
    }
    case "not_provisioned":
      // The FACT alone: the name the answer gave, and no prose composed around
      // it (admin-window/BUG-0176). The words, the gray ink and the absence of
      // any press-again instruction belong to the component, which renders the
      // app's one spelling of this sentence.
      return refuseAbsent(state, answer.missing);
    case "error":
      // The only arm whose reason is not ours — and the only one that can
      // carry BOTH authors, because a failed read's account may hold the
      // database's words beside this app's counted clause about a part it
      // refused to quote (admin-window/BUG-0196).
      //
      // The runs are the ones `lib/db/result.ts` decided where the clauses are
      // written, carried across the wire and READ, never re-derived here. An
      // answer that carries NO authorship means what this app rendered before
      // the fact existed — the whole account is the machine's — which is the
      // wire's documented default (`src/lib/paging/bounds.ts`) and not a guess
      // about its words.
      return refuseAccount(
        state,
        answer.authored ?? [{ words: answer.message, author: "the machine" }],
        answer.reading,
      );
    case "refused":
      // The route's own bound refusal, written by `src/lib/paging/bounds.ts` —
      // which is this app, on the other side of a fetch.
      return refuse(state, answer.reason, null, "this app");
  }
}
