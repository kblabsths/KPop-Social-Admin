import type { SupabaseClient } from "@supabase/supabase-js";
import { accountText, type AccountSegment } from "../account/authored";
import { getDbClient } from "./client";
import { classify, isJsonObject, type DbResult } from "./result";
import type { FunctionName } from "./tables";

/**
 * IS THIS OBJECT INSTALLED? — asked of the database's own description of
 * itself, never by calling the object (campaign admin-window/BUG-0223).
 *
 * PostgREST publishes an OpenAPI document at the root of its REST endpoint
 * listing every table, view and FUNCTION it exposes. It is a GET: reading it
 * establishes that `settle_review_item` is there without invoking a procedure
 * that writes `verdicts` and the catalog. That distinction is not academic —
 * a live case that called an absent function to prove it was absent applied a
 * real admin override the day the function landed (admin-window/BUG-0215) —
 * and it is why this module exists rather than a procedure call wrapped in a
 * `try`. (This file deliberately does not spell the client's procedure
 * method even in prose: `tests/offline/browse/views.test.ts` scans the raw
 * text of every source file for it and `lib/db/verdict.ts` is the one place
 * allowed to carry it — a guard worth keeping stricter than it needs to be.)
 *
 * `tests/live/parity.ts`'s `functionsOnStaging()` reads the same document for
 * the live suite. This is the APP's reader of it, and the two stay one fact
 * because they read one source; nothing here re-derives a function's presence
 * from anything else.
 *
 * **It never reads a credential.** The endpoint and the authenticated `fetch`
 * both come off the client the caller already has, so `lib/db/client.ts` stays
 * the one file under `src/` that touches the names (ARCHITECTURE.md §4 rule 3)
 * and no key is spelled, logged or passed through this module.
 */

/** The media type PostgREST answers its schema description in. */
export const SCHEMA_DESCRIPTION_MEDIA_TYPE = "application/openapi+json";

/** The prefix every FUNCTION this database exposes is published under. */
const RPC_PATH = "/rpc/";

/**
 * The REST endpoint a client talks to, and the fetch that authenticates
 * against it — the two things a raw read of the schema description needs.
 *
 * supabase-js builds both in its constructor: `rest` is a `PostgrestClient`
 * over the project's REST root, carrying the `fetchWithAuth` wrapper that puts
 * the key on every request (`node_modules/@supabase/supabase-js/dist/index.mjs`,
 * read 2026-09-14). `rest` is `protected` in the published types, which is a
 * TypeScript visibility rule and not a runtime one — so this reads it through
 * a narrow structural cast and VALIDATES what it found.
 */
export interface RestEndpoint {
  /** The REST root the client's queries are built on. */
  readonly url: string;
  /** The client's own fetch: it carries the credential, this module does not. */
  readonly fetch: typeof globalThis.fetch;
}

/**
 * The endpoint behind a client, or `null` when this client does not carry one
 * in the shape above.
 *
 * `null` is the fail-CLOSED answer and it is deliberate: a supabase-js upgrade
 * that renames `rest` must make this app refuse to establish that a function
 * is installed — which withdraws the control — rather than quietly answer
 * "installed" and offer a save that cannot land.
 * `tests/offline/db/schema.test.ts` asserts the real client still satisfies
 * it, so such an upgrade is caught by a red test rather than by an operator.
 */
export function restEndpointOf(client: SupabaseClient): RestEndpoint | null {
  const rest = (client as unknown as { rest?: unknown }).rest;
  if (typeof rest !== "object" || rest === null) return null;
  const { url, fetch: clientFetch } = rest as { url?: unknown; fetch?: unknown };
  if (typeof url !== "string" || url.length === 0) return null;
  if (typeof clientFetch !== "function") return null;
  return { url, fetch: clientFetch as typeof globalThis.fetch };
}

/**
 * Every FUNCTION named in a schema description, or `null` when the document is
 * not one.
 *
 * **The leg, positively** (ARCHITECTURE.md §4.1 — the schema description is
 * the leg a read that asks the host about ITSELF names, and it is admitted by
 * the same rule as every other leg): PostgREST is specified to answer this
 * read with an OpenAPI document whose `paths` is a JSON OBJECT keying every
 * route it exposes, each exposed procedure under the rpc prefix. A body that
 * is not that document did not answer this read at all — the same question
 * `unreadableAnswer` asks of a row set (`result.ts`) — and the caller is told
 * the read FAILED rather than handed an empty set, which would read as a
 * database exposing no functions.
 *
 * The object question is `isJsonObject` (`result.ts`), asked of the body and
 * of `paths` alike, because `typeof x === "object"` is also true of an ARRAY
 * and `Object.keys` of an array is its indices: a host whose body carried
 * `paths: [...]` yielded an empty function set, so `readFunctionInstalled`
 * answered `not_provisioned` — a FALSE absence about the database, derived
 * from a document this app could not read (admin-window/BUG-0234). A shape
 * this read cannot grade has one answer here and it is
 * `unreadableDescription`.
 */
