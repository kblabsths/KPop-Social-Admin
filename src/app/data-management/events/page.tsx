import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

const EVENT_TYPES = ["concert", "fanmeet", "festival", "online", "other"] as const;
const SCRAPED_SOURCES = ["bandsintown", "ticketmaster", "eventbrite"] as const;
const SCRAPED_STATUSES = ["pending", "matched", "created", "skipped", "error"] as const;
const PAGE_SIZE = 25;

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16);
}

const BASE = "/data-management/events";

export default async function DataManagementEventsPage({
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
  }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;

  const tab = params.tab === "raw" ? "raw" : "canonical";
  const now = new Date().toISOString();

  const typeFilter = params.type && EVENT_TYPES.includes(params.type as typeof EVENT_TYPES[number])
    ? params.type
    : undefined;
  const whenFilter = params.when === "upcoming" || params.when === "past"
    ? params.when
    : undefined;
  const page = Math.max(1, parseInt(params.page || "1", 10));

  const srcFilter = params.source && SCRAPED_SOURCES.includes(params.source as typeof SCRAPED_SOURCES[number])
    ? params.source
    : undefined;
  const stFilter = params.status && SCRAPED_STATUSES.includes(params.status as typeof SCRAPED_STATUSES[number])
    ? params.status
    : undefined;
  const spage = Math.max(1, parseInt(params.spage || "1", 10));

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

  let eventsQuery = supabase
    .from("events")
    .select(
      "id, title, artist, venue, city, country, date, type, last_scraped_at, artist_id, venue_id",
      { count: "exact" }
    )
    .order("date", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (typeFilter) eventsQuery = eventsQuery.eq("type", typeFilter);
  if (whenFilter === "upcoming") eventsQuery = eventsQuery.gte("date", now);
  if (whenFilter === "past") eventsQuery = eventsQuery.lt("date", now);

  const eventsResult = await eventsQuery;
  const events = eventsResult.data ?? [];
  const eventsTotal = eventsResult.count ?? 0;
  const eventsPages = Math.ceil(eventsTotal / PAGE_SIZE);

  let scrapedQuery = supabase
    .from("scraped_events")
    .select(
      "id, source, source_event_id, title, artist, venue, city, country, date, status, matched_event_id, scraper_run_id, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((spage - 1) * PAGE_SIZE, spage * PAGE_SIZE - 1);

  if (srcFilter) scrapedQuery = scrapedQuery.eq("source", srcFilter);
  if (stFilter) scrapedQuery = scrapedQuery.eq("status", stFilter);

  const scrapedResult = await scrapedQuery;
  const scrapedEvents = scrapedResult.data ?? [];
  const scrapedTotal = scrapedResult.count ?? 0;
  const scrapedPages = Math.ceil(scrapedTotal / PAGE_SIZE);

  function eventsUrl(overrides: Record<string, string | undefined>) {
    const p: Record<string, string> = { tab: "canonical" };
    if (typeFilter) p.type = typeFilter;
    if (whenFilter) p.when = whenFilter;
    if (page > 1) p.page = String(page);
    Object.assign(p, overrides);
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Record<string, string>
    );
    return `${BASE}?${q}`;
  }

  function scrapedUrl(overrides: Record<string, string | undefined>) {
    const p: Record<string, string> = { tab: "raw" };
    if (srcFilter) p.source = srcFilter;
    if (stFilter) p.status = stFilter;
    if (spage > 1) p.spage = String(spage);
    Object.assign(p, overrides);
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Record<string, string>
    );
    return `${BASE}?${q}`;
  }

  const statusBadge: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    matched: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    created: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    skipped: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return (
    <div className="space-y-4">
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
          href={BASE}
          className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 ${
            tab === "canonical"
              ? "border-purple-600 text-purple-700 dark:text-purple-300"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          Canonical Events ({totalEvents})
        </Link>
        <Link
          href={`${BASE}?tab=raw`}
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
          {/* Filters */}
          <div className="flex flex-wrap gap-1">
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
                    <th className="px-2 py-1.5 font-medium">Title</th>
                    <th className="px-2 py-1.5 font-medium">Artist</th>
                    <th className="px-2 py-1.5 font-medium">Venue</th>
                    <th className="px-2 py-1.5 font-medium">City</th>
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 font-medium">Scraped</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event.id}
                      className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"
                    >
                      <td className="px-2 py-1.5 max-w-48 truncate text-gray-800 dark:text-gray-200" title={event.title}>
                        {event.title}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{event.artist}</td>
                      <td className="px-2 py-1.5 max-w-32 truncate text-gray-500 dark:text-gray-500" title={event.venue ?? ""}>
                        {event.venue || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-500">{event.city || "—"}</td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                        {formatDate(event.date)}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">{event.type || "—"}</td>
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
            <div className="flex justify-center gap-2">
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
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          {/* Scraped filters */}
          <div className="flex flex-wrap gap-1">
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
                    <th className="px-2 py-1.5 font-medium">Source</th>
                    <th className="px-2 py-1.5 font-medium">Title</th>
                    <th className="px-2 py-1.5 font-medium">Artist</th>
                    <th className="px-2 py-1.5 font-medium">Venue</th>
                    <th className="px-2 py-1.5 font-medium">City</th>
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                    <th className="px-2 py-1.5 font-medium">Ingested</th>
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
            <div className="flex justify-center gap-2">
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
