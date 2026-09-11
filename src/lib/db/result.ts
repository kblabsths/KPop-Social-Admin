import type { SupabaseClient } from "@supabase/supabase-js";
import { getDbClient } from "./client";

/**
 * The data-layer contract (ARCHITECTURE.md §4.1): every exported read in
 * `lib/db/**` returns one of these, never throws, and never returns a bare
 * array. That is how acceptance test 9 — "against a database lacking the
 * resolver tables, every page renders its not-provisioned state; nothing
 * throws" — is structural instead of per-page discipline.
 */
export type DbResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_provisioned"; missing: string }
  | { kind: "error"; reading: string; message: string };

/**
 * A read that produced no rows — the two non-`ok` arms.
 *
 * Both name the object they were reading, in the same spelling `tables.ts`
 * gave the query: `not_provisioned` because the object is what is absent, and
 * `error` because a page composing several reads (Browse makes four) must be
 * able to say WHICH read refused. A line reading only "TypeError: fetch
 * failed" names none of them (admin-window/BUG-0016).
 */
export type DbUnavailable = Extract<
  DbResult<unknown>,
  { kind: "not_provisioned" | "error" }
>;

/** The shape every PostgREST response has, narrowed to what a read needs. */
export type DbResponse<T> = { data: T | null; error: unknown };

/**
 * The response shape a COMPLETE read needs: the rows AND the exact count.
 *
 * `count` is what `{ count: "exact" }` puts on the response. It is `null` when
 * the query did not ask for it — which a complete read treats as a refusal
 * rather than as information (ARCHITECTURE.md §4.3).
 */
export type DbCountedResponse<T> = {
  data: T | null;
  error: unknown;
  count: number | null;
};

/**
 * The most rows one complete read may return.
 *
 * 1000 matches PostgREST's own default `db-max-rows`, so the app never
 * silently fights the platform cap: whichever of the two truncates first, the
 * exact count still exceeds the rows returned and the read refuses. One named
 * constant, handed to the query builder, so no module spells the number
 * (ARCHITECTURE.md §4.3; DECISIONS 2026-09-02).
 */
export const ROW_CAP = 1000;

/**
 * The object is absent: PostgREST cannot find the table/view in its schema
 * cache (`PGRST205`), or Postgres itself says undefined_table (`42P01`).
 */
const TABLE_ABSENT_CODES: ReadonlySet<string> = new Set(["PGRST205", "42P01"]);

/**
 * The column is absent: PostgREST cannot find the column in its schema cache
 * (`PGRST204`), or Postgres itself says undefined_column (`42703`).
 */
const COLUMN_ABSENT_CODES: ReadonlySet<string> = new Set(["PGRST204", "42703"]);

/**
 * The FUNCTION is absent: PostgREST cannot find the function in its schema
 * cache (`PGRST202`), or Postgres itself says undefined_function (`42883`).
 *
 * The fifth kind of object the window reads (campaign admin-window/TASK-0047).
 * M2 settles a review item through one call to a resolver procedure that does
 * not exist until the handoff migration is installed, so its absence is the
 * NORMAL case for the whole milestone and must reach a page as the same
 * not-provisioned state a missing table does — never as an error, never as a
 * throw (ARCHITECTURE.md §4.1, §4.3).
 *
 * These two codes only ever mean an absence to a caller that ASKED for a
 * function; see `AskedObject`.
 */
const FUNCTION_ABSENT_CODES: ReadonlySet<string> = new Set(["PGRST202", "42883"]);

/**
 * What the caller asked the database for — the thing an absence code is
 * allowed to be an absence OF.
 *
 * A table read and a function call do not share a vocabulary of absence, and
 * the same code means different things to each (`42883` most of all). So the
 * classifier is told what was asked instead of guessing it from the database's
 * prose, and `"table"` is the default because that is what every read in this
 * module does: a caller that says nothing can never claim a function absence.
 */
export type AskedObject = "table" | "function";

/**
 * The absence codes each kind of caller may read as an absence of the object
 * it named. Nothing else is an absence — a code outside its own row is a
 * failure the database is reporting ABOUT something else, and it stays
 * `kind: "error"` carrying the database's own words.
 */
const ABSENCE_CODES: Readonly<Record<AskedObject, ReadonlySet<string>>> = {
  // Plus the column codes, which name a column OF the table that was asked
  // for; they are handled separately because they mine the column's name.
  table: TABLE_ABSENT_CODES,
  function: FUNCTION_ABSENT_CODES,
};

/**
 * A `42883` that is NOT an absent function even when a function WAS asked for.
 *
 * Postgres raises `undefined_function` for a missing OPERATOR as well as for a
 * missing function — `operator does not exist: timestamp with time zone ~~*
 * unknown` is the shape, measured on this project's own staging when an
 * `ilike` was aimed at a non-text column (admin-window/BUG-0058, pinned in
 * `tests/live/residue.live.test.ts`). That is a query this app got WRONG, not
 * an object the database is missing.
 *
 * It is no longer what keeps a TABLE read honest — the kind of object the
 * caller asked for is (admin-window/BUG-0080: `42883` also arrives from a
 * table read as `function to_tsvector(timestamp with time zone) does not
 * exist`, a missing OVERLOAD of a function the caller never named, and no
 * sentence match stays one shape ahead of Postgres). It survives as the
 * narrower guard on the function arm alone, where a function's own body can
 * raise it. It can only ever REFUSE an absence claim, never make one, which is
 * the only direction a prose match is safe in.
 *
 * A `42883` that says nothing at all is still an absent function to a caller
 * that asked for one: the code plus what was asked is what classifies, and
 * this is a single named exception to it, not a requirement that the database
 * explain itself.
 */
const MISSING_OPERATOR = /\boperator does not exist\b/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** The error's own `code`, if it carries one. */
function errorCode(error: unknown): string | null {
  const record = asRecord(error);
  const code = record?.code;
  if (typeof code === "string") return code;
  if (typeof code === "number") return String(code);
  return null;
}

