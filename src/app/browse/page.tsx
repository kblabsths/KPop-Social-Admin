import type { ReactNode } from "react";
import { BrowseTable } from "@/components/browse/browse-table";
import { ColumnSelector } from "@/components/browse/column-selector";
import { PagedBrowseTable } from "@/components/browse/paged-browse-table";
import {
  Empty,
  Page,
  Section,
  StateOf,
  WindowLine,
  drawnWindow,
  oldestIn,
} from "@/components/ui";
// COMPONENTS out of the "use client" paging module, imported straight from it
// rather than through the server barrel: a re-export hands the binding to every
// server module importing the barrel, and only a component may cross that
// boundary at all (admin-window/BUG-0094, admin-window/BUG-0172,
// tests/offline/shell/client-boundary.test.ts).
import { PagedWindowLine, PagingProvider } from "@/components/ui/paging";
import type { BrowseRow } from "@/lib/browse/rows";
import { EVENTS_OBJECT, readRecentEvents, type DbUnavailable } from "@/lib/db/browse";
import { PAGE_ROUTES, pageBound } from "@/lib/paging/bounds";
import { initialPage } from "@/lib/paging/machine";
import {
  COLUMNS_PARAM,
  RECENT_EVENTS,
  browseQuery,
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
 *
 * **In the PAGED arm the wrapper renders this div, not this file**
 * (admin-window/TASK-0069): it must wrap the table ALONE, with the paged legs'
 * notes as siblings after it, or a refused provenance leg would be graded by
 * the live oracle as an unreadable events window. Exactly one element carries
 * the name in every state, which is what the pin above grades.
 */
const EVENTS_SURFACE = "events";

/**
 * The name the events WINDOW answers to — `data-window`, the hook
 * `tests/offline/absence/pages.test.ts` grades the window rule by.
 *
 * This page stated a window in prose and published no hook at all, and it
 * stated it whatever the read did — over an absent `events` table too, which
 * is the defect class admin-window/BUG-0063, BUG-0067 and BUG-0070 were each
 * filed out of. The shared `WindowLine` carries the hooks; the `ok` guard
 * below carries the rule (admin-window/DEBT-0006).
 */
const EVENTS_WINDOW = "events";

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
    body = <StateOf result={events} />;
  } else if (events.kind === "error") {
    // A state LINE inside the table, so the header stays put and the operator
    // can still see which columns they asked for.
    body = (
      <BrowseTable
        view={view}
        shown={shown}
        rows={[]}
        placeholder={<StateOf result={events} />}
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

  // WHETHER THE OPERATOR IS OFFERED MORE — the page's decision, and the whole
  // of it (admin-window/TASK-0069, SPEC F14).
  //
  // Browse's events read is a WINDOW read with NO COUNT BESIDE IT: it returns
  // rows and nothing else. So there is no total to compare against, and the
  // honest signal that there is more is that the window came back FULL — asked
  // of the one function that answers that question, of the `held` this page is
  // about to hand down, rather than re-derived beside it. `pageBound` is `ok`
  // exactly when that `held` is a bound this surface can page from, so:
  //
  //  - a SHORT window is never pageable, and no state is ever constructed off
  //    the bound grid (`initialPage(37, true)` is a state whose every press
  //    `pageBound` refuses for ever — QA, admin-window/BUG-0168). The window
  //    line above already states that case in its own numbers: "The window did
  //    not fill — 12 of at most 50 — so it holds all the events the read
  //    found";
  //  - an EMPTY window is refused by the same call (a bound below the window
  //    is not a bound), so the `Empty` card stands exactly as it did;
  //  - `not_provisioned` and `error` render exactly what they render today.
  //
  // In every one of those arms no paging element exists in the markup at all —
  // a control that cannot be honoured is never offered (SPEC F10).
  const pageable =
    events.kind === "ok" &&
    pageBound(String(events.data.length), view.window).kind === "ok";
  // The rows the wrapper is handed, or `null` where this page draws the body
  // itself — which is every other state, exactly as it drew it before.
  const drawn = events.kind === "ok" && pageable ? events.data : null;

  // THE OBJECTS THIS PAGE HAS ALREADY REPORTED, above the table — its own two
  // legs, in the database's own spelling. A leg named once is not named again
  // below the rows: the same object twice tells the operator nothing and
  // doubles a red line. The identity is the OBJECT and not the leg key,
  // because the object is what both sides read from the same database.
  const reported = [listing.venues, listing.provenance].flatMap(
    (leg: DbUnavailable | null) =>
      leg === null ? [] : [leg.kind === "not_provisioned" ? leg.missing : leg.reading],
  );

  // THE FIRST SCREEN'S WINDOW, COMPOSED ONCE (admin-window/BUG-0172). One
  // object reaches whichever component renders the line: a second spelling of
  // these facts beside the first is how the two come to disagree, which is the
  // class this ticket closed one layer up.
  //
  // `drawnWindow` decides whether the read filled its cap, in the one place
  // the app decides that — this page used to spell the comparison itself, and
  // the arm below then said the same thing whether it filled or not
  // (admin-window/BUG-0109). The rows are in ARRIVAL order, newest first, so
  // the last one carries the oldest arrival the catalog holds when the window
  // did not fill.
  const eventsWindow =
    events.kind === "ok"
      ? drawnWindow({
          limit: view.window,
          held: events.data.length,
          // WHOSE NUMBER `held` IS, stated rather than left to be guessed from
          // its size (admin-window/BUG-0174): this surface's `held` is the rows
          // ITS OWN reads came back with — there is no count beside them — so a
          // press that appends rows grows it, and the line says so.
          heldFrom: "this window",
          over: EVENTS_OBJECT,
          oldest: oldestIn(events.data, (row) => row.created_at),
          // Unnarrowed: `?columns=` chooses which COLUMNS render and never
          // which rows are read, so this window's floor is the catalog's own
          // (admin-window/BUG-0114).
          scope: null,
        })
      : null;
  const shows = { of: "catalog", rows: "events" } as const;

  // The Section's children, in the order this page has always rendered them.
  // On the paged arm they are handed to `PagingProvider` — which emits no
  // markup of its own — so the line, the selector and the leg notes stay
  // exactly where they are, and every one of them stays a SERVER component:
  // a server parent may hand server-rendered JSX to a client component as
  // children (admin-window/BUG-0172).
  const sectionBody = (
    <>
      {eventsWindow === null ? null : drawn === null ? (
        <WindowLine gauge={EVENTS_WINDOW} window={eventsWindow} shows={shows} />
      ) : (
        // The same element in the same place, rendered inside client-land so
        // that every fact in it is a fact of the read the operator NOW holds:
        // a press is a read on this surface, and a server-rendered constant
        // above rows a press changes is the contradiction QA measured.
        <PagedWindowLine gauge={EVENTS_WINDOW} window={eventsWindow} shows={shows} />
      )}
      <ColumnSelector
        label="Columns"
        options={columnOptions(view, shown)}
        hrefFor={hrefFor}
      />
      {listing.venues ? <StateOf result={listing.venues} /> : null}
      {listing.provenance ? <StateOf result={listing.provenance} /> : null}
      {drawn === null ? (
        <div data-surface={EVENTS_SURFACE}>{body}</div>
      ) : (
        // The same rows, the same markup, the same order — plus whatever a
        // press appends beneath them. The wrapper owns the surface div (it
        // wraps the TABLE alone, so a paged leg note is never graded as the
        // events read), and it takes the rows, the press and the window from
        // the provider above rather than deriving any of them
        // (admin-window/BUG-0168, admin-window/BUG-0172).
        <PagedBrowseTable
          surface={EVENTS_SURFACE}
          view={view}
          shown={shown}
          initial={drawn}
          reported={reported}
        />
      )}
    </>
  );

  return (
    <Page title="Browse">
      <Section title={view.title}>
        {drawn === null ? (
          sectionBody
        ) : (
          // The window this surface pages by is spelled ONCE, here, and handed
          // to the driver that grades every page against it.
          <PagingProvider
            initial={initialPage<BrowseRow>(drawn.length, pageable)}
            deps={{
              route: PAGE_ROUTES.browse,
              params: browseQuery(view, shown),
              size: view.window,
            }}
          >
            {sectionBody}
          </PagingProvider>
        )}
      </Section>
    </Page>
  );
}
