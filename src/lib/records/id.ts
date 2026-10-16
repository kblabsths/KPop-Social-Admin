/**
 * The app's ONE uuid grammar — campaign admin-window/DEBT-0009.
 *
 * A PURE DOMAIN LEAF, the sibling of `provenance.ts` and `routes.ts`
 * (ARCHITECTURE.md §4 rule 7): it reaches nothing that can reach a database —
 * not `lib/db/**`, not `@supabase/supabase-js`, not `process.env`, not React —
 * and nothing imports back into it, so no cycle can be written through it and
 * every layer above may reach it. `tests/offline/db/layering.test.ts` names it
 * in the leaf set and pins that, on the same two fixtures every guard here
 * owes.
 *
 * Its ONE import is another leaf, which rule 7 ¶2 permits and this file is a
 * reason for: `trimInkPadding` in `lib/url/text.ts` is the app's one ends-only
 * ink-padding strip, and `canonicalRecordId` below CALLS it rather than
 * holding a second copy of it (admin-window/BUG-0155, criterion 3). It was a
 * private `trimPad` here until then; its behaviour did not change in the move,
 * and the definition of blank it rests on is still `hasVisibleContent` in
 * `lib/verdict/decision.ts`, one leaf further down (admin-window/BUG-0146).
 *
 * **It moved here from `lib/db/records.ts`, where these two functions had
 * always been pure and had always been out of reach** (the M2 structure walk,
 * 2026-09-09). Neither takes a client, an env name or a table name; they are
 * questions about a REQUEST. Living under `lib/db/**` meant a pure leaf could
 * not ask them at all, which cost admin-window/BUG-0141 a ruling written as a
 * design choice ("canonicalised ONCE at the page and handed INTO the leaf as
 * an argument") and left `/claims` comparing a URL's raw `source_id` to the
 * ids the view holds — admin-window/BUG-0140's defect, one route over from
 * where it was fixed. Nothing about the grammar itself changed in the move;
 * the two docstrings below are the ones the functions arrived with.
 *
 * The two ask DIFFERENT questions of one grammar and each owns its own
 * (LESSONS 4). Which to call is decided by what the caller does next: carry
 * the value VERBATIM to a query (`isRecordId`), or DERIVE an id from a
 * request value (`canonicalRecordId`).
 */

import { trimInkPadding } from "@/lib/url/text";

/**
 * Postgres's own uuid syntax, as `uuid_in` accepts it — the grammar this
 * predicate mirrors deliberately, rather than the canonical spelling alone
 * (`src/backend/utils/adt/uuid.c`, `string_to_uuid`): 32 hex digits, either
 * case, with a hyphen permitted — never required — after any EVEN number of
 * them up to 28. So `259e2030-00bd-4200-8730-4669e46a0c04`, the same value
 * unhyphenated and the same value uppercased are one id, and each of the three
 * really does resolve to the same staging row (measured on a production build,
 * 2026-09-03: `/records/groups/<id>` renders 11 field rows in all three
 * spellings).
 *
 * Being no stricter than Postgres is the whole point. A canonical-only test
 * would refuse an id the database would have resolved to a real row, and
 * telling an operator that a working id "is not an id" is a worse failure
 * than the one this guard exists to fix.
 *
 * Postgres also accepts a uuid wrapped in BRACES, and this deliberately does
 * not: the brace cannot survive the URL. Next hands a dynamic segment over
 * still percent-encoded — measured the same day, `/records/groups/{<id>}` and
 * `/records/groups/%7B<id>%7D` both reach the page as the literal
 * `%7B<id>%7D` — so what an operator's braced paste actually asks for is a row
 * whose id contains percent signs, which Postgres refuses as well. Answering
 * "that is not an id" is therefore the same answer the database would give,
 * and a brace arm here would be a grammar no request can reach.
 */
const RECORD_ID = /^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i;

/**
 * Does this URL segment spell a record id AT ALL — campaign
 * admin-window/BUG-0065.
 *
 * Every table in the map is keyed by a uuid, so an id that is not one can
 * match no row anywhere and needs no database to say so: the comparison is
 * refused by Postgres before a row is considered, with `22P02 invalid input
 * syntax for type uuid` — which the data layer classifies, correctly, as an
 * arbitrary failure and the surface then renders as "the read failed, reload"
 * (measured on a production build against staging, 2026-09-03). Reloading
 * re-sends the same malformed segment forever, so that advice can never work.
 *
 * The caller asks this BEFORE it reads. That placement is the fix and not an
 * optimisation: it is what makes one bad address produce ONE answer on a
 * resolver-owned table, where three reads would otherwise each report the same
 * refusal separately. And a segment that is not a uuid can equal no uuid
 * primary key in any table, so "no record at this address" is knowable here
 * with certainty — which is what lets the surface answer without either
 * claiming the database failed or claiming it answered.
 *
 * It is a question about the REQUEST, so it takes the raw segment and no
 * config: the map carries a table's primary-key COLUMN, never its type, and
 * inventing a per-table id grammar here would be a second allowlist
 * (ARCHITECTURE.md §9). If a future catalog table were keyed by anything but a
 * uuid, this is the one line that learns it.
 */