/**
 * The words the DATABASE authored, verbatim, or `null` when it authored none.
 *
 * PROVENANCE, in the shape admin-window/BUG-0179 already established for the
 * account: the one fact no amount of reading the text could recover is WHO
 * WROTE IT. A value that IS a string is the client's own sentence; a record
 * whose `message` is a string carries the database's. Anything else — no
 * `message` field, a `null` one, a number, a nested object — means the
 * database said nothing here, and `null` says exactly that.
 *
 * This is what CLASSIFICATION reads, and the only thing it may read. The
 * column-absent arm mines the returned string for the column the database
 * named, so it must see exactly what the database put in `message`: a
 * `details` payload quoting some other identifier would otherwise be read as
 * the missing column (admin-window/BUG-0016), and this app's own
 * `JSON.stringify` rendering of a foreign envelope would hand over a JSON KEY
 * — a field name the envelope's author chose and ordered — as the column half
 * of `missing` (admin-window/BUG-0185).
 *
 * Asked of the VALUE's shape only. Nothing here inspects the text: a message
 * the database really did author is returned however long, however empty and
 * whatever it says.
 */
function databaseMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  const message = asRecord(error)?.message;
  return typeof message === "string" ? message : null;
}

/**
 * A string for the ACCOUNT to render — the database's own words where there
 * are any, and this app's serialisation of the whole value where there are
 * not.
 *
 * Expressed through `databaseMessage`, because "did the database author this
 * string?" is one question with one home: `databaseMessage` returning `null`
 * is exactly the state this function answers by rendering the value through
 * `JSON.stringify`, so the account's provenance and the classification's
 * cannot drift apart (ARCHITECTURE.md Common violations rows 15 and 20).
 *
 * CLASSIFICATION does not read this — it reads `databaseMessage` — and the
 * difference is deliberate: the account must still SAY something about a
 * record that carried no sentence, and `accountParts` marks that part
 * `serialised` so `errorMessage` counts it instead of quoting it
 * (admin-window/BUG-0173, admin-window/BUG-0179). Returning `null` or `""`
 * here would blank the account instead (admin-window/BUG-0016).
 */
function messageOf(error: unknown): string {
  const authored = databaseMessage(error);
  if (authored !== null) return authored;
  if (asRecord(error) !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/** What replaces anything key-shaped before a string can reach a screen. */
const REDACTED = "[redacted]";

/**
 * Value shapes that must never be rendered, whatever carried them.
 *
 * A transport failure quotes the request it tried, so the host of the database
 * URL can legitimately appear in an error line — that is the database's own
 * account of what it could not reach. A CREDENTIAL never may, and a
 * `NAME=value` rule alone misses the one that hurts most: a Postgres DSN
 * carries its password mid-line, between the colon and the `@`. Both are
 * covered here.
 */
const SECRET_SHAPES: ReadonlyArray<readonly [RegExp, string]> = [
  // A JWT — the shape of the service-role and anon keys.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, REDACTED],
  // Supabase's newer opaque key format.
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, REDACTED],
  // A DSN's password: scheme://user:HERE@host.
  [
    /((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^\s:@/]+:)[^\s@]+(?=@)/gi,
    `$1${REDACTED}`,
  ],
  // A named credential in a query string, a header dump or a JSON body.
  [
    /(\b(?:apikey|api_key|anon_key|service_role_key|access_token|refresh_token|token|secret|password|passwd|pwd)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;}"']+)/gi,
    `$1${REDACTED}`,
  ],
  [/([?&]key=)[^\s&]+/gi, `$1${REDACTED}`],
  // An Authorization header, however it was quoted.
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
];

/** The same string with every credential-shaped value replaced. */
function withoutSecrets(text: string): string {
  let scrubbed = text;
  for (const [shape, replacement] of SECRET_SHAPES) {
    scrubbed = scrubbed.replace(shape, replacement);
  }
  return scrubbed;
}

/** How far a `cause` chain is followed before we stop reading it. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Whether `messageOf` had to render the WHOLE value, because it carried no
 * string `message` of its own.
 *
 * PROVENANCE, and the one fact no amount of reading the result could recover:
 * what came out is this app's serialisation of a foreign body, and it already
 * holds every field that value had — `details`, `hint` and `code` included.
 * That is why none of the three is appended again in this state
 * (admin-window/BUG-0179: the `code` arm used to be, so an intermediary's
 * whole document trailed the clause that had just counted it).
 */
function serialisedWhole(error: unknown): boolean {
  const record = asRecord(error);
  return record !== null && typeof record.message !== "string";
}

/**
 * One part of the client's account, carrying the one thing about it that no
 * amount of reading its text could recover: whether the part is the client's
 * own words at all, or a value THIS APP serialised because the client gave it
 * none (admin-window/BUG-0173, question 1 below).
 */
type AccountPart = { readonly raw: string; readonly serialised: boolean };

/**
 * Every field of the client's own account, in a FIXED order:
 * `message`, `details`, `hint`, then whatever its `cause` says.
 *
 * Both shapes of the same failure reach us and both must give up their cause:
 *  - supabase-js hands back an OBJECT — `message: "TypeError: fetch failed"`
 *    with the real cause ("Caused by: Error: bad port …") in `details`;
 *  - a fetch that throws straight through is an `Error` whose `cause` is the
 *    real one.
 * Reading `message` alone discarded the only field carrying what actually went
 * wrong (admin-window/BUG-0016).
 *
 * The `serialised` flag is PROVENANCE, recorded here because here is the only
 * place that knows it: a value with no string `message` sends `messageOf` down
 * its `JSON.stringify` path, so the resulting part is this app's rendering of
 * a body rather than anything the database said.
 */
function accountParts(error: unknown, depth: number): AccountPart[] {
  const record = asRecord(error);
  // No `message` field: `messageOf` serialises the whole object, which already
  // carries every field there is — appending them again would only repeat it.
  // A non-object (a thrown string, a number) has no fields to serialise, so
  // only the object case is ours rather than the client's.
  if (record === null || typeof record.message !== "string") {
    return [{ raw: messageOf(error), serialised: serialisedWhole(error) }];
  }

  const parts: AccountPart[] = [{ raw: messageOf(error), serialised: false }];
  for (const field of ["details", "hint"] as const) {
    const value = record[field];
    if (typeof value === "string") parts.push({ raw: value, serialised: false });
  }

  const cause = record.cause;
  if (cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH) {
    parts.push(...accountParts(cause, depth + 1));
  }
  return parts;
}

/**
 * A part of the account that is a DOCUMENT rather than prose: its first
 * non-blank character is `<`.
 *
 * That is the WHOLE question, and it is asked about the SHAPE of what the
 * client handed back — never about which intermediary sent it and never about
 * which surface will render it (admin-window/BUG-0170). Measured 2026-09-10
 * against staging: a facet value the WAF in FRONT of PostgREST disliked was
 * answered by the WAF, not by PostgREST, so supabase-js handed back a
 * 4,547-character Cloudflare "Attention Required!" page as `error.message` and
 * the whole document reached the operator inside an app-written sentence
 * (`ErrorLine` renders `${reading} — ${failed}`).
 *
 * Three shapes answer `<` and all three are documents: the doctype that page
 * opened with, an `<html …>` fragment sent with no doctype, and an
 * `<?xml …?>` prolog. Nothing else is inspected — no tag stripping, no entity
 * decoding, no length cap on prose, no codepoint blocklist and no second
 * detector for a shape nobody has measured. That restraint is the point
 * (ARCHITECTURE.md §7 common violations row 15, LESSONS 4): a blocklist
 * chased one family at a time is the class this rule was promoted for. A
 * database message that merely CONTAINS angle brackets — `operator does not
 * exist: text <-> integer` — begins with a letter and is untouched.
 */
function isDocument(part: string): boolean {
  return part.startsWith("<");
}

/**
 * A line of a part that is a RUNTIME STACK FRAME: after its leading
 * whitespace it begins `at ` and it ends in `)` or in `:<line>:<column>`.
 *
 * That is the V8 frame format — a SPECIFIED format, which is why this question
 * may be asked at all where a family of adversary text may not. The two
 * endings are the two forms V8 emits: `at fn (file:1:2)` for a named frame and
 * `at file:1:2` for an anonymous one.
 *
 * A line that merely opens with those two letters is prose and stays: a
 * database can and does wrap a message onto a second line beginning "at the
 * end of the statement", and that line ends in neither of the two forms. The
 * question is about the line's shape and nothing else — no frame vocabulary
 * (no runtime's class names, no error names, no host names) is matched here.
 */
function isRuntimeFrame(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("at ") &&
    (trimmed.endsWith(")") || /:\d+:\d+$/.test(trimmed))
  );
}

