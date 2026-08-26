import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function OverviewPage() {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const [
    totalGroupsResult,
    activeGroupsResult,
    totalIdolsResult,
    totalEventsResult,
    upcomingEventsResult,
    totalUsersResult,
    eventsWithImageResult,
    eventsWithTicketUrlResult,
    eventsWithVenueResult,
    groupsWithImageResult,
    idolsWithImageResult,
    latestEventResult,
    newestEventsResult,
  ] = await Promise.all([
    supabase.from("groups").select("*", { count: "exact", head: true }),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("idols").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }).gte("starts_at", now),
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }).not("poster_url", "is", null),
    supabase.from("events").select("*", { count: "exact", head: true }).not("ticket_url", "is", null),
    supabase.from("events").select("*", { count: "exact", head: true }).not("venue_id", "is", null),
    supabase.from("groups").select("*", { count: "exact", head: true }).not("image_url", "is", null),
    supabase.from("idols").select("*", { count: "exact", head: true }).not("image_url", "is", null),
    supabase.from("events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from("event_listings")
      .select("event_id, title, performers_text, venue_name, city, starts_at, event_type")
      .gte("starts_at", now)
      .order("starts_at", { ascending: true })
      .limit(10),
  ]);

  const totalGroups = totalGroupsResult.count ?? 0;
  const activeGroups = activeGroupsResult.count ?? 0;
  const totalIdols = totalIdolsResult.count ?? 0;
  const totalEvents = totalEventsResult.count ?? 0;
  const upcomingEvents = upcomingEventsResult.count ?? 0;
  const totalUsers = totalUsersResult.count ?? 0;

  const eventsWithImage = eventsWithImageResult.count ?? 0;
  const eventsWithTicketUrl = eventsWithTicketUrlResult.count ?? 0;
  const eventsWithVenue = eventsWithVenueResult.count ?? 0;
  const groupsWithImage = groupsWithImageResult.count ?? 0;
  const idolsWithImage = idolsWithImageResult.count ?? 0;

  const latestEvent = latestEventResult.data;
  const newestEvents = newestEventsResult.data ?? [];

  function pct(n: number, total: number) {
    return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Overview
      </h1>

      {/* ── Catalog freshness ── */}
      <div className="w-full border-l-4 border-blue-500 bg-blue-50 px-3 py-2 text-xs font-mono text-blue-900 dark:bg-blue-950 dark:text-blue-200 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-bold">EVENTS</span>
        <span className="opacity-80">
          {latestEvent
            ? `Last event added ${formatAge(latestEvent.created_at)} · ${upcomingEvents} upcoming`
            : "No canonical events yet."}
        </span>
        <span className="opacity-60">
          Events arrive through the data ecosystem (intake / adapters); this panel only edits them.
        </span>
      </div>

      {/* ── Entity counts ── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Entities
        </h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          <StatCard label="Groups" value={totalGroups} />
          <StatCard label="Active Groups" value={activeGroups} color="text-green-600 dark:text-green-400" />
          <StatCard label="Idols" value={totalIdols} />
          <StatCard label="Events" value={totalEvents} />
          <StatCard label="Upcoming" value={upcomingEvents} color="text-blue-600 dark:text-blue-400" />
          <StatCard label="Users" value={totalUsers} />
        </div>
      </section>

      {/* ── Data completeness ── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Data Completeness
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          <CompletenessCard label="Events w/ Poster" value={pct(eventsWithImage, totalEvents)} count={eventsWithImage} total={totalEvents} />
          <CompletenessCard label="Events w/ Ticket URL" value={pct(eventsWithTicketUrl, totalEvents)} count={eventsWithTicketUrl} total={totalEvents} />
          <CompletenessCard label="Events w/ Venue" value={pct(eventsWithVenue, totalEvents)} count={eventsWithVenue} total={totalEvents} />
          <CompletenessCard label="Groups w/ Image" value={pct(groupsWithImage, totalGroups)} count={groupsWithImage} total={totalGroups} />
          <CompletenessCard label="Idols w/ Image" value={pct(idolsWithImage, totalIdols)} count={idolsWithImage} total={totalIdols} />
        </div>
        <p className="mt-1 text-[10px] font-mono text-gray-400">
          <Link href="/database" className="underline hover:text-gray-600">Full field-level completeness →</Link>
        </p>
      </section>

      {/* ── Next up ── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Next Up
        </h2>
        <div className="border border-gray-300 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-800">
          {newestEvents.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 text-center font-mono">No upcoming events.</div>
          ) : (
            newestEvents.map((e) => (
              <div key={e.event_id} className="flex items-start gap-3 px-3 py-1.5 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-900">
                <span className="shrink-0 text-gray-400 dark:text-gray-500 w-28">
                  {new Date(e.starts_at).toISOString().replace("T", " ").slice(0, 16)}
                </span>
                <span className="shrink-0 text-[10px] uppercase text-purple-500 w-16">{e.event_type}</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200 truncate">{e.title}</span>
                <span className="text-gray-500 dark:text-gray-400 truncate">
                  {e.performers_text || "—"} · {e.venue_name ?? "no venue"}{e.city ? `, ${e.city}` : ""}
                </span>
              </div>
            ))
          )}
        </div>
        <p className="mt-1 text-[10px] font-mono text-gray-400">
          <Link href="/data-management/events" className="underline hover:text-gray-600">All events →</Link>
        </p>
      </section>
    </div>
  );
}

function CompletenessCard({ label, value, count, total }: { label: string; value: number; count: number; total: number }) {
  return (
    <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</p>
      <p
        className={`text-lg font-bold font-mono ${
          value >= 90
            ? "text-green-600 dark:text-green-400"
            : value >= 70
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-red-600 dark:text-red-400"
        }`}
      >
        {value}%
      </p>
      <p className="text-[10px] font-mono text-gray-400">{count}/{total}</p>
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
