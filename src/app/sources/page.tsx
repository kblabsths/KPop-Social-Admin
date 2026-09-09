import {
  AWAITING_LABEL,
  AWAITING_SURFACE,
  AwaitingRowTrendSection,
  NOTHING_MATCHED,
  NOTHING_REGISTERED,
  REGISTRY_SURFACE,
  REJECTION_LABEL,
  REJECTION_SURFACE,
  RejectionSection,
  SourceChips,
  sourceColumns,
} from "@/components/sources";
import { DataTable, Empty, Page, Section, StateOf } from "@/components/ui";
import { canonicalRecordId } from "@/lib/records/id";
import {
  listSources,
  selectSources,
  type SourceState,
  type SourcesFilter,
} from "@/lib/db/sources";
import { readAwaitingRowTrend } from "@/lib/gauges/pending-claims";
import { readRejectionStampGauge } from "@/lib/gauges/settled-values";
import { SOURCE_FACET } from "@/lib/sources/routes";
import { isSurfaceNarrowed } from "@/lib/url/narrowing";

/**
 * Sources — **the registry's state rows, and who keeps being wrong** (campaign
 * admin-window/TASK-0013).
 *
 * Authority: spec §4 ("the sources state rows: lifecycle, current tier,
 * checkpoint, last run, per-source gauge trends"), §5 (the pending-claims
 * per-source `awaiting_row` trend and the settled-values gauge),
 * `contracts/data-model.md` (source registry — config + state), LOOK_AND_FEEL
 * ("Sources … is the data-table rule applied; it carries no bespoke layout",
 * quality bars 1, 4, 10, 11).
 *
 * Three rules this page is built on, each of which it would be easy to break:
 *
 *  - **Config is not state.** The description, the domains fed, the usage, the
 *    dials and the legal status are scraper YAML, and this campaign reads no
 *    scraper file at runtime (spec §10). What renders below is the `sources`
 *    TABLE and nothing else — no invented config column, and no registry value
 *    hand-copied into this repo.
 *  - **Last run is matched by NAME.** `sources` has no last-run column and
 *    `runs.source` has no foreign key (ARCHITECTURE.md §6 trap 6, migration
 *    `20260829000001`). `src/lib/db/sources.ts` is the one place that match
 *    happens; a source with no run renders the dash, which means "has never
 *    run" and never "we could not read it".
 *  - **Tier is a badge, not a colour.** Only severity and health carry colour,
 *    so a page of sources is not a rainbow (LOOK_AND_FEEL, Chips and badges).
 *
 * This page function is the ONLY async component on the route
 * (ARCHITECTURE.md §5): it reads, it shapes, every child is a pure sync
 * component with plain props — which is what lets the offline suite render
 * `renderToStaticMarkup(await SourcesPage(props))` with no jsdom and no
 * database, and the live suite compare its rows with rows the test reads
 * itself.
 *
 * **Those children live in `src/components/sources/`** (campaign
 * admin-window/DEBT-0004, ARCHITECTURE.md §13.6), beside every other page's,
 * and the three URLs this page builds live below both of them in the pure leaf
 * `lib/sources/routes.ts` — the page reads the facet off `searchParams` with
 * the same constant the chip row writes into a link, so neither owns it.
 *
 * **Nothing settles anything in M1**: every control in this markup is a link.
 */

/**
 * Three reads happen per request against the live database, so the route
 * renders per request rather than being prerendered at build time
 * (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
 * "Route segment config"). Reading `searchParams` already opts this page in,
 * but the prop is optional — the shell's route test renders every page with no
 * props at all — and a page prerendered at build, where the app has no
 * credential, would ship a FROZEN error state that never re-reads.
 */
export const dynamic = "force-dynamic";

/* ── the URL, which is the whole of this page's state ────────────────────── */

/** A `searchParams` value, in every shape Next can hand one over. */
type ParamValue = string | string[] | undefined;

/** The `searchParams` object a page awaits. */
type SearchParams = Record<string, ParamValue>;

