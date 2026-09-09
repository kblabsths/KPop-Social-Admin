/**
 * The FIX half of a refused write — campaign admin-window/BUG-0098.
 *
 * LOOK_AND_FEEL says the same thing twice. Interaction principles, Error: "A
 * failed call surfaces the function's own refusal in mono, plus the fix in the
 * app's voice." Copy bar 3: "Every error names what failed, then what to do,
 * with no apology." Every READ in this app already ships that two-part
 * anatomy (`components/ui/error-line.tsx`: `failed` in `type-data`, `retry` in
 * `type-body`), and the one place the app WRITES shipped only the first half —
 * measured by the designer on the M2 early walk, 2026-09-08: typing `seven`
 * into `tally` told the operator `invalid input syntax for type integer:
 * "seven" (22P02)` and nothing else, and clearing `label` told them Postgres's
 * whole DETAIL line, every column value of the row included, with no sentence
 * saying label cannot be emptied.
 *
 * **One place decides the sentence, and it decides it from the refusal's own
 * words.** Not from the column, not from the table, not from a per-call-site
 * string: `EditStatus` is the only caller, so a refusal that no walk has ever
 * seen — the gate's, when FEAT-0011 lands the override half — still arrives
 * carrying a fix. What this cannot recognise falls back to the general
 * sentence rather than to nothing, which is the whole reason the fallback is
 * an arm of the same function and not the absence of one.
 *
 * **It paraphrases nothing.** The machine's words are rendered verbatim beside
 * this sentence, always; nothing here replaces, shortens or prettifies them
 * ("Errors are never swallowed and never replaced with a generic message").
 * The arms below only ADD what the database cannot say: what to type instead.
 *
 * Three things about how the sentences are written, each forced rather than
 * picked:
 *
 *  - **The offending value is never quoted back into the sentence.** It is
 *    already beside it, verbatim in mono, and a trailing space quoted
 *    mid-sentence is invisible exactly where it matters — the reasoning
 *    `notAnId` recorded on the record page (admin-window/BUG-0065).
 *  - **The required FORM is described in words, with an example**, exactly as
 *    that same card describes a uuid ("32 hexadecimal digits usually written
 *    in five hyphenated groups"). The one form this app cannot describe is a
 *    registry pattern — the gate owns those and this repo holds no copy of any
 *    of them by design (`lib/edit/config.ts`, AGENTS.md) — so that arm names
 *    the pattern as the thing to match and leaves the pattern itself in the
 *    mono half where the database put it. Inventing an example of `^[A-Z]{2}$`
 *    here would be the copy of the registry the ecosystem forbids.
 *  - **No apology and no reassurance** (copy bar 3), sentence case (copy bar
 *    5), and the sentence names an action wherever an action exists. Where one
 *    does not — a database object that has not been installed — it says so
 *    rather than inviting a retype that cannot work.
 *
 * A pure leaf beside the cell rather than a block inside `EditableCell.tsx`,
 * for the reason `edit-cell-layout.ts` is one: a rule with no React in it is
 * testable, and reviewable, on its own, and this one is a table of shapes that
 * will grow every time the ecosystem grows a refusal.
 */

/** The em dash the fix sentences join their two clauses with. */
const DASH = "—";

/**
 * A refusal states a SQLSTATE either in the database's own prose or as the
 * trailing code `errorMessage` appends (`lib/db/result.ts`), and the two do
 * not always both arrive: PostgREST's own envelope carries the code, a
 * `RAISE` inside a function carries the prose. Recognising on either is what
 * keeps an arm from going quiet when one of the two is missing.
 */
function states(refusal: string, prose: RegExp, code: string): boolean {
  return prose.test(refusal) || refusal.includes(`(${code})`);
}

/** `null value in column "label" of relation "walk_sandbox" violates …` */
const NOT_NULL_PROSE = /violates not-null constraint/i;
const NOT_NULL_COLUMN = /null value in column "([^"]+)"/i;

/** `invalid input syntax for type integer: "seven"` */
const BAD_SYNTAX_PROSE = /invalid input syntax for type/i;
const BAD_SYNTAX_TYPE = /invalid input syntax for type ([a-z][a-z0-9 ]*?)\s*[:(]/i;

/**
 * The gate's schema refusal, in the shape the scraper's own `RAISE` builds it
 * (`supabase/migrations/20260818000000_the_schema_arrives_as_one_snapshot.sql`,
 * the `KS003` arm on `jsonb_matches_schema`): the message names the qualified
 * field, and the DETAIL carries `reason=` with the validator's own words. That
 * whole account reaches this app as one string, message then detail then hint,
 * because `errorMessage` refuses to throw the fields away
 * (admin-window/BUG-0016).
 */
const SCHEMA_PROSE = /violates domain "[^"]*" schema|does not match/i;
const SCHEMA_FIELD = /value for field "([^"]+)"/i;

