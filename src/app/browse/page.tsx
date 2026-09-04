import type { ReactNode } from "react";
import { BrowseTable } from "@/components/browse/browse-table";
import { ColumnSelector } from "@/components/browse/column-selector";
import { Empty, ErrorLine, NotProvisioned, Page, Section } from "@/components/ui";
import { readRecentEvents, type DbUnavailable } from "@/lib/db/browse";
import {
  COLUMNS_PARAM,
  RECENT_EVENTS,
  columnOptions,
  columnsHref,
  shownColumns,
  type BrowseColumnKey,
} from "@/lib/browse/views";

/**
 * Browse — the curated recent-events view (campaign admin-window/TASK-0015).
 *
 * Spec §4: curated data views, each defined in code with its query, the
 * columns it may show and its default sort, plus a runtime column selector
 * over the configured set. v1 ships exactly one view — recent events,
 * everything that came through the pipeline **newest first by arrival**
 * (`events.created_at desc`, ARCHITECTURE.md §11) — with the
 * spot-verification columns and the sources behind each row from the
 * `field_provenance` join.
 *
 * There is no whole-table browser here, no free-SQL runner and no second view;
 * the recurring query lives in `src/lib/browse/views.ts` where it is reviewed
 * once (spec §4 rationale).
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, and every child below it is a
 * pure sync component taking plain props. That is what lets the offline suite
 * render it with `renderToStaticMarkup(await BrowsePage(props))` and assert
 * real markup with no jsdom and no database.
 *
 * All four data-surface states render from the `ui` primitives, and the three
 * reads are reported separately: with `field_provenance` absent the event rows
 * still render and the page says which table is missing. Nothing throws.
 *
 * A FAILED read names its object the same way an absent one does — the
 * `DbResult` error arm carries `reading` — so the four legs are distinguishable
 * on screen instead of collapsing into one anonymous red line
 * (admin-window/BUG-0016).
 */

/** This route's own path — the base every selector link is built on. */
const BROWSE_PATH = "/browse";

/** What creates the ecosystem objects this page reads. */
const ARRIVES_WITH = "the scraper repo's migrations";

/**
 * The name the events BODY answers to — `data-surface`, read by the live
 * parity oracle (`tests/live/browse.live.test.ts`) and pinned offline by
 * `tests/offline/browse/page.test.ts`.
 *
 * A NAME, never a position. That oracle addressed this surface as
 * `section:nth-of-type(1) > :last-child` until admin-window/DEBT-0002, which
 * compounded two fragilities: the page's section ORDER, and the body's
 * position among its section's own children. Either an added section or one
 * more leg note above the table repoints it, and `stateOf` refuses any
 * selector that does not match exactly one element — the failure that cost
 * `/cycles` four live tests (admin-window/BUG-0040, admin-window/BUG-0056).
 *
 * It is the BODY that carries the name and not the `<Section>` around it,
 * because the section also holds the column selector and the two leg notes
 * (venues, provenance): those are separate reads with separate states, and
 * grading them as one surface makes an unreadable venue join look like
 * unreadable events. The `<Section>` therefore takes no `surface` of its own —
 * one page, one element answering to a name, the same rule that leaves
 * `/cycles`'s runs `<Section>` unnamed beside its hand-written wrapper.
 */
const EVENTS_SURFACE = "events";

/** A leg that could not fill its column, rendered as its own honest state. */
function LegNote({ note }: { note: DbUnavailable }) {
  return note.kind === "not_provisioned" ? (
    <NotProvisioned missing={note.missing} arrivesWith={ARRIVES_WITH} />
  ) : (
    <ErrorLine
      reading={note.reading}
      failed={note.message}
      retry="Reload to try the read again."
    />
  );
}

export default async function BrowsePage({
  searchParams,
}: {
  /**
   * Next 16 hands `searchParams` over as a promise and reading it opts the
   * route into dynamic rendering — which this page needs anyway, since it
   * reads the database on every request
   * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
   * It is optional so the page also renders standing alone, with no props, the
   * way the shell's route test calls every page.
   */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const params = (await searchParams) ?? {};
  const view = RECENT_EVENTS;
  const shown = shownColumns(view, params[COLUMNS_PARAM]);
  const hrefFor = (keys: readonly BrowseColumnKey[]) =>
    columnsHref(view, BROWSE_PATH, keys);

  const listing = await readRecentEvents(view);
  const events = listing.events;

  let body: ReactNode;
  if (events.kind === "not_provisioned") {
    body = <NotProvisioned missing={events.missing} arrivesWith={ARRIVES_WITH} />;
  } else if (events.kind === "error") {
    // A state LINE inside the table, so the header stays put and the operator
    // can still see which columns they asked for.
    body = (
      <BrowseTable
        view={view}
        shown={shown}
        rows={[]}
        placeholder={
          <ErrorLine
            reading={events.reading}
            failed={events.message}
            retry="Reload to try the read again."
          />
        }
      />
    );
  } else if (events.data.length === 0) {
    body = (
      <Empty
        holds="events in this window"
        filledBy="An adapter writes an event, and the resolver applies the fields it carries."
      />
    );
  } else {
    body = <BrowseTable view={view} shown={shown} rows={events.data} />;
  }

  return (
    <Page title="Browse">
      <Section title={view.title}>
        <p className="type-body text-ink-secondary">
          The {view.window} newest events by arrival, newest first — a window,
          not the whole catalog.
        </p>
        <ColumnSelector
          label="Columns"
          options={columnOptions(view, shown)}
          hrefFor={hrefFor}
        />
        {listing.venues ? <LegNote note={listing.venues} /> : null}
        {listing.provenance ? <LegNote note={listing.provenance} /> : null}
        <div data-surface={EVENTS_SURFACE}>{body}</div>
      </Section>
    </Page>
  );
}