/**
 * What an account says INSTEAD of a document: counted, never spelled.
 *
 * The clause quotes no part of what arrived — not its `<title>`, not its first
 * line, not a tag — because the rule is that text this app did not author
 * never sits inside a sentence this app wrote. What survives is the one fact
 * an operator needs and the document cannot be trusted to state: something
 * other than the database answered, and this much of it arrived. The number is
 * the length of the part exactly as the client delivered it, before any
 * trimming of ours, so it is the same number a reader gets from
 * `error.message.length`.
 *
 * The URL-value predicate in `src/lib/url/spellable.ts` is deliberately NOT
 * called here and not widened to reach this: it answers the URL-value
 * question, and a shared predicate answering a second question gets widened by
 * whichever question broke last (LESSONS 4; that module's own doc refuses it
 * too). Nothing in this file names it — the check that keeps it that way is
 * this ticket's, in the tracker.
 */
function documentInstead(raw: string): string {
  return (
    `a ${raw.length}-character markup document arrived here instead of the ` +
    `database's own words`
  );
}

/**
 * What an account says INSTEAD of a body we had to serialise: the same
 * counted, never-spelled clause, for the same reason.
 *
 * Provenance decides this one, so NOTHING of the value is inspected: the
 * client handed back an object carrying no string `message`, `messageOf` had
 * to render the whole thing, and this app's rendering of a foreign body is not
 * the database's words however it reads. Measured shapes (QA,
 * admin-window/BUG-0173): an intermediary's `{"success":…,"errors":…}`
 * envelope, and an array whose one element nests a document one quote deep —
 * a part that does not BEGIN with `<` and so is invisible to the document
 * question above. Neither is chased by text; both are answered by asking who
 * wrote the part.
 */
function serialisedInstead(raw: string): string {
  return (
    `a ${raw.length}-character body carrying no sentence of its own arrived ` +
    `here instead of the database's own words`
  );
}

/**
 * What the account says about the frames it dropped — in the app's own words,
 * with the number in them.
 *
 * admin-window/BUG-0016 pinned the client's whole account as untrimmed
 * precisely because trimming it SILENTLY is how its cause was lost. This
 * ticket drops the frame lines and says so, which is the opposite of silent:
 * an operator reading the line can see that a stack was here, how big it was,
 * and that nothing else was taken.
 */
function framesInstead(count: number): string {
  return `(${count} runtime stack frame${count === 1 ? "" : "s"} dropped)`;
}

/**
 * Does ANY line of this part, after its leading whitespace, begin `<`?
 *
 * Question 2 of `partOfAccount`, asked ONCE of the whole part (the
 * architect's ruling of 2026-09-11, admin-window/BUG-0187): a part carrying a
 * document ANYWHERE was authored by something that speaks markup, and
 * Postgres does not — so this app cannot attribute any line of such a part to
 * the database, and the part is replaced whole by one counted clause.
 *
 * `isDocument` decides each line exactly as it decides a whole part, and
 * nothing new is inspected here: no tag matching, no entity decoding, no
 * length cap, no vocabulary and no `includes("<")` (ARCHITECTURE.md §7 common
 * violations row 15, LESSONS 4). A database message that merely CONTAINS
 * angle brackets — `operator does not exist: text <-> integer` — has no line
 * beginning `<` and is untouched; a runtime frame can never answer this
 * question, because `isRuntimeFrame` requires its line to begin `at `.
 */
function carriesDocument(part: string): boolean {
  return part.split(/\r?\n/).some((line) => isDocument(line.trim()));
}