/** `settle_review_item is not present in this database` — this app's own words. */
const NOT_PROVISIONED = /\bis not present in this database\b/i;

/**
 * How a Postgres type is TYPED, in the app's words and with an example of the
 * form — the coercion arm's whole content.
 *
 * The type name is read out of the database's own message, so a type nobody
 * listed still gets a sentence naming it (the last arm) rather than the
 * general fallback.
 */
const TYPE_FORMS: readonly (readonly [RegExp, string])[] = [
  [/^(?:small|big)?int(?:eger|2|4|8)?$/, "a whole number, like 7"],
  [/^bool(?:ean)?$/, "true or false"],
  [/^date$/, "a date, like 2026-01-15"],
  [
    /^(?:timestamptz|timestamp(?: with(?:out)? time zone)?)$/,
    "a timestamp, like 2026-01-15T19:00:00+00:00",
  ],
  [
    /^(?:numeric|decimal|real|float\d*|double precision)$/,
    "a number, like 7.5",
  ],
  [/^uuid$/, "a uuid, like 00000000-0000-4000-8000-000000000001"],
];

/** The column a not-null refusal names, or `null` when it names none. */
function columnOf(refusal: string): string | null {
  return NOT_NULL_COLUMN.exec(refusal)?.[1] ?? null;
}

/**
 * The FIELD a gate refusal is about, unqualified: the gate spells it
 * `venues.country` and the operator is looking at a line called `country`.
 */
function fieldOf(refusal: string): string | null {
  const qualified = SCHEMA_FIELD.exec(refusal)?.[1];
  if (qualified === undefined) return null;
  const bare = qualified.split(".").pop() ?? "";
  return bare === "" ? null : bare;
}

/** What a value of `type` looks like when it is typed into a field. */
function formOf(type: string): string | null {
  const name = type.trim().toLowerCase();
  for (const [shape, form] of TYPE_FORMS) {
    if (shape.test(name)) return form;
  }
  return null;
}

/**
 * The general fix — what to do about a refusal this app has never seen.
 *
 * It names an action and makes no claim about what the database did with the
 * row, because a refusal it cannot recognise is one it cannot speak for. The
 * machine's own words stand beside it and carry the specifics.
 */
export const GENERAL_FIX = "Correct what the refusal names and save again.";

/**
 * One sentence in the app's voice: what to do about this refusal.
 *
 * Total over every string — there is no arm that answers nothing, which is
 * criterion 2 of admin-window/BUG-0098 and the reason `GENERAL_FIX` is
 * exported: a test can prove an arm fired by proving it is not the fallback.
 */
export function refusalFix(refusal: string): string {
  // A database object that has not arrived is not a value problem, and telling
  // the operator to correct the value would send them round a loop no retype
  // can leave. It is the normal answer on the override path for the whole of
  // M2 (the route's own 503, `api/admin/records/[table]/[id]/route.ts`).
  if (NOT_PROVISIONED.test(refusal)) {
    return `This edit needs a database object that has not arrived yet ${DASH} nothing you retype will land until it does.`;
  }

  if (states(refusal, NOT_NULL_PROSE, "23502")) {
    const column = columnOf(refusal);
    const subject = column === null ? "This column" : column;
    return `${subject} cannot be cleared ${DASH} type a value into it.`;
  }

  if (states(refusal, BAD_SYNTAX_PROSE, "22P02")) {
    const type = BAD_SYNTAX_TYPE.exec(refusal)?.[1];
    if (type === undefined) return "Type a value in the form this column stores.";
    const form = formOf(type);
    return form === null
      ? `Type a value the database reads as ${type.trim()}.`
      : `Type ${form}.`;
  }

  // The gate's, not Postgres's: the registry patterns on `venues.country` and
  // `events.poster_url` are enforced there and this repo holds no copy of
  // either, so the sentence points at the pattern the refusal states rather
  // than restating what a country code looks like.
  if (states(refusal, SCHEMA_PROSE, "KS003")) {
    const field = fieldOf(refusal);
    return field === null
      ? `The value did not match this field's registered pattern ${DASH} correct it to that form and save again.`
      : `${field} did not match its registered pattern ${DASH} correct the value to that form and save again.`;
  }

  return GENERAL_FIX;
}
