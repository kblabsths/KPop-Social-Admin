import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { recordFields, type WriteAccess } from "@/components/records/fields";
import { RecordFields } from "@/components/records/record-fields";
import { Empty, Page, Section, StateOf } from "@/components/ui";
import {
  isRecordId,
  readRecord,
  readReferenceChoices,
  readRecordProvenance,
  readRecordReference,
} from "@/lib/db/records";
import { readSettlementReadiness } from "@/lib/db/verdict";
import {
  editConfigFor,
  writePathFor,
  type TableEditConfig,
} from "@/lib/edit/config";
import { EM_DASH } from "@/lib/format";

/**
 * The edit surface for one canonical record — campaign admin-window/TASK-0018.
 * Spec §8, ARCHITECTURE.md §9, acceptance test 7's sandbox half.
 *
 * One page for every table in `EDIT_CONFIG`, reached from Browse
 * (`/records/events/<id>`). The MAP decides everything below:
 *
 *  - a table the map does not carry has no record surface at all — `notFound()`,
 *    which is the page's twin of the route's 404 for the same request. It is
 *    the SECOND of two layers: `next.config.ts` rewrites such a URL to a path
 *    no route matches, so Next's own routing-level 404 answers first and the
 *    operator gets the app's framed not-found page, server-rendered, with
 *    status 404 (campaign admin-window/BUG-0017 — the throw below cannot
 *    produce both, and that config comment records the measurements). The
 *    throw stays because a refusal is the page's own business: it still
 *    answers for the spellings the rewrite deliberately leaves alone, and the
 *    surface must never render a table the map does not carry;
 *  - `walk_sandbox` is the sandbox regime — the app's only direct write, on a
 *    staging-only fixture table — so a column its allowlist carries edits as a
 *    cell: the `EditableCell` primitive (TASK-0004), reached through
 *    `src/components/records/field-editor.tsx`. That wrapper is what holds the
 *    route knowledge `EditableCell` deliberately lacks, and it lives under
 *    `src/components/` because components do (ARCHITECTURE.md §4 rule 6) and
 *    because a server component cannot hand a callback to a client one; the
 *    page renders no input of its own and never will;
 *  - `events` and `venues` are resolver-owned, so a column their allowlist
 *    carries edits as the SAME cell — through the override path, which records
 *    the edit as an admin-tier observation rather than writing the row
 *    (ARCHITECTURE §9.2, campaign admin-window/TASK-0054). Whether that path
 *    is open is a question about the DATABASE and is asked here, once, of the
 *    one seam (`readSettlementReadiness`): closed, the page renders read-only
 *    with the reason named and draws no control at all — no widget, no
 *    disabled input, no button toward a write path that does not exist. That
 *    is the graded normal case, and it is exactly the surface M1 shipped;
 *  - `groups` and `idols` have no record surface at all. Ben struck the direct
 *    catalog edit on 2026-09-08 and they left the map with it, so this page
 *    never renders either one; the URL is a routed 404 (ARCHITECTURE §9,
 *    DECISIONS 2026-09-08).
 *
 * The surface is one half of the refusal and never the whole of it: a column
 * absent from the map draws no widget HERE and is refused server-side by the
 * route, with the row unchanged. Hiding a widget is not a refusal.
 *
 * This page function is the only async component on the route
 * (ARCHITECTURE.md §5); `RecordFields` and everything under it are pure sync
 * components over plain props, which is what lets the offline suite render
 * this with `renderToStaticMarkup(await RecordPage(props))` and no database.
 *
 * The map now carries that display list, and this page reads what it names
 * (Ben's ruling, 2026-09-02; admin-window/TASK-0029). A resolver-owned record
 * shows the columns an operator came to see — read-only, with per-field
 * provenance beside each — because `recordColumns` asks for pk + editable +
 * `display` and the widget still follows `decideEdit`, which does not read
 * `display` at all. The page gained no list of its own: inventing one here
 * would be the second allowlist §9 forbids.
 *
 * **EVERY LEG ANSWERS FOR ITSELF.** The values, the per-field provenance and
 * the name of the record a reference column points at are separate reads that
 * report separately, exactly as Browse does its legs: a refused or absent
 * `field_provenance` leaves every value on screen and says for itself what
 * happened, a name relation that refuses costs the venue's NAME and not the
 * link to it, and a failed value read still shows the record's id. None ever
 * blanks another (admin-window/TASK-0029, BUG-0034).
 */