/**
 * The surviving lines of ONE part, with every line an EARLIER kept line
 * ALREADY ENDS WITH dropped — the same sentence said once, not twice
 * (admin-window/DEBT-0020).
 *
 * WHY A PART REPEATS ITSELF AT ALL, measured before a line of this was
 * written: postgrest-js builds a transport failure's `details` as the wrapper
 * line, a blank line, `Caused by: ${cause.name}: ${cause.message}`, and then
 * — when the cause carries one — the cause's whole `stack`, whose FIRST line
 * is `${cause.name}: ${cause.message}` again
 * (`node_modules/@supabase/postgrest-js/dist/index.mjs`, the
 * `errorDetails += "\n" + cause.stack` arm). The frames go by question 3 and
 * both prose lines stay, so the account stated one true sentence twice:
 * `TypeError: fetch failed Caused by: Error: getaddrinfo ENOTFOUND db.invalid
 * Error: getaddrinfo ENOTFOUND db.invalid (1 runtime stack frame dropped)`.
 * `errorMessage`'s own dedup cannot reach it: that one drops a PART another
 * part contains, and both copies here live inside the one reduced `details`.
 *
 * THE RULE IS ENDS-WITH, AND DELIBERATELY NOT CONTAINS. The repeat is a
 * SUFFIX of the line that already said it — `Caused by: X` said `X` last —
 * so the later line adds no word the account does not already carry, in that
 * order, at that end. A CONTAINS rule would also delete the line a longer
 * line merely BEGINS with, and that is a database wrapping its own message
 * onto a continuation line: both of those are its words and both cross whole
 * (admin-window/DEBT-0020's twin, LESSONS 8). Nothing is matched here — no
 * `Caused by:`, no error names, no frame vocabulary, no length cap: a
 * vocabulary would be the fourth question this file refuses to ask
 * (LESSONS 4, ARCHITECTURE.md §7 common violations row 15).
 *
 * A line an earlier kept line ends with EXACTLY is dropped by the same rule,
 * because a line is its own suffix and one sentence stated twice is the whole
 * defect — the direction is the only thing that matters, not the length of
 * the overlap.
 *
 * It is ONE-DIRECTIONAL, over already-kept lines only: a line is judged
 * against what the account has committed to saying BEFORE it, never against
 * what comes after. The measured shape needs no more than that — the
 * attributing line always precedes the bare repeat — and reaching backwards
 * to delete a line the account already said would be a second rule.
 */
function saidOnce(lines: readonly string[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    if (kept.some((held) => held.endsWith(line))) continue;
    kept.push(line);
  }
  return kept;
}

/**
 * A part that carries NO document, read LINE BY LINE: every line that is a
 * runtime STACK FRAME goes and is counted, and every other line is kept
 * verbatim and joined into one line — except a line the account has ALREADY
 * SAID, which crosses once rather than twice (`saidOnce` above,
 * admin-window/DEBT-0020). That pass runs HERE and only here: it reads the
 * lines that survived the frame drop, which is the one place this file
 * reshapes a part at all, so a part carrying no frame is still returned
 * exactly as it arrived.
 *
 * Question 2 IS NOT ASKED HERE AT ALL (admin-window/BUG-0187). It is asked
 * once, of the whole part, by this function's only caller — so a part that
 * reaches here is the database's own words, and the per-line and per-run
 * document bookkeeping this function used to carry (admin-window/BUG-0182,
 * with its line offsets) is DELETED rather than extended: the two
 * granularities that had answered differently on every shape since
 * admin-window/BUG-0179 are one code path now.
 *
 * Frames stay a LINE question because V8's is a SPECIFIED format, and a part
 * is not foreign for carrying a stack: `Caused by: Error: getaddrinfo
 * ENOTFOUND db.invalid` sits between the wrapper and the frames, and it is
 * the cause admin-window/BUG-0016 exists to preserve. The part is never
 * truncated at the first frame either, because postgrest-js puts the real
 * cause AFTER it — reading down to the first frame is exactly the bug
 * admin-window/BUG-0016 fixed, and it does not come back.
 *
 * A part where NO line is a frame is returned UNTOUCHED — not re-joined, not
 * re-indented, not re-spaced, and with no count of frames nobody dropped. A
 * database message that happens to span lines crosses exactly as it arrived,
 * which is what a check constraint's DETAIL wrapped onto a continuation line
 * needs (ARCHITECTURE.md §4.1).
 */
function askedLineByLine(part: string): string {
  const lines = part.split(/\r?\n/);
  const dropped = lines.filter((line) => isRuntimeFrame(line)).length;
  if (dropped === 0) return part;

  const said = saidOnce(
    lines
      .filter((line) => !isRuntimeFrame(line))
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  ).join(" ");
  const counted = framesInstead(dropped);
  return said.length > 0 ? `${said} ${counted}` : counted;
}

/**
 * The three questions this app asks of ONE part of an account, in order, and
 * there is no fourth (admin-window/BUG-0173, admin-window/BUG-0187).
 *
 *  1. Did WE serialise it? Provenance, inspecting no text at all.
 *  2. Does it CARRY A DOCUMENT? Any line of it, after its leading whitespace,
 *     begins `<` — asked ONCE, of the PART, never per line and never per run.
 *     A part that answers is not the database's words at all and is replaced
 *     WHOLE by one clause counting it at the length the client delivered it,
 *     any appended frames included. No line of it crosses, no frames clause
 *     follows it and nothing else is said about it, because nothing was read
 *     past the document (ARCHITECTURE.md §4.1, which carries this bar;
 *     admin-window/BUG-0187).
 *  3. Does it carry RUNTIME FRAMES? Asked only of a part that carries no
 *     document: those lines go and are counted, every other line stays.
 *
 * `null` means the part was blank and carries nothing to say.
 */
function partOfAccount({ raw, serialised }: AccountPart): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (serialised) return serialisedInstead(raw);
  if (carriesDocument(trimmed)) return documentInstead(raw);
  return askedLineByLine(trimmed);
}