/**
 * The FIRST value the URL carries for a key. `?source_id=a&source_id=b` is
 * ambiguous state and the web platform already answers it —
 * `URLSearchParams.get()` returns the first — so a hand-edited URL lands on a
 * real, bookmarkable state rather than an error page.
 */
function firstValue(value: ParamValue): string | undefined {
  if (Array.isArray(value)) return value.length === 0 ? undefined : value[0];
  return value;
}

/**
 * The narrowing the URL asked for — **from the URL alone** (campaign
 * admin-window/BUG-0139).
 *
 * It takes no read's rows, which is what lets the three reads below be issued
 * TOGETHER: the awaiting-row gauge narrows at the query (`observations.source_id`
 * is a real column on the side it scans), so a narrowing that waited for the
 * registry's rows would put the sequential round trip straight back.
 *
 * The one thing it asks of a value is that it be a uuid AT ALL, and that is a
 * question about the REQUEST rather than about the registry: `source_id` is a
 * uuid column, so a value that is not one can equal no row anywhere and
 * Postgres refuses the comparison before a row is considered (`22P02 invalid
 * input syntax for type uuid`), which every surface then renders as "the read
 * failed, reload" — advice that can never work, because reloading re-sends the
 * same malformed URL. That is admin-window/BUG-0065's ruling on `/records`,
 * and `canonicalRecordId` answers it with `isRecordId`'s one grammar; a second
 * uuid pattern here would be a second answer to one question. So a hand-typed
 * `?source_id=nobody` narrows NOTHING and the page renders the whole registry,
 * exactly as it always has.
 *
 * It asks for the value CANONICALISED, in one call, because the narrowing it
 * returns is then compared two ways: by Postgres, which matches every spelling
 * of one uuid, at the awaiting-row gauge's query — and by JavaScript, which
 * matches exactly one, in `selectSources` and `selectClaims`. Handed the URL's
 * raw value both comparisons disagree, and a source the database matched was
 * denied by the page (admin-window/BUG-0140). Canonicalised HERE, where the
 * narrowing is made and nowhere else, every spelling `isRecordId` accepts —
 * uppercased, hyphen-less, mixed — selects the row PostgREST would, and the
 * chips and row links spell the narrowing back as that one id.
 *
 * A well-formed id the registry turns out not to hold DOES narrow, in every
 * spelling: the page renders `data-empty="narrowing"` — "nothing matched",
 * told apart from the registry that holds nothing — and the gauges answer the
 * same narrowing the table renders, which is the property a figure on this
 * page rests on. That is fact 1 and it is not the whole answer: over a
 * registry holding NO rows the same id removed nothing, and the arm the page
 * renders is decided from the population too (`isSurfaceNarrowed` below,
 * admin-window/DEBT-0008).
 */