/**
 * What the operator is told about how this table is written — the regime's
 * consequence, in the app's voice, and the same distinction the write path
 * makes (`writePathFor` in `src/lib/edit/config.ts`).
 *
 * The direct line states the provenance fact plainly: `field_provenance`
 * carries rows for resolver-owned entities and this table has none, so no
 * source stands beside its values. That is a fact about the data, not a
 * placeholder value in the provenance slot — and it is said ONCE per record
 * rather than repeated on every line, which is what Ben confirmed on
 * admin-window/TASK-0025 (2026-09-02: keep this rendering; the resolver-owned
 * tables get real per-field provenance, admin-window/TASK-0029).
 *
 * **It no longer says "to the catalog", and that is the point of the rename**
 * (ARCHITECTURE §9.1 item 5, re-ruled 2026-09-08). The only table left with a
 * direct write is the walk sandbox, a staging-only fixture in nobody's
 * ecosystem domain: a value written there reaches no catalog and never did,
 * and the old wording was an inaccuracy the regime name was carrying. Since
 * Ben's strike, no catalog table has a direct write path at all.
 *
 * **The table's NAME is not in this string** (admin-window/BUG-0112). A table
 * name is a value the database produced, not a word the app wrote, so it is
 * drawn by the caller in the app's one identifier-in-prose spelling — the same
 * one `NotProvisioned` gives the table it names and `Page` gives this page's
 * own heading — and what this function returns is only the words the app wrote
 * about it. The sentence on screen is unchanged: it still opens with the name,
 * followed by these words.
 */
function regimeNote(config: TableEditConfig): string {
  return writePathFor(config.regime) === "direct"
    ? `is a staging fixture table, edited directly: a value ` +
        `changed here is written to it as it stands and reaches no catalog ` +
        `record. No field provenance is recorded for it, so no source is ` +
        `shown beside a value.`
    : `is resolver-owned: its values change through the ` +
        `resolution pipeline, never by a direct edit. An edit here is ` +
        `recorded as an admin override — a claim at the admin tier, ` +
        `applied through the pipeline and logged — and the pipeline then ` +
        `leaves that field alone.`;
}

/**
 * What stands in for the controls when the override path is CLOSED — campaign
 * admin-window/TASK-0054, FEAT-0011 criterion 2.
 *
 * It says the consequence in the app's voice; the card beneath it names the
 * object that is missing, in the object's own spelling, because that is the
 * one thing an operator (or an oracle) can act on. Two lines rather than one
 * for the reason the four states already separate: what the surface can do is
 * the app's business, and what the database is missing is the database's
 * (LOOK_AND_FEEL state 3, Voice bar 4).
 *
 * It is a statement about the PATH, so it never varies with the record's data,
 * and it is said once per record — never per line, and never in place of a
 * value.
 */
const OVERRIDE_UNAVAILABLE =
  "No field here can be edited: an edit is recorded through the resolution " +
  "pipeline, and what records it is not present in this database. Every " +
  "value below is read-only until it is.";

/**
 * What an EMPTY provenance cell means, said once above the table — campaign
 * admin-window/BUG-0053.
 *
 * The resolver-owned branch of `regimeNote` explains how the values are
 * written and says nothing about the column beside them, so a record whose
 * fields carry no `field_provenance` row rendered a whole column of the app's
 * absence marker with no line anywhere saying what one means. Both
 * document-blind user-sims reached that independently (2026-09-03): one read
 * the column as "we lost the data", the other worked the meaning out only by
 * opening a SECOND event and comparing. The dash itself is right — it is the
 * Look's mandated null rendering — so what was missing is a legend, not a
 * state change, and the field table keeps its rows.
 *
 * Three things about it are deliberate:
 *
 *  - it is a statement about a CELL, not about this record, so it stays true
 *    on a record where three of six fields are sourced and three are not (the
 *    contrast case the sim hit). It never varies with the data, which is what
 *    makes it a legend rather than a verdict the rows could contradict;
 *  - it is said ONCE, above the table, beside the regime note — never per row,
 *    and never in place of the `—` (Ben's ruling on admin-window/TASK-0025:
 *    the reason stands with the record, not repeated on every line);
 *  - it is only said when the provenance leg ANSWERED. A leg that refused or
 *    found no table produces the same column of dashes for a completely
 *    different reason, and `LegNote` already says that reason in the
 *    database's own words; claiming "no row stands behind this value" over a
 *    read that never happened would be the page inventing a fact.
 *
 * It says nothing on a directly-written table: `regimeNote` already explains that
 * column there ("No field provenance is recorded for it"), and the asymmetry
 * this ticket is about was that the branch needing no explanation had one.
 *
 * It says "field provenance" in prose rather than naming the table, exactly as
 * the direct-write note two functions up does. That is not squeamishness about
 * a machine identifier: on THIS page the string `field_provenance` is what a
 * failed or unprovisioned leg prints (`LegNote`), and an operator who has
 * learned that the table name appears when something went wrong should not
 * meet it in a line about the ordinary case.
 */