function functionsIn(body: unknown): Set<string> | null {
  if (!isJsonObject(body)) return null;
  const paths = body.paths;
  if (!isJsonObject(paths)) return null;
  return new Set(
    Object.keys(paths)
      .filter((route) => route.startsWith(RPC_PATH))
      .map((route) => route.slice(RPC_PATH.length)),
  );
}

/**
 * The functions this process has SEEN a given endpoint expose.
 *
 * **Affirmative answers only, and that asymmetry is the whole design.** The
 * document is 387 KB and takes 0.3–1.0 s to read (measured read-only on the
 * declared staging target 2026-09-14: `status=200 bytes=396738`, three reads
 * at 1048 / 415 / 319 ms, 59 functions exposed), which is more than a
 * record-page render can pay every time. So once an endpoint has been observed
 * exposing a name, this process stops asking: an installed procedure
 * disappearing under a running deployment is not a state this app must render,
 * and if it happens the save's own `not_provisioned` still refuses honestly,
 * naming it (`settleReviewItem`).
 *
 * An ABSENCE is never cached, and that is the half that matters: the world
 * this ticket is about is the minutes-long window while the handoff is being
 * installed (admin-window/BUG-0215 measured both halves of it four minutes
 * apart), so the next render after the install must see it — without a
 * redeploy, without a restart, and without an operator wondering why the
 * control has not come back. A failed read is not cached either: it is not an
 * answer.
 *
 * Keyed by the ENDPOINT rather than global, because "which database" is part
 * of the fact — and because a test holding two stub clients is holding two
 * databases.
 */
const exposedAt = new Map<string, Set<string>>();

/** What this app says when the description itself could not be read. */
function unreadableDescription(fn: FunctionName, said: string): DbResult<never> {
  const authored: AccountSegment[] = [
    {
      words:
        `whether ${fn} is installed could not be established: this ` +
        `database's schema description ${said}. Until it can be read, ` +
        `whether the object is absent or the description is unreachable is ` +
        `not known, and this app will not act on a guess either way.`,
      author: "this app",
    },
  ];
  return { kind: "error", reading: fn, message: accountText(authored), authored };
}

/**
 * Is `fn` installed on this database? — the READ behind every "may this
 * surface offer a control that calls it" question.
 *
 * Three answers, and the middle one is the point:
 *
 *  - `ok` — the description lists it. The surface may offer the control.
 *  - `not_provisioned` naming `fn` — the description was read and does not
 *    list it. Exactly the state an absent TABLE renders, through the same
 *    card, so no surface needs a second vocabulary for a missing function.
 *  - `error` naming `fn` — the description could not be read. NEVER an
 *    absence: a reader that saw nothing and a database missing the object are
 *    different facts, and only one of them is about the object
 *    (`functionsOnStaging`, `tests/live/parity.ts`, says the same thing about
 *    the same read).
 *
 * It never throws, on any path (ARCHITECTURE.md §4.1): an unset credential
 * name makes `getDbClient()` throw inside the same `try` every other read
 * resolves its client in, so a page renders a named refusal instead of a 500.
 */
export async function readFunctionInstalled(
  fn: FunctionName,
  client?: SupabaseClient,
): Promise<DbResult<"installed">> {
  try {
    const db = client ?? getDbClient();
    const endpoint = restEndpointOf(db);
    if (endpoint === null) {
      return unreadableDescription(
        fn,
        `is not reachable through this database client, so the read that ` +
          `would list it was never made`,
      );
    }

    const seen = exposedAt.get(endpoint.url);
    if (seen !== undefined && seen.has(fn)) return { kind: "ok", data: "installed" };

    const response = await endpoint.fetch(`${endpoint.url.replace(/\/+$/, "")}/`, {
      headers: { Accept: SCHEMA_DESCRIPTION_MEDIA_TYPE },
    });
    if (!response.ok) {
      return unreadableDescription(fn, `answered HTTP ${response.status}`);
    }

    const functions = functionsIn(await response.json());
    if (functions === null) {
      return unreadableDescription(
        fn,
        `came back carrying no list of what this database exposes, so the ` +
          `address this deployment reads may be answering for something ` +
          `other than this database`,
      );
    }
    if (!functions.has(fn)) return { kind: "not_provisioned", missing: fn };

    // Affirmative, so it is settled for this process — see `exposedAt`.
    exposedAt.set(endpoint.url, new Set([...(seen ?? []), fn]));
    return { kind: "ok", data: "installed" };
  } catch (thrown) {
    // The same classifier every other read uses, asking about a FUNCTION: a
    // transport failure carries the database's own words, and no absence can
    // be claimed from words alone.
    return classify(thrown, fn, "function");
  }
}