/**
 * The `code` as the account may carry it — ONE MORE PART, asked the same three
 * questions as every other one (admin-window/BUG-0179).
 *
 * The code is still a machine identifier and still trails LAST in parentheses,
 * so a real PostgREST refusal still ends "(42501)". What changes is that it no
 * longer crosses unasked: postgrest-js hands the parsed body back AS the error
 * object for ANY non-2xx response (`error = JSON.parse(body)`), so an
 * intermediary refusing with a JSON envelope authors its `code` too — QA
 * measured a 4,524-character document arriving in that field, through the real
 * client and again at `/claims` on a production build (2026-09-11).
 *
 * `null` means the account carries no code at all:
 *  - the value carried no string `message`, so `messageOf` already rendered
 *    the WHOLE object, `code` included, and the account IS that one counted
 *    clause — appending the code after it is the repetition `details` and
 *    `hint` are already spared in this state;
 *  - there is no code, or it is blank — an empty code is not information and
 *    never prints as "()".
 *
 * A code that answers NONE of the three crosses VERBATIM however long it is.
 * That is deliberate: the bar is the same derivation as every other part, not
 * a shorter one for this field, and a length cap or a shape allowlist here
 * would be the fourth question this app refuses to ask (LESSONS 4,
 * ARCHITECTURE.md §7 common violations row 15). If a 300-character code ever
 * arrives beside a real database message it is exactly as bounded as a
 * 300-character `details`, and the answer then is a rule for every part.
 */
function codeOfAccount(error: unknown): string | null {
  if (serialisedWhole(error)) return null;
  const code = errorCode(error);
  if (code === null) return null;
  return partOfAccount({ raw: code, serialised: false });
}

/**
 * What the account says when the client said NOTHING AT ALL: no part survived
 * and no code came back.
 *
 * A non-2xx with an EMPTY body reaches us as `{message: ""}` — postgrest-js's
 * `JSON.parse(body)` throws and its catch builds `error = { message: body }` —
 * which is the path every bodiless 502/503/429 takes and the path a
 * head-shaped count takes. Every part is then blank, so the account was the
 * empty string and `ErrorLine` rendered "pending_claims — " naming no failure
 * at all (QA residual (a) of admin-window/BUG-0173, answered in
 * admin-window/BUG-0179; the LIVE harness has refused to report this blank
 * since admin-window/TASK-0032 and the product path had no such clause).
 *
 * It is the app's own words about a read that was refused, and it says only
 * what the app knows: no number is invented, nothing is attributed to the
 * database, and the HTTP status is deliberately NOT named — `DbResponse`
 * carries `data` and `error` alone, the error object carries no status, and
 * reaching for one would mean widening the data-layer contract and every
 * reader in `lib/db/**`. It renders in this state ONLY: `{code: "42883",
 * message: ""}` still says "(42883)" and nothing else.
 */
const REFUSED_WITHOUT_WORDS = "the read was refused with no words to explain it";

/**
 * The database client's own account of the failure — everything it said,
 * nothing of ours.
 *
 * LOOK_AND_FEEL, Interaction: "the app shows what the database said … Errors
 * are never swallowed and never replaced with a generic message." So this
 * substitutes no friendlier sentence, and it also refuses to throw away the
 * fields where the cause actually lives.
 *
 * What an account may carry is decided HERE and nowhere below: an account
 * carries the parts the DATABASE authored. A part the CLIENT authored ABOUT a
 * failure — a runtime's stack frames, a body we had to serialise because it
 * carried no message — is not the database's words, and is answered the way a
 * document is: counted, never quoted (`partOfAccount` above).
 *
 * A part that another part already contains is dropped rather than repeated —
 * supabase-js's `details` opens with a copy of `message`, and printing the
 * wrapper twice tells an operator nothing. The `code` is a machine identifier
 * rather than prose, so it trails in parentheses, and only when the account
 * does not already spell it — but it is asked the same three questions on its
 * way there, because an intermediary authors that field too
 * (`codeOfAccount`). And when NOTHING survives, the account is the app's own
 * clause rather than the empty string a screen cannot read
 * (`REFUSED_WITHOUT_WORDS`).
 */
function errorMessage(error: unknown): string {
  const kept: string[] = [];
  for (const raw of accountParts(error, 0)) {
    // The ONE place the app decides what an account may carry, for every read
    // in `lib/db/**`. Every surface — the claims card, the paging routes'
    // error arms — inherits it with no line of its own
    // (admin-window/BUG-0170, admin-window/BUG-0173).
    const part = partOfAccount(raw);
    if (part === null) continue;
    if (kept.some((held) => held.includes(part))) continue;
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (part.includes(kept[index])) kept.splice(index, 1);
    }
    kept.push(part);
  }

  let account = kept.join(" ");
  const code = codeOfAccount(error);
  if (code !== null && !account.includes(code)) {
    account = account.length > 0 ? `${account} (${code})` : `(${code})`;
  }
  return withoutSecrets(account.length > 0 ? account : REFUSED_WITHOUT_WORDS);
}

/**
 * What this app is willing to call a column — the object grammar `missing`
 * admits, spelled ONCE for this module.
 *
 * `missing` is an OBJECT NAME, and the table half of it is the app's own (the
 * string `tables.ts` gave the query). The column half is mined out of the
 * DATABASE'S message, and that message is not necessarily the database's: for
 * any non-2xx, postgrest-js hands the parsed response body back AS the error
 * object, so an intermediary refusing with a JSON envelope authors `code` and
 * `message` both. Foreign text therefore reaches an app-authored sentence
 * here only through an ALLOWLIST — this bounded identifier class, the same
 * shape `UNQUOTED_COLUMN_REFERENCE` below is built from, capped at Postgres's
 * own 63-byte identifier limit (admin-window/BUG-0181; ARCHITECTURE.md Common
 * violations rows 15 and 20: one derivation per value class, in one home).
 *
 * It is an allowlist and not a scrub: a message this grammar refuses to take
 * a column out of is neither scrubbed, truncated nor counted — it is simply
 * not mined, and `classify` falls back to naming the object the query asked
 * for. The message itself still crosses into the `error` arm byte-identical
 * (admin-window/BUG-0173, admin-window/BUG-0179).
 */