function ProvenanceLegend() {
  return (
    <p data-note="provenance-absence" className="type-body text-ink-secondary">
      A{" "}
      {EM_DASH}
      {" "}in Provenance means no field provenance is recorded for that field:
      the value has no source behind it, rather than a source this page failed
      to read.
    </p>
  );
}

/**
 * What actually fills a record page the operator asked for by id and did not
 * get — campaign admin-window/BUG-0052.
 *
 * Regime-aware, because the app has two regimes and only one of them has a
 * listing. Browse is the recent-EVENTS view and the only curated view M1 ships
 * (spec F7), so it lists the resolver-owned side and structurally cannot list
 * the walk sandbox, which is reachable by its own address alone and by design
 * has no entry point anywhere. The old blanket sentence ("Browse lists the
 * records that exist") was therefore true for `events`/`venues` and false for
 * the other side, and it was false in the one moment the operator most needed
 * it to be true: the user-sim walk left the app for a SQL client here (Priya,
 * 2026-09-03).
 *
 * So the direct-write line says the true thing instead — that such a record is
 * reached by its id alone, and where an id comes from when the app cannot hand
 * one over. Neither line names a surface that cannot lead anywhere: the
 * address bar is always there, the database is where these rows live, and
 * Browse really does list events (and links each event's record on to its
 * venue, which is how the second resolver-owned table is reached).
 *
 * It keys on the WRITE PATH and not on the table name, for the same reason
 * everything else on this page does (ARCHITECTURE.md §4 rule 4): the map
 * already answers how a table is written, and the answer is what decides
 * whether a listing can exist for it.
 */
function foundBy(config: TableEditConfig): string {
  return writePathFor(config.regime) === "direct"
    ? `Admin has no ${config.table} listing: such a record is reached by its ` +
        `id alone. Check the id in the address bar, or take one from the ` +
        `database.`
    : `Browse lists recent events, and an event's record links to its venue. ` +
        `Check the id in the address bar.`;
}

/**
 * What answers a URL whose id is not an id at all — campaign
 * admin-window/BUG-0065.
 *
 * The state before this one was the READ-FAILED line, over "Reload to try the
 * read again": Postgres refused the comparison (`22P02 invalid input syntax
 * for type uuid`), the data layer classified that correctly as an arbitrary
 * failure, and the surface then offered the operator the one action that can
 * never work — a reload re-sends the same malformed segment forever. Measured
 * on a production build against staging, 2026-09-03, on every table in the
 * map, and TWICE on the resolver-owned pair, once per read leg.
 *
 * It is the EMPTY state and not a fifth one, chosen among the four the Look
 * mandates (`isRecordId`, `lib/db/records.ts`, carries why the page can decide
 * this without reading):
 *
 *  - not the failed read: nothing failed. No query was issued, and the
 *    database is not implicated in a segment that was never sent to it;
 *  - not not-provisioned: the table is there;
 *  - empty is the one state that makes no claim about what a read did — "the
 *    surface holds nothing, and here is the one thing that fills it" — and a
 *    segment that is not a uuid can equal no uuid primary key, so "no record
 *    at this address" is true here with certainty rather than on a read's say-so.
 *    The Look already runs several emptinesses through this one state and
 *    separates them by their WORDS ("an empty bucket, a table with no rows,
 *    and an unprovisioned table are three different states and never share a
 *    rendering"), which is what these words do: they never say the table
 *    answered and held no such row, because the unknown-ID state next door
 *    means exactly that and this one must not be mistaken for it.
 *
 * The recovery half is `foundBy` — the same sentence the unknown-id state
 * gives this regime, from the one place that answers "where does an id come
 * from", so the two states cannot drift apart on the only advice they share
 * (admin-window/BUG-0052). What stands in front of it is this state's own
 * business: what is wrong with the address, and what a correct one looks like,
 * so an operator whose paste dropped a character or carried a trailing space
 * can see it. The id itself is NOT quoted back into this sentence — it is
 * already above the section, verbatim in mono, and a trailing space quoted
 * mid-sentence is invisible exactly where it matters.
 */
