import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { recordFields, type WriteAccess } from "@/components/records/fields";
import { RecordFields } from "@/components/records/record-fields";
import { Empty, Identifier, Page, Section, StateOf } from "@/components/ui";
import {
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
import { isRecordId } from "@/lib/records/id";

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
 *
 * Since admin-window/BUG-0205 it is also the FIRST thing said about editing on
 * a record whose path is closed: the regime note above it stops after its
 * ownership sentence while `overrideClosed` holds, so what a reader meets in
 * order is the closed path and then its reason, never a control described in
 * the present tense ahead of the line withdrawing it. The string itself is
 * unchanged by that ticket — what moved is what stands before it.
 */
const OVERRIDE_UNAVAILABLE =
  "No field here can be edited: an edit is recorded through the resolution " +
  "pipeline, and what records it is not present in this database. Every " +
  "value below is read-only until it is.";

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
function foundBy(config: TableEditConfig): ReactNode {
  return writePathFor(config.regime) === "direct" ? (
    <>
      {`Admin has no `}
      <Identifier>{config.table}</Identifier>
      {` listing: such a record is reached by its ` +
        `id alone. Check the id in the address bar, or take one from the ` +
        `database.`}
    </>
  ) : (
    `Browse lists recent events, and an event's record links to its venue. ` +
    `Check the id in the address bar.`
  );
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
 * mandates (`isRecordId`, `lib/records/id.ts`, carries why the page can decide
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
function notAnId(config: TableEditConfig): ReactNode {
  return (
    <>
      {`The address bar does not hold an id: `}
      <Identifier>{config.table}</Identifier>
      {` ids are uuids, 32 ` +
        `hexadecimal digits usually written in five hyphenated groups. `}
      {foundBy(config)}
    </>
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
      <Identifier muted>{id}</Identifier>
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
            Every name of that kind on this screen — this one, the heading's,
            the not-provisioned card's and, since admin-window/BUG-0120, both
            empty cards' — now reads alike, from the shared `Identifier`
            primitive (LOOK_AND_FEEL Voice bar 5; admin-window/BUG-0112,
            admin-window/DEBT-0011). */}
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
      // Nothing was asked of the database for this address, so nothing here
      // knows whether the override path is open (admin-window/BUG-0205): the
      // regime note stays whole, and no line on this state describes a control
      // for a record that is not on screen at all.
      <RecordFrame config={config} id={id}>
        <Empty
          holds={
            <>
              <Identifier>{config.table}</Identifier>
              {` record at this address`}
            </>
          }
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
        holds={
          <>
            <Identifier>{config.table}</Identifier>
            {` record with that id`}
          </>
        }
        filledBy={foundBy(config)}
      />
    );
  } else {
    // Shaped once, drawn twice: the table renders these lines and the sentence
    // above it counts them, so no figure on this screen can be a second
    // reading of the map (admin-window/BUG-0126).
    const fields = recordFields(
      config,
      result.data,
      provenance.fields,
      reference.name,
      access,
    );
    body = (
      <>
        <RecordFields
          table={config.table}
          id={id}
          fields={fields}
          choices={choices?.window ?? null}
        />
      </>
    );
  }


  // Derived ONCE and read twice: the paragraph below names the closure, and the
  // regime note above it stops before describing an override while it holds —
  // so the two lines cannot disagree about the same answer from the same read
  // (admin-window/BUG-0205, LESSONS 11).
  const overrideClosed = settlement !== null && settlement.kind !== "ok";

  return (
    <RecordFrame config={config} id={id}>
      {overrideClosed ? (
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
      {provenance.note ? <StateOf result={provenance.note} /> : null}
      {reference.note ? <StateOf result={reference.note} /> : null}
      {choices?.note ? <StateOf result={choices.note} /> : null}
      {body}
    </RecordFrame>
  );
}