const COLUMN_NAME_GRAMMAR = "[A-Za-z_][\\w$]{0,62}";

/** The whole of a mined column must BE that grammar, or it is not a column. */
const COLUMN_NAME = new RegExp(`^${COLUMN_NAME_GRAMMAR}$`);

/**
 * A column-absent message's UNQUOTED column reference.
 *
 * Postgres quotes an unqualified reference (`column "severity" does not
 * exist`) but spells a QUALIFIED one bare: `column events.badcol does not
 * exist` — the form a page selecting an explicit column list gets. The
 * trailing `does not exist` is required so that a message carrying no column
 * at all cannot have a word of its prose read as one. Each dot-segment is
 * `COLUMN_NAME_GRAMMAR`, so this spelling and the admission gate cannot drift
 * apart.
 */
const UNQUOTED_COLUMN_REFERENCE = new RegExp(
  `\\bcolumn\\s+(${COLUMN_NAME_GRAMMAR}(?:\\.${COLUMN_NAME_GRAMMAR})*)\\s+does not exist`,
  "i",
);

/** The last dot-segment of a possibly-qualified name — the column itself. */
function lastSegment(name: string): string | null {
  const segments = name.split(".");
  const last = segments[segments.length - 1];
  return last.length > 0 ? last : null;
}

/**
 * The column a column-absent message names, or `null` if it names none this
 * app could have named itself.
 *
 * Both spellings must resolve, because both reach us:
 *  - quoted — Postgres `column "severity" does not exist` and `column
 *    "severity" of relation "review_items" does not exist`; PostgREST
 *    `Could not find the 'severity' column of 'review_items' in the schema
 *    cache`. The first quoted token is the column.
 *  - unquoted and qualified — `column events.badcol does not exist`. Read for
 *    quotes alone this yields nothing, and the classification collapsed to the
 *    bare table name, so a fully-provisioned table read as absent
 *    (admin-window/TASK-0002).
 *
 * Either way any qualifier is dropped: the table `classify` reports is the one
 * the query asked for, from `tables.ts` (ARCHITECTURE.md §4.1).
 *
 * The string handed in is the DATABASE's own — `databaseMessage`, never
 * `messageOf` — so "the first quoted run anywhere" is bounded by PROVENANCE
 * as well as by the grammar. A value the database put no sentence in never
 * reaches here at all, which is what keeps a JSON key of this app's own
 * rendering of a foreign envelope out of `missing` (admin-window/BUG-0185).
 *
 * The quoted spelling is a first quoted run ANYWHERE in the message, with no
 * `column` word required of it — that is what makes the honest PostgREST form
 * resolve, and it is also what let a foreign envelope's own prose be named as
 * the missing object (admin-window/BUG-0181). So the mined name is ADMITTED
 * only if it matches `COLUMN_NAME`: `null` here is not a refusal to report,
 * it is `classify` falling back to the arm it already has, naming the table
 * alone.
 */
function columnFromMessage(message: string): string | null {
  const quoted = /'([^']+)'|"([^"]+)"/.exec(message);
  const unquoted = quoted ? null : UNQUOTED_COLUMN_REFERENCE.exec(message);
  const name = quoted?.[1] ?? quoted?.[2] ?? unquoted?.[1];
  if (name === undefined) return null;

  // The ONE point a mined column enters `missing`, and so the one place the
  // grammar is asked. No consumer re-asks it: what they receive is already an
  // object name.
  const column = lastSegment(name);
  return column !== null && COLUMN_NAME.test(column) ? column : null;
}

/**
 * Turn a database error into a `DbResult`.
 *
 * `missing` is an OBJECT NAME, always: either the name from `tables.ts` the
 * query used — so the rendered not-provisioned card names the same string the
 * query did — or that name qualified by a column (`review_items.severity`),
 * so the card names the column while still carrying the table, in whichever
 * spelling the message used, quoted or bare and qualified.
 *
 * The column half is the only part of `missing` that comes from OUTSIDE this
 * app, so it passes two gates. PROVENANCE first: the only string mined is
 * `databaseMessage(error)`, the words the DATABASE authored. A value carrying
 * no message at all — no `message` field, a `null`, a number, a nested object
 * — named no column, whatever this app's own serialisation of it happens to
 * contain, so it falls back to the object the query asked for exactly as a
 * message naming no column does (admin-window/BUG-0185). Then GRAMMAR: a
 * mined name is admitted only when it matches the app's own object grammar
 * (`COLUMN_NAME`), so naming something that is not a column name this app
 * could have spelled falls back the same way, rather than putting a
 * stranger's text where an object name belongs (admin-window/BUG-0181).
 * Consumers inherit an object name and are asked to isolate nothing.
 *
 * A function-absent code names nothing further: `missing` is the name the
 * caller passed, which is the name it called (admin-window/TASK-0047).
 *
 * **An absence claim is about the object the caller ASKED for** (`asked`,
 * default `"table"`; ARCHITECTURE.md §4.3, §10). A table read may never claim
 * an absent function and a function call may never claim an absent table: the
 * database reports a missing object it names ITSELF, and `missing` is the
 * object WE named, so a code outside the caller's own vocabulary is a failure
 * about some third thing and stays an error. Postgres raises `42883` at a
 * plain table read for a missing OVERLOAD of a function nobody asked for
 * (`function to_tsvector(timestamp with time zone) does not exist`, measured
 * on staging 2026-09-08) — reading that as an absence told an operator to
 * install a table that is right there, holding rows (admin-window/BUG-0080).
 *
 * Everything that is not an absence code OF WHAT WAS ASKED is `kind: "error"`
 * carrying the database's message verbatim.
 */