function notAnId(config: TableEditConfig): string {
  return (
    `The address bar does not hold an id: ${config.table} ids are uuids, 32 ` +
    `hexadecimal digits usually written in five hyphenated groups. ` +
    foundBy(config)
  );
}

/**
 * Everything on this route that does not depend on the reads: the title, the
 * id the operator asked for, and the section with its regime note. Factored
 * out when the malformed-id answer arrived (admin-window/BUG-0065) so the two
 * exits of `RecordPage` cannot drift into two different pages — the operator
 * who mistyped an id must find the same frame, with the same things in the
 * same places, as the one who did not (LOOK_AND_FEEL, Repeat use: "nothing
 * moves between visits").
 *
 * A pure sync component over plain props, like every other child on this route
 * (ARCHITECTURE.md §5).
 */
function RecordFrame({
  config,
  id,
  children,
}: {
  config: TableEditConfig;
  /** The id segment as the URL carried it, whether or not it is an id. */
  id: string;
  children: ReactNode;
}) {
  // The table name is a machine identifier, so it is handed to `Page` as one —
  // `{identifier, words}`, never `` `${config.table} record` ``. The primitive
  // keeps it out of the uppercasing `type-title` element and renders it
  // verbatim in mono, the way this page's own row id below and `/queues`'s
  // `data_conflict` already read (admin-window/BUG-0073).
  return (
    <Page title={{ identifier: config.table, words: "record" }}>
      {/* The record's identity, rendered whatever the read did: an operator
          looking at a failed read still needs to know which row they asked
          for. Mono, because it is a value the database produced. */}
      <p className="type-data text-ink-secondary">{id}</p>
      {/* The one surface on this route, named so a live oracle can address it
          by NAME rather than by position (ARCHITECTURE §10: "every surface a
          live test grades carries `data-surface`, unique on the page"). Every
          state card this page can draw — the not-provisioned card, either
          emptiness, a leg's error line — renders inside it, so the name
          addresses the whole read (admin-window/TASK-0052). */}
      <Section title="Fields" surface="fields">
        {/* The regime note, addressed by name like this page's other two
            (ARCHITECTURE §10). The table's name opens it and is the machine's
            word, so it is set in the app's identifier-in-prose spelling —
            mono at the data step, verbatim, case and underscore intact — while
            everything the app wrote about it stays body sans in secondary ink.
            Three names of the same kind stand on this screen (this one, the
            heading's and the not-provisioned card's) and they now read alike
            (LOOK_AND_FEEL Voice bar 5; admin-window/BUG-0112). */}
        <p data-note="regime" className="type-body text-ink-secondary">
          <span className="type-data text-ink">{config.table}</span>{" "}
          {regimeNote(config)}
        </p>
        {children}
      </Section>
    </Page>
  );
}

