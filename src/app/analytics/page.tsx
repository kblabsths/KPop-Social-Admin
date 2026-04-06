import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function AnalyticsPage() {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ── User counts ─────────────────────────────────────────────────────────────
  const [totalUsersResult, newLast7Result, newLast30Result, recentUsersResult] = await Promise.all([
    supabase.from("web_users").select("*", { count: "exact", head: true }),
    supabase.from("web_users").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    supabase.from("web_users").select("*", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    supabase.from("web_users").select("id, name, email, created_at").order("created_at", { ascending: false }).limit(50),
  ]);

  const totalUsers = totalUsersResult.count ?? 0;
  const newLast7 = newLast7Result.count ?? 0;
  const newLast30 = newLast30Result.count ?? 0;
  const recentUsers = recentUsersResult.data ?? [];

  // ── Build signups per day (last 30 days) from recentUsers ───────────────────
  // Build a map of date -> count for the bar chart
  const signupsByDay: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    signupsByDay[key] = 0;
  }
  for (const user of recentUsers) {
    const key = new Date(user.created_at).toISOString().slice(0, 10);
    if (key in signupsByDay) signupsByDay[key]++;
  }
  const signupDays = Object.entries(signupsByDay);
  const maxSignups = Math.max(1, ...signupDays.map(([, v]) => v));

  // ── Top groups by member count ───────────────────────────────────────────────
  const topGroupsResult = await supabase
    .from("groups")
    .select("id, name, member_count, status, type")
    .order("member_count", { ascending: false })
    .limit(10);
  const topGroups = topGroupsResult.data ?? [];
  const maxMembers = Math.max(1, ...topGroups.map((g) => g.member_count ?? 0));

  // ── Upcoming events ──────────────────────────────────────────────────────────
  const upcomingEventsResult = await supabase
    .from("events")
    .select("id, title, artist, city, country, date, type")
    .gte("date", now.toISOString())
    .order("date", { ascending: true })
    .limit(10);
  const upcomingEvents = upcomingEventsResult.data ?? [];

  // ── Location aggregates from web_users if available ─────────────────────────
  // Attempt to get location; gracefully handle if column doesn't exist
  type LocationRow = { country: string; count: number };
  let locationData: LocationRow[] = [];
  try {
    const locResult = await supabase.rpc("user_location_summary").select();
    if (!locResult.error && locResult.data) {
      locationData = locResult.data as LocationRow[];
    }
  } catch {
    // location data not available — skip silently
  }

  return (
    <div className="space-y-6">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        User Analytics
      </h1>

      {/* ── Top stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
        <StatCard label="Total Users" value={totalUsers.toLocaleString()} />
        <StatCard label="New (7d)" value={newLast7.toLocaleString()} color="text-green-600 dark:text-green-400" />
        <StatCard label="New (30d)" value={newLast30.toLocaleString()} color="text-blue-600 dark:text-blue-400" />
      </div>

      {/* ── User signups over time (bar chart) ── */}
      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500">
          User Signups — Last 30 Days
        </h2>
        <div className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
          <div className="flex items-end gap-px h-24">
            {signupDays.map(([date, count]) => {
              const pct = Math.round((count / maxSignups) * 100);
              const isToday = date === now.toISOString().slice(0, 10);
              return (
                <div
                  key={date}
                  title={`${formatDate(date)}: ${count} signup${count !== 1 ? "s" : ""}`}
                  className="flex-1 flex flex-col justify-end cursor-default group"
                >
                  <div
                    className={`w-full transition-colors ${
                      isToday ? "bg-purple-500" : "bg-gray-300 dark:bg-gray-600 group-hover:bg-purple-400 dark:group-hover:bg-purple-500"
                    }`}
                    style={{ height: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] font-mono text-gray-400">{formatDate(signupDays[0][0])}</span>
            <span className="text-[10px] font-mono text-gray-400">{formatDate(signupDays[signupDays.length - 1][0])}</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── Popular groups ── */}
        <section className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500">
            Groups by Member Count
          </h2>
          <div className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {topGroups.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 font-mono text-center">No data</p>
            ) : (
              topGroups.map((group) => {
                const pct = Math.round(((group.member_count ?? 0) / maxMembers) * 100);
                return (
                  <div key={group.id} className="px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-gray-800 dark:text-gray-200 truncate max-w-[140px]">
                        {group.name}
                      </span>
                      <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 ml-2 shrink-0">
                        {group.member_count ?? "—"}
                      </span>
                    </div>
                    <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full">
                      <div
                        className="h-1 bg-purple-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ── Upcoming events ── */}
        <section className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500">
            Upcoming Events
          </h2>
          <div className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {upcomingEvents.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 font-mono text-center">No upcoming events</p>
            ) : (
              upcomingEvents.map((event) => (
                <div key={event.id} className="px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-gray-800 dark:text-gray-200 truncate">{event.title}</p>
                      <p className="text-[11px] font-mono text-gray-400">
                        {event.artist} · {event.city || event.country || "—"}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-gray-400 shrink-0 whitespace-nowrap">
                      {new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* ── Location aggregates (if available) ── */}
      {locationData.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500">
            User Locations
          </h2>
          <div className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-left">
                  <th className="px-3 py-1.5">Country</th>
                  <th className="px-3 py-1.5 text-right">Users</th>
                </tr>
              </thead>
              <tbody>
                {locationData.map((row) => (
                  <tr key={row.country} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{row.country}</td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 text-right">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Recent signups ── */}
      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500">
          Recent Signups
        </h2>
        <div className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-left">
                <th className="px-3 py-1.5">Name</th>
                <th className="px-3 py-1.5">Email</th>
                <th className="px-3 py-1.5">Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-gray-400">No users yet.</td>
                </tr>
              ) : (
                recentUsers.slice(0, 20).map((user) => (
                  <tr key={user.id} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{user.name ?? "—"}</td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{user.email}</td>
                    <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">
                      {formatDate(user.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
      <p className={`text-sm font-bold font-mono ${color ?? "text-gray-800 dark:text-gray-200"}`}>{value}</p>
    </div>
  );
}
