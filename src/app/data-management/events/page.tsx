import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";
import { EditableCell } from "@/app/components/EditableCell";

export const dynamic = "force-dynamic";

// Canonical events (events cutover, 2026-08-25), read through the event_listings
// view: the database owns the events ⋈ venues ⋈ performers ⋈ stats join.
const EVENT_TYPES = ["concert", "festival", "fansign", "fanmeet", "showcase", "online", "other"] as const;
const EVENT_STATUSES = ["scheduled", "postponed", "cancelled"] as const;
const PAGE_SIZES = [25, 50, 100] as const;

const SORTS = ["title", "performers_text", "venue_name", "city", "starts_at", "event_type", "status"] as const;
type SortCol = typeof SORTS[number];

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16);
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    status?: string;
    when?: string;
    page?: string;
    sort?: string;
    dir?: string;
    limit?: string;
  }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;
  const now = new Date().toISOString();

  const typeFilter = params.type && EVENT_TYPES.includes(params.type as typeof EVENT_TYPES[number]) ? params.type : undefined;
  const statusFilter = params.status && EVENT_STATUSES.includes(params.status as typeof EVENT_STATUSES[number]) ? params.status : undefined;
  const whenFilter = params.when === "upcoming" || params.when === "past" ? params.when : undefined;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const limitParam = parseInt(params.limit || "25", 10);
  const pageSize = PAGE_SIZES.includes(limitParam as typeof PAGE_SIZES[number]) ? limitParam : 25;
  const sortCol: SortCol = SORTS.includes(params.sort as SortCol) ? (params.sort as SortCol) : "starts_at";
  const sortDir = params.dir === "desc" ? false : true; // default asc for starts_at

  const [totalResult, upcomingResult, pastResult, noVenueResult, performerLinksResult] = await Promise.all([
    supabase.from("events").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }).gte("starts_at", now),
    supabase.from("events").select("*", { count: "exact", head: true }).lt("starts_at", now),
    supabase.from("events").select("*", { count: "exact", head: true }).is("venue_id", null),
    supabase.from("event_performers").select("*", { count: "exact", head: true }),
  ]);
  const totalEvents = totalResult.count ?? 0;
  const upcomingEvents = upcomingResult.count ?? 0;
  const pastEvents = pastResult.count ?? 0;
  const noVenue = noVenueResult.count ?? 0;
  const performerLinks = performerLinksResult.count ?? 0;

  let query = supabase
    .from("event_listings")
    .select("event_id, title, performers_text, venue_name, city, country, starts_at, time_precision, event_type, status, going_count, interested_count", { count: "exact" })
    .order(sortCol, { ascending: sortDir })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (typeFilter) query = query.eq("event_type", typeFilter);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (whenFilter === "upcoming") query = query.gte("starts_at", now);
  if (whenFilter === "past") query = query.lt("starts_at", now);

  const result = await query;
  const events = result.data ?? [];
  const eventsTotal = result.count ?? 0;
  const pages = Math.ceil(eventsTotal / pageSize);

  function url(overrides: Record<string, string | undefined>) {
    const p: Record<string, string | undefined> = {
      type: typeFilter,
      status: statusFilter,
      when: whenFilter,
      page: page > 1 ? String(page) : undefined,
      sort: sortCol !== "starts_at" ? sortCol : undefined,
      dir: !sortDir ? "desc" : undefined,
      limit: pageSize !== 25 ? String(pageSize) : undefined,
    };
    Object.assign(p, overrides);
    const q = new URLSearchParams(
      Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>
    );
    return `/data-management/events?${q}`;
  }
  function sortHref(col: SortCol) {
    const isCurrent = sortCol === col;
    return url({ sort: col, dir: isCurrent && sortDir ? "desc" : undefined, page: "1" });
  }
  function sortIndicator(col: SortCol) {
    if (sortCol !== col) return <span className="text-gray-300 dark:text-gray-700 ml-0.5">↕</span>;
    return <span className="ml-0.5 text-purple-500">{sortDir ? "↑" : "↓"}</span>;
  }

  const chip = (active: boolean) =>
    `rounded px-2 py-0.5 text-[11px] font-mono ${active ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"}`;
  const thClass = "px-2 py-1.5 font-medium text-left whitespace-nowrap";

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Events</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
        <StatCard label="Total Events" value={totalEvents.toLocaleString()} />
        <StatCard label="Upcoming" value={upcomingEvents.toLocaleString()} color="text-green-600 dark:text-green-400" />
        <StatCard label="Past" value={pastEvents.toLocaleString()} color="text-gray-500 dark:text-gray-400" />
        <StatCard label="No Venue" value={noVenue.toLocaleString()} color={noVenue > 0 ? "text-yellow-600 dark:text-yellow-400" : undefined} />
        <StatCard label="Performer Links" value={performerLinks.toLocaleString()} />
      </div>

      <p className="text-[11px] font-mono text-gray-400">
        Events are written by the data ecosystem (intake / adapters). Title, type, status, description,
        ticket and poster URLs are editable here; performers and venues are links owned by
        <code> event_performers</code> / <code>venues</code>.
      </p>

      <section className="space-y-2">
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[11px] font-mono text-gray-400 self-center">When:</span>
          {(["", "upcoming", "past"] as const).map((w) => (
            <Link key={w || "all"} href={url({ when: w || undefined, page: "1" })} className={chip((whenFilter ?? "") === w)}>
              {w === "" ? "All" : w === "upcoming" ? "Upcoming" : "Past"}
            </Link>
          ))}
          <span className="ml-2 text-[11px] font-mono text-gray-400 self-center">Type:</span>
          <Link href={url({ type: undefined, page: "1" })} className={chip(!typeFilter)}>All</Link>
          {EVENT_TYPES.map((t) => (
            <Link key={t} href={url({ type: t, page: "1" })} className={chip(typeFilter === t)}>{t}</Link>
          ))}
          <span className="ml-2 text-[11px] font-mono text-gray-400 self-center">Status:</span>
          <Link href={url({ status: undefined, page: "1" })} className={chip(!statusFilter)}>All</Link>
          {EVENT_STATUSES.map((st) => (
            <Link key={st} href={url({ status: st, page: "1" })} className={chip(statusFilter === st)}>{st}</Link>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[11px] font-mono text-gray-400">Rows:</span>
            {PAGE_SIZES.map((n) => (
              <Link key={n} href={url({ limit: String(n), page: "1" })} className={chip(pageSize === n)}>{n}</Link>
            ))}
          </div>
        </div>

        <p className="text-[11px] font-mono text-gray-400">
          {eventsTotal} events{whenFilter ? ` (${whenFilter})` : ""}{typeFilter ? ` · type: ${typeFilter}` : ""}{statusFilter ? ` · status: ${statusFilter}` : ""} · page {page}/{pages || 1}
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
                      { label: "Performers", col: "performers_text" },
                      { label: "Venue", col: "venue_name" },
                      { label: "City", col: "city" },
                      { label: "Starts", col: "starts_at" },
                      { label: "Type", col: "event_type" },
                      { label: "Status", col: "status" },
                      { label: "Going / Int.", col: null },
                    ] as { label: string; col: SortCol | null }[]
                  ).map(({ label, col }) => (
                    <th key={label} className={thClass}>
                      {col ? (
                        <Link href={sortHref(col)} className="hover:text-gray-200 inline-flex items-center">
                          {label}{sortIndicator(col)}
                        </Link>
                      ) : label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.event_id} className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900">
                    <td className="px-2 py-1.5 max-w-64 truncate text-gray-800 dark:text-gray-200">
                      <EditableCell value={event.title} recordId={event.event_id} field="title" apiPath="/api/admin/events" />
                    </td>
                    <td className="px-2 py-1.5 max-w-40 truncate text-gray-600 dark:text-gray-400">{event.performers_text || "—"}</td>
                    <td className="px-2 py-1.5 max-w-40 truncate text-gray-500 dark:text-gray-500">{event.venue_name ?? "—"}</td>
                    <td className="px-2 py-1.5 text-gray-500 dark:text-gray-500">{event.city ?? "—"}{event.country ? ` (${event.country})` : ""}</td>
                    <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                      {event.time_precision === "date" ? formatDate(event.starts_at).slice(0, 10) : formatDate(event.starts_at)}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                      <EditableCell value={event.event_type} recordId={event.event_id} field="event_type" apiPath="/api/admin/events" />
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                      <EditableCell value={event.status} recordId={event.event_id} field="status" apiPath="/api/admin/events" />
                    </td>
                    <td className="px-2 py-1.5 text-gray-400 dark:text-gray-500">{event.going_count} / {event.interested_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex justify-center gap-2 items-center">
            {page > 1 && <Link href={url({ page: String(page - 1) })} className={chip(false)}>‹ prev</Link>}
            <span className="text-[11px] font-mono text-gray-400">page {page} / {pages}</span>
            {page < pages && <Link href={url({ page: String(page + 1) })} className={chip(false)}>next ›</Link>}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono ${color ?? "text-gray-800 dark:text-gray-200"}`}>{value}</p>
    </div>
  );
}