export default async function RecordPage({
  params,
}: {
  /** Next 16 hands dynamic segments over as a promise. */
  params: Promise<{ table: string; id: string }>;
}) {
  const { table, id } = await params;

  const config = editConfigFor(table);
  // Not a table the edit surface knows about: there is no record page here,
  // and saying so with a 404 is the same answer the write route gives. In
  // practice `next.config.ts` has already turned this URL into one no route
  // matches (admin-window/BUG-0017), so this is the backstop, not the usual
  // path — see the header comment.
  if (config === null) notFound();

  // The segment is not an id at all, which is a question about the REQUEST and
  // is settled here, BEFORE any read (`isRecordId` carries why, and why this
  // is the empty state; `notAnId` carries what it says). Answering it first is
  // what keeps one bad address to ONE answer on a resolver-owned table, where
  // each of the three legs below would otherwise report the same refusal
  // separately — and it means no query is issued for a value no row can carry
  // (admin-window/BUG-0065).
  if (!isRecordId(id)) {
    return (
      <RecordFrame config={config} id={id}>
        <Empty
          holds={`${config.table} record at this address`}
          filledBy={notAnId(config)}
        />
      </RecordFrame>
    );
  }

  // Two reads, reported separately: the record's values, then the per-field
  // provenance behind them. A table Admin writes directly issues no provenance
  // query at all (`readRecordProvenance`), which is why the walk sandbox still
  // makes exactly one read.
  const result = await readRecord(config, id);
  const provenance = await readRecordProvenance(config, id);
  // The third leg, and the narrowest: the NAME of the record this one's
  // reference column points at (admin-window/BUG-0034). It reads nothing at
  // all unless the map calls a column a reference and the row carries an id
  // for it, and a failure of it costs the name, never the link and never a
  // value.
  const record = result.kind === "ok" ? result.data : null;
  const reference = await readRecordReference(config, id, record);

  // The FOURTH leg, and the narrowest of all: may this table's write path be
  // offered at all? Asked of the one seam, never of a copy (common violation
  // 9), and only where the answer can change anything — an override-path table
  // that really has a record on screen. The direct path needs no asking: its
  // table answered the read above, and a refusal of the write itself is the
  // database's to make.
  const settlement =
    record !== null && writePathFor(config.regime) === "override"
      ? await readSettlementReadiness()
      : null;
  const access: WriteAccess =
    writePathFor(config.regime) === "direct" || settlement?.kind === "ok"
      ? "open"
      : "closed";

  // The FIFTH leg, and the narrowest of all after the readiness question: the
  // rows this record's reference field may be pointed at (admin-window/TASK-0055).
  // It is read only where a picker could be drawn — an open write path on a
  // table whose map entry carries a reference — so the graded normal case, an
  // absent settlement function, makes no venue read at all and shows no card
  // for one. A refused read costs the PICKER and nothing else: every value,
  // the reference's own link and the provenance beside it all stay.
  const choices =
    access === "open" && config.reference !== null
      ? await readReferenceChoices(config)
      : null;

  let body;
  if (result.kind !== "ok") {
    // A leg that could not fill what it was for stands ABOVE the field table
    // rather than inside a cell: the card and the line answer for the whole
    // read, not for one field, and a card drawn inside the table's own border
    // would draw two borders (`DataTable`'s contract). The cells themselves
    // stay the app's absence, so a failed leg reads as "no provenance shown,
    // and here is why" instead of as a per-field lie (admin-window/BUG-0034).
    body = <StateOf result={result} />;
  } else if (result.data === null) {
    // The table answered and holds no such row — a different state from the
    // table being absent, and the two never share a rendering.
    body = (
      <Empty
        holds={`${config.table} record with that id`}
        filledBy={foundBy(config)}
      />
    );
  } else {
    body = (
      <RecordFields
        table={config.table}
        id={id}
        fields={recordFields(
          config,
          result.data,
          provenance.fields,
          reference.name,
          access,
        )}
        choices={choices?.window ?? null}
      />
    );
  }

  // The legend under the regime note explains the column the table draws, so
  // it stands only when there IS such a table and the provenance leg answered
  // for it — see `ProvenanceLegend`.
  const provenanceLegend =
    config.regime === "resolver_owned" && provenance.note === null && record !== null;

  return (
    <RecordFrame config={config} id={id}>
      {settlement !== null && settlement.kind !== "ok" ? (
        <>
          <p
            data-note="override-unavailable"
            className="type-body text-ink-secondary"
          >
            {OVERRIDE_UNAVAILABLE}
          </p>
          <StateOf result={settlement} />
        </>
      ) : null}
      {provenanceLegend ? <ProvenanceLegend /> : null}
      {provenance.note ? <StateOf result={provenance.note} /> : null}
      {reference.note ? <StateOf result={reference.note} /> : null}
      {choices?.note ? <StateOf result={choices.note} /> : null}
      {body}
    </RecordFrame>
  );
}
