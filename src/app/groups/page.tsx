import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

const statusBadgeColors: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  disbanded: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  hiatus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

const typeBadgeColors: Record<string, string> = {
  boy_group: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  girl_group: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  co_ed: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

function formatTypeLabel(type: string | null): string {
  if (!type) return "—";
  return { boy_group: "Boy Group", girl_group: "Girl Group", co_ed: "Co-Ed" }[type] ?? type;
}

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string; q?: string }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 25;
  const statusFilter = params.status || undefined;
  const typeFilter = params.type || undefined;
  const query = params.q || undefined;

  // Build paginated query
  let pageQuery = supabase
    .from("groups")
    .select("*", { count: "exact" })
    .order("name", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (statusFilter) pageQuery = pageQuery.eq("status", statusFilter);
  if (typeFilter) pageQuery = pageQuery.eq("type", typeFilter);
  if (query) pageQuery = pageQuery.ilike("name", `%${query}%`);

  const [
    pageResult,
    totalResult,
    activeResult,
    disbandedResult,
    hiatusResult,
    boyGroupResult,
    girlGroupResult,
    coEdResult,
  ] = await Promise.all([
    pageQuery,
    supabase.from("groups").select("*", { count: "exact", head: true }),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("status", "disbanded"),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("status", "hiatus"),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("type", "boy_group"),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("type", "girl_group"),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("type", "co_ed"),
  ]);

  const groups = pageResult.data ?? [];
  const total = pageResult.count ?? 0;
  const totalGroups = totalResult.count ?? 0;
  const activeCount = activeResult.count ?? 0;
  const disbandedCount = disbandedResult.count ?? 0;
  const hiatusCount = hiatusResult.count ?? 0;
  const boyGroupCount = boyGroupResult.count ?? 0;
  const girlGroupCount = girlGroupResult.count ?? 0;
  const coEdCount = coEdResult.count ?? 0;

  const totalPages = Math.ceil(total / pageSize);

  function buildFilterHref(overrides: Record<string, string | undefined>) {
    const next = {
      status: statusFilter,
      type: typeFilter,
      q: query,
      page: "1",
      ...overrides,
    };
    const qs = Object.entries(next)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return `/groups${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Groups
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <StatCard label="Total Groups" value={totalGroups.toLocaleString()} />
        <StatCard
          label="Active"
          value={activeCount.toLocaleString()}
          color="text-green-600 dark:text-green-400"
        />
        <StatCard
          label="Disbanded"
          value={disbandedCount.toLocaleString()}
          color="text-red-600 dark:text-red-400"
        />
        <StatCard
          label="Hiatus"
          value={hiatusCount.toLocaleString()}
          color="text-yellow-600 dark:text-yellow-400"
        />
      </div>

      {/* Type breakdown */}
      <div className="grid grid-cols-3 gap-1.5">
        <StatCard label="Boy Groups" value={boyGroupCount.toLocaleString()} color="text-blue-600 dark:text-blue-400" />
        <StatCard label="Girl Groups" value={girlGroupCount.toLocaleString()} color="text-pink-600 dark:text-pink-400" />
        <StatCard label="Co-Ed" value={coEdCount.toLocaleString()} color="text-purple-600 dark:text-purple-400" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Status filter */}
        <div className="flex gap-1">
          {([undefined, "active", "disbanded", "hiatus"] as const).map((s) => (
            <Link
              key={s ?? "all"}
              href={buildFilterHref({ status: s, page: "1" })}
              className={`rounded px-2 py-1 text-[11px] font-mono ${
                statusFilter === s
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {s === undefined ? `All (${totalGroups})` : s}
            </Link>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex gap-1">
          {([undefined, "boy_group", "girl_group", "co_ed"] as const).map((t) => (
            <Link
              key={t ?? "all-type"}
              href={buildFilterHref({ type: t, page: "1" })}
              className={`rounded px-2 py-1 text-[11px] font-mono ${
                typeFilter === t
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {t === undefined ? "All Types" : formatTypeLabel(t)}
            </Link>
          ))}
        </div>
      </div>

      {/* Search */}
      <form method="GET" action="/groups" className="flex gap-1">
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search groups…"
          className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded px-2 py-1 text-xs text-gray-800 dark:text-gray-200 w-48 placeholder:text-gray-400"
        />
        <button
          type="submit"
          className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          Search
        </button>
        {query && (
          <Link
            href={buildFilterHref({ q: undefined, page: "1" })}
            className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Pagination info */}
      <p className="text-[11px] text-gray-400 font-mono">
        {total} groups{statusFilter ? ` · ${statusFilter}` : ""}
        {typeFilter ? ` · ${formatTypeLabel(typeFilter)}` : ""}
        {query ? ` · "${query}"` : ""} &middot; page {page}/{totalPages || 1}
      </p>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {["Name", "Korean", "Company", "Status", "Type", "Members", "Debut"].map((col) => (
                <th
                  key={col}
                  className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-gray-400">
                  No groups found.
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <tr
                  key={group.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="px-2 py-1.5 text-gray-800 dark:text-gray-200 whitespace-nowrap">
                    {group.name}
                    {group.short_name && (
                      <span className="ml-1 text-gray-400">({group.short_name})</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                    {group.korean_name ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 max-w-[160px] truncate">
                    {group.company ?? "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {group.status ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          statusBadgeColors[group.status] ?? ""
                        }`}
                      >
                        {group.status}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {group.type ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          typeBadgeColors[group.type] ?? ""
                        }`}
                      >
                        {formatTypeLabel(group.type)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 text-right">
                    {group.member_count ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {group.debut_date ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex gap-1">
          {page > 1 && (
            <Link
              href={buildFilterHref({ page: String(page - 1) })}
              className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
            >
              ← Prev
            </Link>
          )}
          {page < totalPages && (
            <Link
              href={buildFilterHref({ page: String(page + 1) })}
              className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
            >
              Next →
            </Link>
          )}
        </div>
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