function filterFrom(params: SearchParams): SourcesFilter {
  const asked = firstValue(params[SOURCE_FACET]);
  const narrowing = asked === undefined ? null : canonicalRecordId(asked);
  return narrowing === null ? {} : { source_id: narrowing };
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default async function SourcesPage({
  searchParams,
}: {
  /**
   * Next 16 hands `searchParams` over as a promise
   * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
   * Optional, so the page also renders standing alone with no props, the way
   * the shell's route test calls every page.
   */
  searchParams?: Promise<SearchParams>;
} = {}) {
  const params = (await searchParams) ?? {};

  // The narrowing comes from the URL alone, so it is known BEFORE anything is
  // read and no leg waits on another's rows.
  const filter = filterFrom(params);

  // Three independent reads, issued together (campaign admin-window/BUG-0139).
  // None of them needs anything from the other two, and they were awaited one
  // after the other: the registry, whole — every narrowing below is
  // `selectSources`' — and the two gauges, which are the other kind of read,
  // bounded ordered WINDOWS (§4.3 kind 2), each naming the window it shows.
  // The awaiting-row window narrows at the query, because
  // `observations.source_id` is a real column on the side it scans; the
  // rejection gauge takes no filter, so its narrowing happens over the rows it
  // returned. Each keeps its own `DbResult` and its own Section state, so no
  // leg's refusal removes another leg's rows (§4.1, common violations row 14).
  const [sources, trend, rejections] = await Promise.all([
    listSources(),
    readAwaitingRowTrend({ filter }),
    readRejectionStampGauge(),
  ]);

  const held = sources.kind === "ok" ? sources.data : [];
  const shown = selectSources(held, filter);

  const nameOf = (sourceId: string): string | null =>
    held.find((source) => source.source_id === sourceId)?.source ?? null;

  // Which emptiness this is, from TWO facts and not from the URL alone
  // (ARCHITECTURE.md §4.3, admin-window/DEBT-0008). Fact 1 is structural: a
  // `source_id` in the URL is always a real narrowing of this table, since no
  // registry row is implied by anything else on it. Fact 2 is the REGISTRY'S
  // OWN POPULATION — and it costs no query, because `listSources` is a
  // COMPLETE read (§4.3 kind 1) of the registry whole, deliberately unnarrowed
  // so `selectSources` can do every narrowing: its `ok` array IS the
  // population. A registry holding nothing had no row for any id to remove, so
  // an id in the URL may not be given as the reason the table is empty; the
  // read's own refusal is this page's state and is rendered by the `StateOf`
  // card above, so there is no separate leg here whose refusal could delete a
  // row (the shape `/queues` needs, where the population is its own count
  // read — admin-window/BUG-0135).
  const narrowed = isSurfaceNarrowed(filter.source_id !== undefined, {
    rendered: shown.length,
    population: held.length,
  });

  const emptyWords = narrowed ? NOTHING_MATCHED : NOTHING_REGISTERED;

  return (
    <Page title="Sources">
      {sources.kind === "ok" && held.length > 0 ? (
        <SourceChips sources={held} filter={filter} />
      ) : null}

      <Section title="Registry" surface={REGISTRY_SURFACE}>
        {sources.kind === "not_provisioned" ? (
          // A card replaces the surface; nothing above it describes a table
          // that is not there (LOOK_AND_FEEL state 3).
          <StateOf result={sources} />
        ) : sources.kind === "ok" && shown.length === 0 ? (
          // Two different emptinesses, two different renderings: the registry
          // that holds nothing, and the narrowing that matched nothing. The
          // hook says WHICH, so neither can be mistaken for the other or for
          // an absent table.
          <div data-empty={narrowed ? "narrowing" : "registry"}>
            <Empty holds={emptyWords.holds} filledBy={emptyWords.filledBy} />
          </div>
        ) : (
          <>
            <DataTable<SourceState>
              label="Sources"
              columns={sourceColumns(filter)}
              rows={sources.kind === "ok" ? shown : []}
              rowKey={(row) => row.source_id}
              placeholder={
                sources.kind === "error" ? <StateOf result={sources} /> : undefined
              }
            />
            <p className="type-body text-ink-secondary">
              State, not configuration: what the registry holds about a source —
              its description, the domains it feeds, its dials and its legal
              status — lives in the scraper repo and is not read here. Tier is
              the source&rsquo;s current tier, which drifts. Last run is the
              newest run whose <span className="type-data text-ink">source</span>{" "}
              name matches this row; a source that has never run shows no run.
            </p>
          </>
        )}
      </Section>

      <Section title="Awaiting-row trend" surface={AWAITING_SURFACE}>
        {trend.kind === "ok" ? (
          <AwaitingRowTrendSection trend={trend.data} filter={filter} nameOf={nameOf} />
        ) : (
          <StateOf result={trend} eyebrow={AWAITING_LABEL} />
        )}
      </Section>

      <Section title="Settled values" surface={REJECTION_SURFACE}>
        {rejections.kind === "ok" ? (
          <RejectionSection gauge={rejections.data} filter={filter} />
        ) : (
          <StateOf result={rejections} eyebrow={REJECTION_LABEL} />
        )}
      </Section>
    </Page>
  );
}