export function classify(
  error: unknown,
  missing: string,
  asked: AskedObject = "table",
): DbResult<never> {
  const code = errorCode(error);
  const refuse = (): DbResult<never> => ({
    kind: "error",
    reading: missing,
    message: errorMessage(error),
  });
  if (code === null) return refuse();

  // The one string CLASSIFICATION may read: what the DATABASE said, or `null`
  // when it said nothing. Never `messageOf`, whose fallback is this app's own
  // rendering of the value (admin-window/BUG-0185).
  const said = databaseMessage(error);

  if (ABSENCE_CODES[asked].has(code)) {
    // The absent OPERATOR shares `42883` with the absent function, and a
    // function's own body can raise it; it is not an absence of what was
    // asked for, so it falls through to `error`. A message the database did
    // not author tests nothing and makes no operator claim, so a silent
    // `42883` stays the absent function the caller asked for.
    if (asked === "function" && said !== null && MISSING_OPERATOR.test(said)) {
      return refuse();
    }
    return { kind: "not_provisioned", missing };
  }

  // A column is absent OF the table that was asked for, so it is an absence
  // only for a table read — the column codes cannot describe a function call.
  if (asked === "table" && COLUMN_ABSENT_CODES.has(code)) {
    const column = said === null ? null : columnFromMessage(said);
    if (column === null || column === missing || missing.endsWith(`.${column}`)) {
      return { kind: "not_provisioned", missing };
    }
    return { kind: "not_provisioned", missing: `${missing}.${column}` };
  }

  return refuse();
}

/**
 * Run one PostgREST query and classify whatever comes back.
 *
 * The client is resolved INSIDE the try, so an unset credential name — which
 * makes `getDbClient()` throw — becomes an error state rather than an
 * exception escaping into a page. Pass `db` to read through a different
 * client (the offline stub, or a live test's staging client).
 */
async function runQuery<T>(
  missing: string,
  run: (db: SupabaseClient) => PromiseLike<DbResponse<T>>,
  db?: SupabaseClient,
  asked: AskedObject = "table",
): Promise<DbResult<T | null>> {
  try {
    const client = db ?? getDbClient();
    const { data, error } = await run(client);
    if (error !== null && error !== undefined) return classify(error, missing, asked);
    return { kind: "ok", data: data ?? null };
  } catch (thrown) {
    return classify(thrown, missing, asked);
  }
}

/** A row-set read. `ok` always carries an array — an empty one when there are no rows. */
export async function readRows<Row>(
  missing: string,
  run: (db: SupabaseClient) => PromiseLike<DbResponse<Row[]>>,
  db?: SupabaseClient,
): Promise<DbResult<Row[]>> {
  const result = await runQuery<Row[]>(missing, run, db);
  if (result.kind !== "ok") return result;
  return { kind: "ok", data: result.data ?? [] };
}

/**
 * A COMPLETE row-set read: the `ok` array is the WHOLE matching set, or the
 * read refuses (ARCHITECTURE.md §4.3, campaign admin-window/TASK-0026).
 *
 * The `run` callback MUST build its query with `{ count: "exact" }`, a total
 * `.order()` ending in the primary key, and `.range(0, cap - 1)` — `cap` is
 * handed in so the caller never spells the number itself. The server order
 * makes the row set (and therefore any refusal) deterministic; it is not the
 * display order, which stays with the domain module.
 *
 * In order:
 *  - a database error classifies exactly as `readRows` does, so an absent
 *    table still reads as `not_provisioned`;
 *  - `count === null` with no error is a refusal, never a number of our own:
 *    the query was written without `{ count: "exact" }` and we cannot know how
 *    many rows matched (BUG-0007's rule on the user-visible path);
 *  - `count > rows.length` means SOMETHING truncated the set — our cap, or the
 *    server's `db-max-rows`, which our cap alone cannot detect — so the read
 *    refuses with the real number rather than returning a partial array;
 *  - otherwise `ok` with every row.
 *
 * **Every figure, count, oldest-age and exactness claim in this app rests on
 * that property**, which is why no caller carries a "was that all of it?"
 * flag: a partial answer never becomes an `ok`.
 */
export async function readComplete<Row>(
  missing: string,
  run: (db: SupabaseClient, cap: number) => PromiseLike<DbCountedResponse<Row[]>>,
  db?: SupabaseClient,
): Promise<DbResult<Row[]>> {
  try {
    const client = db ?? getDbClient();
    const { data, error, count } = await run(client, ROW_CAP);
    if (error !== null && error !== undefined) return classify(error, missing);

    const rows = data ?? [];
    if (count === null || count === undefined) {
      return {
        kind: "error",
        reading: missing,
        message:
          `the read returned no count, so whether these ${rows.length} rows ` +
          `are all of them is unknown; a complete read requires ` +
          `{ count: "exact" }.`,
      };
    }
    if (count > rows.length) {
      return {
        kind: "error",
        reading: missing,
        message:
          `the database holds ${count} rows matching this read and it is ` +
          `capped at ${ROW_CAP} (${rows.length} returned); narrow the filter ` +
          `or raise ROW_CAP.`,
      };
    }
    return { kind: "ok", data: rows };
  } catch (thrown) {
    return classify(thrown, missing);
  }
}

/** A single-row read (`.maybeSingle()`). `ok` carries `null` when there is no row. */
export async function readOne<Row>(
  missing: string,
  run: (db: SupabaseClient) => PromiseLike<DbResponse<Row>>,
  db?: SupabaseClient,
): Promise<DbResult<Row | null>> {
  return runQuery<Row>(missing, run, db);
}

/**
 * A call to a database FUNCTION — the one read kind whose caller may be told
 * the function itself is absent.
 *
 * The `run` callback is what actually calls the function through the client's
 * procedure seam — spelled at the CALL SITE, never here, because no module
 * under `src/` may carry that call today (`tests/offline/browse/views.test.ts`,
 * "has no SQL-executing route and no whole-table browser"). `fn` is the name the
 * call used, so the not-provisioned card names what the app asked for. Which
 * is the whole reason this exists as its own seam rather than as a table read
 * with a function's name in it: absence is claimed about what was ASKED, and
 * only a caller that came through here asked for a function
 * (admin-window/TASK-0047 established the absence, admin-window/BUG-0080
 * narrowed it to this seam).
 *
 * M2's normal case: the resolver procedure is not installed until the handoff
 * migration is, so `not_provisioned` naming it is what the close slot renders,
 * every time, until it is (ARCHITECTURE.md §4.1, §4.3). It never throws, and
 * `ok` carries whatever the function returned — `null` when it returned
 * nothing.
 */
