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

import { isPageAnswer, OFFSET_PARAM, type PageAnswer } from "./bounds";

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
  return { rows: state.rows, held: state.held, status: "loading", refusal: state.refusal };
}

/**
 * The state a surface starts a press-less life in: the server rendered `held`
 * rows and this module holds none of them, and `more` — the first screen's own
 * answer about whether anything follows — decides whether a press is offered
 * at all. `more: false` starts exhausted, because a control that cannot be
 * honoured is never offered (SPEC F10's rule).
 */
export function initialPage<Row>(held: number, more: boolean): PageState<Row> {
  return { rows: [], held, status: more ? "idle" : "exhausted", refusal: null };
}

/** What one press needs: where to ask, what to carry, and how to ask. */
export interface PageDeps {
  /** `PAGE_ROUTES[...]` — this app's own route, by a relative path. */
  readonly route: string;
  /** The surface's own facets, already serialized (`a=1&b=2`, or empty). */
  readonly params: string;
  /** The window the SERVER decides. It is never read from the URL. */
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

/** A refusal that adds no rows: the list, the bound and the order all stand. */
function refuse<Row>(state: PageState<Row>, reason: string, object: string | null): PageState<Row> {
  return { rows: state.rows, held: state.held, status: "idle", refusal: { reason, object } };
}

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
 *  2. **An `ok` answer appends in the order received**, `held` grows by the
 *     row count, and the refusal is cleared.
 *  3. **An `ok` answer with zero rows is exhaustion**, not a refusal: the end
 *     of a set is an answer, and the rows are unchanged.
 *  4. **A refusal never extends the list** (M3 EC5): the rows come back with
 *     the same length, the same members and the same order, `held` is
 *     unchanged so the next press asks for the same bound, the refusal names
 *     the object, and `status` returns to `idle` so the operator may retry.
 *  5. **Foreign data is a refusal, never a throw**: a rejected `fetchJson`, a
 *     body that never parsed, and a body `isPageAnswer` rejects all refuse
 *     naming the route.
 *
 * The answer's own `offset` is not read into the state: `held` grows by the
 * rows that actually arrived, so a server echoing some other bound can never
 * make this surface claim rows it does not hold.
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
      const rows = answer.rows.length > 0 ? [...state.rows, ...answer.rows] : state.rows;
      return {
        rows,
        held: state.held + answer.rows.length,
        // A short or empty page is the end of the set, whichever of the two
        // said so first.
        status: answer.exhausted || answer.rows.length === 0 ? "exhausted" : "idle",
        refusal: null,
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
