import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";
import { EditableCell } from "@/app/components/EditableCell";

export const dynamic = "force-dynamic";

const EVENT_TYPES = ["concert", "fanmeet", "festival", "online", "other"] as const;
const SCRAPED_SOURCES = ["bandsintown", "ticketmaster", "eventbrite"] as const;
const SCRAPED_STATUSES = ["pending", "matched", "created", "skipped", "error"] as const;
const PAGE_SIZES = [25, 50, 100] as const;

const CANONICAL_SORTS = ["title", "artist", "venue", "city", "date", "type"] as const;
type CanonicalSort = typeof CANONICAL_SORTS[number];

const SCRAPED_SORTS = ["source", "title", "artist", "venue", "city", "date", "status", "created_at"] as const;
type ScrapedSort = typeof SCRAPED_SORTS[number];

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16);
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    type?: string;
    when?: string;
    source?: string;
    status?: string;
    page?: string;
    spage?: string;
    sort?: string;
    dir?: string;
    ssort?: string;
    sdir?: string;
    limit?: string;
    slimit?: string;
  }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;

  const tab = params.tab === "raw" ? "raw" : "canonical";
  const now = new Date().toISOString();

  // ── Canonical events filters ────────────────────────────────────────────────
  const typeFilter = params.type && EVENT_TYPES.includes(params.type as typeof EVENT_TYPES[number])
    ? params.type
    : undefined;
  const whenFilter = params.when === "upcoming" || params.when === "past"
    ? params.when
    : undefined;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const limitParam = parseInt(params.limit || "25", 10);
  const pageSize = PAGE_SIZES.includes(limitParam as typeof PAGE_SIZES[number]) ? limitParam : 25;
  const sortCol: CanonicalSort = CANONICAL_SORTS.includes(params.sort as CanonicalSort) ? (params.sort as CanonicalSort) : "date";
  const sortDir = params.dir === "asc" ? true : false; // default desc for date

  // ── Scraped events filters ──────────────────────────────────────────────────
  const srcFilter = params.source && SCRAPED_SOURCES.includes(params.source as typeof SCRAPED_SOURCES[number])
    ? params.source
    : undefined;
  const stFilter = params.status && SCRAPED_STATUSES.includes(params.status as typeof SCRAPED_STATUSES[number])
    ? params.status
    : undefined;
  const spage = Math.max(1, parseInt(params.spage || "1", 10));
  const slimitParam = parseInt(params.slimit || "25", 10);
  const spageSize = PAGE_SIZES.includes(slimitParam as typeof PAGE_SIZES[number]) ? slimitParam : 25;
  const ssortCol: ScrapedSort = SCRAPED_SORTS.includes(params.ssort as ScrapedSort) ? (params.ssort as ScrapedSort) : "created_at";
  const ssortDir = params.sdir === "asc" ? true : false;

  // ── Stats queries ────────────────────────────────────────────────────────────
  const [
    totalEventsResult,
    upcomingEventsResult,
    pastEventsResult,
    totalScrapedResult,
    pendingScrapedResult,
    bitSourceResult,
    tmSourceResult,
    ebSourceResult,
  ] = await Promise.all([
    supabase.from("events").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }).gte("date", now),
    supabase.from("events").select("*", { count: "exact", head: true }).lt("date", now),
    supabase.from("scraped_events").select("*", { count: "exact", head: true }),
    supabase.from("scraped_events").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("scraped_events").select("*", { count: "exact", head: true }).eq("source", "bandsintown"),
    supabase.from("scraped_events").select("*", { count: "exact", head: true }).eq("source", "ticketmaster"),
    supabase.from("scraped_events").select("*", { count: "exact", head: true }).eq("source", "eventbrite"),
  ]);

  const totalEvents = totalEventsResult.count ?? 0;
  const upcomingEvents = upcomingEventsResult.count ?? 0;
  const pastEvents = pastEventsResult.count ?? 0;
  const totalScraped = totalScrapedResult.count ?? 0;
  const pendingScraped = pendingScrapedResult.count ?? 0;
  const bitCount = bitSourceResult.count ?? 0;
  const tmCount = tmSourceResult.count ?? 0;
  const ebCount = ebSourceResult.count ?? 0;

  // ── Canonical events table ───────────────────────────────────────────────────
  let eventsQuery = supabase
    .from("events")
    .select(
      "id, title, artist, venue, city, country, date, type, last_scraped_at, artist_id, venue_id",
      { count: "exact" }
    )
    .order(sortCol, { ascending: sortDir })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (typeFilter) eventsQuery = eventsQuery.eq("type", typeFilter);
  if (whenFilter === "upcoming") eventsQuery = eventsQuery.gte("date", now);
  if (whenFilter === "past") eventsQuery = eventsQuery.lt("date", now);

  const eventsResult = await eventsQuery;
  const events = eventsResult.data ?? [];
  const eventsTotal = eventsResult.count ?? 0;
  const eventsPages = Math.ceil(eventsTotal / pageSize);

  // ── Scraped events table ─────────────────────────────────────────────────────
  let scrapedQuery = supabase
    .from("scraped_events")
    .select(
      "id, source, source_event_id, title, artist, venue, city, country, date, status, matched_event_id, scraper_run_id, created_at",
      { count: "exact" }
    )
    .order(ssortCol, { ascending: ssortDir })
    .range((spage - 1) * spageSize, spage * spageSize - 1);

  if (srcFilter) scrapedQuery = scrapedQuery.eq("source", srcFilter);
  if (stFilter) scrapedQuery = scrapedQuery.eq("status", stFilter);

  const scrapedResult = await scrapedQuery;
  const scrapedEvents = scrapedResult.data ?? [];
  const scrapedTotal = scrapedResult.count ?? 0;
  const scrapedPages = Math.ceil(scrapedTotal / spageSize);

  // ── Build filter URL helpers ──────────────────────────────────────────────────
  function eventsUrl(overrides: Record<string, string | undefined>) {
    const p: Record<string, string | undefined> = {
      tab: "canonical",
      type: typeFilter,
      when: whenFilter,
      page: page > 1 ? String(page) : undefined,
      sort: sortCol !== "date" ? sortCol : undefined,
      dir: sortDir ? "asc" : undefined,
      limit: pageSize !== 25 ? String(pageSize) : undefined,
    };
    Object.assign(p, overrides);
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>
    );
    return `/events?${q}`;
  }

  function scrapedUrl(overrides: Record<string, string | undefined>) {
    const p: Record<string, string | undefined> = {
      tab: "raw",
      source: srcFilter,
      status: stFilter,
      spage: spage > 1 ? String(spage) : undefined,
      ssort: ssortCol !== "created_at" ? ssortCol : undefined,
      sdir: ssortDir ? "asc" : undefined,
      slimit: spageSize !== 25 ? String(spageSize) : undefined,
    };
    Object.assign(p, overrides);
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>
    );
    return `/events?${q}`;
  }

  function canonicalSortHref(col: CanonicalSort) {
    const isCurrent = sortCol === col;
    // default is desc; toggle: if current & desc → asc, else desc
    const newDir = isCurrent && !sortDir ? "asc" : undefined;
    return eventsUrl({ sort: col, dir: newDir, page: "1" });
  }

  function scrapedSortHref(col: ScrapedSort) {
    const isCurrent = ssortCol === col;
    const newDir = isCurrent && !ssortDir ? "asc" : undefined;
    return scrapedUrl({ ssort: col, sdir: newDir, spage: "1" });
  }

  function canonicalSortIndicator(col: CanonicalSort) {
    if (sortCol !== col) return <span className="text-gray-300 dark:text-gray-700 ml-0.5">↕</span>;
    return <span className="ml-0.5 text-purple-500">{sortDir ? "↑" : "↓"}</span>;
  }

  function scrapedSortIndicator(col: ScrapedSort) {
    if (ssortCol !== col) return <span className="text-gray-300 dark:text-gray-700 ml-0.5">↕</span>;
    return <span className="ml-0.5 text-purple-500">{ssortDir ? "↑" : "↓"}</span>;
  }

  const statusBadge: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    matched: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    created: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    skipped: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  const thClass = "px-2 py-1.5 font-medium text-left whitespace-nowrap";
  const sortLinkClass = "hover:text-gray-200 inline-flex items-center";

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Events
      </h1>

      {/* Stats panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-1.5">
        <StatCard label="Total Events" value={totalEvents.toLocaleString()} />
        <StatCard
          label="Upcoming"
          value={upcomingEvents.toLocaleString()}
          color="text-green-600 dark:text-green-400"
        />
        <StatCard
          label="Past"
          value={pastEvents.toLocaleString()}
          color="text-gray-500 dark:text-gray-400"
        />
        <StatCard label="Scraped Total" value={totalScraped.toLocaleString()} />
        <StatCard
          label="Bandsintown"
          value={bitCount.toLocaleString()}
          color="text-purple-600 dark:text-purple-400"
        />
        <StatCard
          label="Ticketmaster"
          value={tmCount.toLocaleString()}
          color="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          label="Eventbrite"
          value={ebCount.toLocaleString()}
          color="text-orange-600 dark:text-orange-400"
        />
      </div>

      {pendingScraped > 0 && (
        <div className="border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-950 px-3 py-2 text-xs font-mono text-yellow-800 dark:text-yellow-300">
          <span className="font-bold">⚠ {pendingScraped} scraped events</span> awaiting reconciliation
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <Link
          href="/events"
          className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 ${
            tab === "canonical"
              ? "border-purple-600 text-purple-700 dark:text-purple-300"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          Canonical Events ({totalEvents})
        </Link>
        <Link
          href="/events?tab=raw"
          className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 ${
            tab === "raw"
              ? "border-purple-600 text-purple-700 dark:text-purple-300"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          Raw Scraped ({totalScraped})
        </Link>
      </div>

      {tab === "canonical" ? (
        <section className="space-y-2">
          {/* Filters + rows per page */}
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[11px] font-mono text-gray-400 self-center">When:</span>
            {(["", "upcoming", "past"] as const).map((w) => (
              <Link
                key={w || "all"}
                href={eventsUrl({ when: w || undefined, page: "1" })}
                className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                  (whenFilter ?? "") === w
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {w === "" ? "All" : w === "upcoming" ? "Upcoming" : "Past"}
              </Link>
            ))}
            <span className="ml-2 text-[11px] font-mono text-gray-400 self-center">Type:</span>
            <Link
              href={eventsUrl({ type: undefined, page: "1" })}
              className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                !typeFilter
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              All
            </Link>
            {EVENT_TYPES.map((t) => (
              <Link
                key={t}
                href={eventsUrl({ type: t, page: "1" })}
                className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                  typeFilter === t
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {t}
              </Link>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[11px] font-mono text-gray-400">Rows:</span>
              {PAGE_SIZES.map((n) => (
                <Link
                  key={n}
                  href={eventsUrl({ limit: String(n), page: "1" })}
                  className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                    pageSize === n
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {n}
                </Link>
              ))}
            </div>
          </div>

          <p className="text-[11px] font-mono text-gray-400">
            {eventsTotal} events
            {whenFilter ? ` (${whenFilter})` : ""}
            {typeFilter ? ` · type: ${typeFilter}` : ""}
            {" "}· page {page}/{eventsPages || 1}
          </p>

          {events.length === 0 ? (
            <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-6 text-center">
              <p className="text-xs text-gray-400 font-mono">No events found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-left">
                    {(
                      [
                        { label: "Title", col: "title" },
                        { label: "Artist", col: "artist" },
                        { label: "Venue", col: "venue" },
                        { label: "City", col: "city" },
                        { label: "Date", col: "date" },
                        { label: "Type", col: "type" },
                        { label: "Scraped", col: null },
                      ] as { label: string; col: CanonicalSort | null }[]
                    ).map(({ label, col }) => (
                      <th key={label} className={thClass}>
                        {col ? (
                          <Link href={canonicalSortHref(col)} className={sortLinkClass}>
                            {label}{canonicalSortIndicator(col)}
                          </Link>
                        ) : label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event.id}
                      className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"
                    >
                      <td className="px-2 py-1.5 max-w-48 truncate text-gray-800 dark:text-gray-200">
                        <EditableCell value={event.title} recordId={event.id} field="title" apiPath="/api/admin/events" />
                      </td>
                      <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">
                        <EditableCell value={event.artist} recordId={event.id} field="artist" apiPath="/api/admin/events" />
                      </td>
                      <td className="px-2 py-1.5 max-w-32 truncate text-gray-500 dark:text-gray-500">
                        <EditableCell value={event.venue} recordId={event.id} field="venue" apiPath="/api/admin/events" />
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-500">
                        <EditableCell value={event.city} recordId={event.id} field="city" apiPath="/api/admin/events" />
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                        {formatDate(event.date)}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                        <EditableCell value={event.type} recordId={event.id} field="type" apiPath="/api/admin/events" />
                      </td>
                      <td className="px-2 py-1.5 text-gray-400 dark:text-gray-600">
                        {event.last_scraped_at ? formatDate(event.last_scraped_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {eventsPages > 1 && (
            <div className="flex justify-center gap-2 items-center">
              {page > 1 && (
                <Link
                  href={eventsUrl({ page: "1" })}
                  className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  «
                </Link>
              )}
              {page > 1 && (
                <Link
                  href={eventsUrl({ page: String(page - 1) })}
                  className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  Prev
                </Link>
              )}
              <span className="px-2 py-1 text-[11px] font-mono text-gray-400">
                {page} / {eventsPages}
              </span>
              {page < eventsPages && (
                <Link
                  href={eventsUrl({ page: String(page + 1) })}
                  className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  Next
                </Link>
              )}
              {page < eventsPages && (
                <Link
                  href={eventsUrl({ page: String(eventsPages) })}
                  className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  »
                </Link>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          {/* Scraped filters + rows per page */}
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[11px] font-mono text-gray-400 self-center">Source:</span>
            <Link
              href={scrapedUrl({ source: undefined, spage: "1" })}
              className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                !srcFilter
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              All
            </Link>
            {SCRAPED_SOURCES.map((s) => (
              <Link
                key={s}
                href={scrapedUrl({ source: s, spage: "1" })}
                className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                  srcFilter === s
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {s}
              </Link>
            ))}
            <span className="ml-2 text-[11px] font-mono text-gray-400 self-center">Status:</span>
            <Link
              href={scrapedUrl({ status: undefined, spage: "1" })}
              className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                !stFilter
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              All
            </Link>
            {SCRAPED_STATUSES.map((s) => (
              <Link
                key={s}
                href={scrapedUrl({ status: s, spage: "1" })}
                className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                  stFilter === s
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {s}
              </Link>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[11px] font-mono text-gray-400">Rows:</span>
              {PAGE_SIZES.map((n) => (
                <Link
                  key={n}
                  href={scrapedUrl({ slimit: String(n), spage: "1" })}
                  className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                    spageSize === n
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {n}
                </Link>
              ))}
            </div>
          </div>

          <p className="text-[11px] font-mono text-gray-400">
            {scrapedTotal} scraped events
            {srcFilter ? ` (${srcFilter})` : ""}
            {stFilter ? ` · status: ${stFilter}` : ""}
            {" "}· page {spage}/{scrapedPages || 1}
          </p>

          {scrapedEvents.length === 0 ? (
            <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-6 text-center">
              <p className="text-xs text-gray-400 font-mono">No scraped events found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-left">
                    {(
                      [
                        { label: "Source", col: "source" },
                        { label: "Title", col: "title" },
                        { label: "Artist", col: "artist" },
                        { label: "Venue", col: "venue" },
                        { label: "City", col: "city" },
                        { label: "Date", col: "date" },
                        { label: "Status", col: "status" },
                        { label: "Ingested", col: "created_at" },
                      ] as { label: string; col: ScrapedSort }[]
                    ).map(({ label, col }) => (
                      <th key={label} className={thClass}>
                        <Link href={scrapedSortHref(col)} className={sortLinkClass}>
                          {label}{scrapedSortIndicator(col)}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scrapedEvents.map((ev) => (
                    <tr
                      key={ev.id}
                      className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"
                    >
                      <td className="px-2 py-1.5 font-semibold text-purple-600 dark:text-purple-400">
                        {ev.source}
                      </td>
                      <td className="px-2 py-1.5 max-w-40 truncate text-gray-800 dark:text-gray-200" title={ev.title}>
                        {ev.title}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{ev.artist}</td>
                      <td className="px-2 py-1.5 max-w-28 truncate text-gray-500 dark:text-gray-500" title={ev.venue ?? ""}>
                        {ev.venue || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-500">{ev.city || "—"}</td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                        {formatDate(ev.date)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusBadge[ev.status] ?? ""}`}>
                          {ev.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-400 dark:text-gray-600">
                        {formatDate(ev.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {scrapedPages > 1 && (
            <div className="flex justify-center gap-2 items-center">
              {spage > 1 && (
                <Link
                  href={scrapedUrl({ spage: "1" })}
                  className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  «
                </Link>
              )}
              {spage > 1 && (
                <Link
                  href={scrapedUrl({ spage: String(spage - 1) })}
                  className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  Prev
                </Link>
              )}
              <span className="px-2 py-1 text-[11px] font-mono text-gray-400">
                {spage} / {scrapedPages}
              </span>
              {spage < scrapedPages && (
                <Link
                  href={scrapedUrl({ spage: String(spage + 1) })}
                  className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  Next
                </Link>
              )}
              {spage < scrapedPages && (
                <Link
                  href={scrapedUrl({ spage: String(scrapedPages) })}
                  className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  »
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-0.5">
        {label}
      </p>
      <p className={`text-sm font-bold font-mono ${color ?? "text-gray-800 dark:text-gray-200"}`}>
        {value}
      </p>
    </div>
  );
}