export async function callFunction<T>(
  fn: string,
  run: (db: SupabaseClient) => PromiseLike<DbResponse<T>>,
  db?: SupabaseClient,
): Promise<DbResult<T | null>> {
  return runQuery<T>(fn, run, db, "function");
}

/**
 * A `head: true, count: "exact"` read. `ok` carries the count the database
 * gave — and a database that gave none is a refusal, never a zero.
 *
 * This used to substitute a zero for an absent count (BUG-0007's user-visible
 * twin), so a response with `error: null` and `count: null` — exactly what a
 * select written WITHOUT `{ head: true, count: "exact" }` returns — rendered a
 * confident `0` for a table holding 47 rows. A real zero still comes back as `ok` 0; only the
 * absent count refuses (ARCHITECTURE.md §4.3, campaign
 * admin-window/TASK-0026). It still never throws (§4.1).
 */
export async function readCount(
  missing: string,
  run: (db: SupabaseClient) => PromiseLike<{ count: number | null; error: unknown }>,
  db?: SupabaseClient,
): Promise<DbResult<number>> {
  try {
    const client = db ?? getDbClient();
    const { count, error } = await run(client);
    if (error !== null && error !== undefined) return classify(error, missing);
    if (count === null || count === undefined) {
      return {
        kind: "error",
        reading: missing,
        message:
          `the query returned no count, so the number of rows is unknown; a ` +
          `count read requires { head: true, count: "exact" }.`,
      };
    }
    return { kind: "ok", data: count };
  } catch (thrown) {
    return classify(thrown, missing);
  }
}

/* ── the second leg of a two-step join (ARCHITECTURE.md §4.2) ─────────────── */

/**
 * How many ids go into one `.in(...)`. PostgREST puts the list in the URL, so
 * an unchunked `.in()` over a 1,000-row id set builds a request long enough to
 * be refused by a proxy. Chunking keeps every request bounded.
 */
export const ID_CHUNK = 100;

/**
 * How many chunk requests may be in flight at once (admin-window/TASK-0062).
 *
 * `readRowsByIds` walked its chunks ONE AT A TIME, so a two-step join over an
 * id set spanning n chunks cost n round trips end to end and `/claims` paid
 * that latency on every load (admin-window/BUG-0138, FEAT-0014). The chunks
 * are independent reads of the same object, so they are issued together — but
 * BOUNDED: an unbounded fan-out over a 1,000-id set would open ten concurrent
 * requests at a database three repos share, which is the failure mode this
 * constant exists to prevent, not a number to raise when a page feels slow.
 */
export const CHUNK_FANOUT = 4;

/** Split a list into chunks of at most `size`. */
export function chunk<T2>(items: readonly T2[], size = ID_CHUNK): T2[][] {
  if (size <= 0) return [[...items]];
  const chunks: T2[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * The second leg of a two-step join (ARCHITECTURE.md §4.2): query A returned
 * rows, `ids` are its keys, and this runs query B `.in(...)` over them in
 * bounded chunks and concatenates the results.
 *
 * No ids means no query at all — an empty `.in()` is a pointless round trip,
 * and `ok: []` is the honest answer.
 *
 * The chunks are issued in BATCHES of at most `CHUNK_FANOUT`, batches in
 * chunk-index order, and every refusal guarantee the sequential loop made is
 * unchanged (admin-window/TASK-0062; SPEC F16 — only the clock moves):
 *
 *  - the rows concatenate in CHUNK-INDEX order, never completion order, so the
 *    result is the id set's own order however the requests interleave;
 *  - a batch holding a non-`ok` returns its LOWEST-INDEX one UNCHANGED —
 *    which is the answer the sequential loop gave, since it would have reached
 *    that chunk first — so a missing table still reaches the page as
 *    `not_provisioned` naming that table, and the rows already collected are
 *    discarded rather than returned as a half-filled `ok`;
 *  - no batch is started after a refusal is known, so a refused read still
 *    issues strictly fewer requests than there are chunks.
 *
 * Batches, rather than a promise pool that refills as each request lands: the
 * pool is equally bounded but its refusal depends on WHICH request happened to
 * land first, and a guarantee that only usually holds is not a guarantee. Here
 * the batch is awaited whole and scanned in index order, so the answer is the
 * same on every run.
 *
 * It lives here, beside the read kinds, rather than in `lib/db/gauges.ts`
 * where campaign admin-window/TASK-0007 first needed it: §4.2's two-step is
 * every reader's rule, and `lib/db/claims.ts` is the second module to join on
 * an id set (admin-window/TASK-0012). `gauges.ts` re-exports both names, so
 * every existing caller and test still imports them from where they were.
 */
export async function readRowsByIds<Row>(
  missing: string,
  ids: readonly string[],
  run: (db: SupabaseClient, chunkIds: string[]) => PromiseLike<DbResponse<Row[]>>,
  db?: SupabaseClient,
): Promise<DbResult<Row[]>> {
  if (ids.length === 0) return { kind: "ok", data: [] };
  const chunks = chunk(ids);
  const collected: Row[] = [];
  for (let start = 0; start < chunks.length; start += CHUNK_FANOUT) {
    // One batch, issued together. `readRows` never throws and never rejects
    // (ARCHITECTURE.md §4.1), so `Promise.all` here settles with one
    // `DbResult` per chunk rather than losing the others to a rejection.
    const batch = await Promise.all(
      chunks
        .slice(start, start + CHUNK_FANOUT)
        .map((chunkIds) =>
          readRows<Row>(missing, (client) => run(client, chunkIds), db),
        ),
    );
    // Scanned in chunk-index order, so both the row order and WHICH refusal
    // comes back are the sequential loop's answers, not the network's.
    for (const result of batch) {
      if (result.kind !== "ok") return result;
      collected.push(...result.data);
    }
  }
  return { kind: "ok", data: collected };
}