export function isRecordId(id: string): boolean {
  return RECORD_ID.test(id);
}

/**
 * The id a REQUEST VALUE names, in the ONE spelling Postgres itself prints —
 * lowercase, hyphenated, 8-4-4-4-12 — or `null` when the value names no record
 * id at all (campaign admin-window/BUG-0140).
 *
 * It lives beside `isRecordId` and is built ON it, so there is ONE uuid
 * grammar and not two: everything that predicate accepts as an id, this
 * reduces to a single string. A second lowercasing spelled at a call site
 * would be the second uuid pattern `isRecordId` exists to prevent.
 *
 * The two ask DIFFERENT questions of that one grammar, and each owns its own
 * (LESSONS 4). `isRecordId` asks whether a string, AS IT STANDS, is an id —
 * asked of a value the caller then carries to the query VERBATIM (a dynamic
 * segment, a PATCH body's `ref`), which is why it is exactly as strict as
 * `uuid_in` and refuses padding, as Postgres does. This one asks what id a
 * value DERIVED FROM A REQUEST names, so it first strips the PADDING the paste
 * brought — a copy off a log line or a psql column carries a leading space or
 * a trailing newline, and a `?cycle=%20<id>` reaches a page as a real space —
 * and then applies that same grammar to what is left. Until
 * admin-window/BUG-0145 it did not, and `/cycles` printed "is not among the
 * 200 newest cycles" about a cycle whose row it was rendering three elements
 * below: HTML collapses the padding, so the denied id read character for
 * character like the drawn one and the operator had nothing to see.
 *
 * **Padding is decided by INK, not by whitespace** (admin-window/BUG-0146).
 * BUG-0145 spelled that step `String.prototype.trim()`, which strips the
 * Unicode `White_Space` set and nothing else, so the identical harm survived
 * for every ink-less character outside it — U+200B ZERO WIDTH SPACE, U+00AD
 * SOFT HYPHEN, U+2060 WORD JOINER, NUL, DEL, the bidi controls, a HANGUL
 * FILLER. All eight lay out at 0px (measured in Chromium for
 * admin-window/BUG-0136), so the denial again read character-for-character
 * like the drawn row. The class is not re-enumerated here — that would be the
 * fourth list, and a list is what BUG-0089/BUG-0136 ruled against.
 * `trimInkPadding` (`lib/url/text.ts`) asks `hasVisibleContent`, the app's ONE
 * definition of blank (`lib/verdict/decision.ts`), of one code point at a
 * time — and it is the app's ONE strip, shared with the free-text class's
 * derivation `canonicalUrlText`, so the two value classes cannot drift apart
 * on what padding IS (admin-window/BUG-0155).
 *
 * The strip is bounded to the ENDS, and that bound is the invariant's: the app's
 * ink test removes ink-less characters ANYWHERE, so a whole-string
 * `visibleContent` would give `<half-an-id><U+200B><rest>` a canonical form
 * that Postgres itself would refuse from a verbatim segment. Trimming only the
 * ends keeps what this returns something `isRecordId` accepts, with no such
 * question (the ticket's own note on arm (a)).
 *
 * Trimming HERE, and not at a page's edge, is what makes every facet that
 * canonicalises answer a padded paste the same way — `?cycle=` and `?run=` on
 * `/cycles`, `?source_id=` on `/queues`, `?source=` on `/sources`, and the
 * claims filters (LESSONS 5: a shared spelling is imported, never retyped).
 * Padding INSIDE the value is not padding and is no id, and a value that is
 * only padding names none either.
 *
 * What this RETURNS is always a string `isRecordId` accepts, which is the
 * invariant every call site rests on: the canonical form — never the input —
 * is what reaches a query, so no padded value can arrive at Postgres as
 * `22P02`.
 *
 * **Why anything needs it.** Postgres compares a `uuid` column by VALUE, so
 * `.eq()` matches every spelling of one id; JavaScript compares the same id by
 * STRING, so `===` matches exactly one. A surface that narrows at the query
 * AND in code — which every gauge here does, deliberately, so that the
 * returned set is decided by exactly one function — therefore has two
 * comparisons that must agree, and they only agree on values that have been
 * put in one spelling first. Where a URL's raw value went straight to both,
 * `/sources` denied a source the database it had just read matched
 * (admin-window/BUG-0140). Canonicalise where the value is DERIVED from the
 * request, once, and everything downstream — the query, the fold, the chip
 * that renders the narrowing back as a link — is comparing like with like.
 *
 * The canonical form is the database's own output spelling, so a value read
 * from a row is already canonical and passing it through changes nothing.
 */
export function canonicalRecordId(id: string): string | null {
  const value = trimInkPadding(id);
  if (!isRecordId(value)) return null;
  const hex = value.replace(/-/g, "").toLowerCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
