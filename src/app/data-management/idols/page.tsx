import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

const genderBadgeColors: Record<string, string> = {
  M: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  F: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
};

type IdolRow = {
  id: string;
  stage_name: string;
  real_name: string | null;
  korean_name: string | null;
  position: string | null;
  nationality: string | null;
  gender: string | null;
  group_id: string | null;
  groups: { name: string } | null;
};

export default async function DataManagementIdolsPage({
  searchParams,
}: {
  searchParams: Promise<{ gender?: string; page?: string; q?: string }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 25;
  const genderFilter = params.gender || undefined;
  const query = params.q || undefined;

  let pageQuery = supabase
    .from("idols")
    .select("id, stage_name, real_name, korean_name, position, nationality, gender, group_id, groups(name)", {
      count: "exact",
    })
    .order("stage_name", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (genderFilter) pageQuery = pageQuery.eq("gender", genderFilter);
  if (query) pageQuery = pageQuery.ilike("stage_name", `%${query}%`);

  const [
    pageResult,
    totalResult,
    maleResult,
    femaleResult,
    noGroupResult,
  ] = await Promise.all([
    pageQuery,
    supabase.from("idols").select("*", { count: "exact", head: true }),
    supabase.from("idols").select("*", { count: "exact", head: true }).eq("gender", "M"),
    supabase.from("idols").select("*", { count: "exact", head: true }).eq("gender", "F"),
    supabase.from("idols").select("*", { count: "exact", head: true }).is("group_id", null),
  ]);

  const topGroupsResult = await supabase
    .from("idols")
    .select("group_id, groups(name)")
    .not("group_id", "is", null)
    .limit(500);

  const idols = (pageResult.data ?? []) as unknown as IdolRow[];
  const total = pageResult.count ?? 0;
  const totalIdols = totalResult.count ?? 0;
  const maleCount = maleResult.count ?? 0;
  const femaleCount = femaleResult.count ?? 0;
  const noGroupCount = noGroupResult.count ?? 0;

  const groupCountMap = new Map<string, { name: string; count: number }>();
  for (const row of (topGroupsResult.data ?? []) as unknown as { group_id: string; groups: { name: string } | null }[]) {
    if (!row.group_id || !row.groups) continue;
    const existing = groupCountMap.get(row.group_id);
    if (existing) {
      existing.count++;
    } else {
      groupCountMap.set(row.group_id, { name: row.groups.name, count: 1 });
    }
  }
  const topGroups = Array.from(groupCountMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const totalPages = Math.ceil(total / pageSize);

  function buildFilterHref(overrides: Record<string, string | undefined>) {
    const next = {
      gender: genderFilter,
      q: query,
      page: "1",
      ...overrides,
    };
    const qs = Object.entries(next)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return `/data-management/idols${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <StatCard label="Total Idols" value={totalIdols.toLocaleString()} />
        <StatCard
          label="Male"
          value={maleCount.toLocaleString()}
          color="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          label="Female"
          value={femaleCount.toLocaleString()}
          color="text-pink-600 dark:text-pink-400"
        />
        <StatCard
          label="Soloists / No Group"
          value={noGroupCount.toLocaleString()}
          color="text-gray-600 dark:text-gray-400"
        />
      </div>

      {/* Top groups */}
      {topGroups.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
            Top Groups by Idol Count
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topGroups.map((g) => (
              <span
                key={g.name}
                className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] font-mono text-gray-700 dark:text-gray-300"
              >
                {g.name} <span className="text-gray-400">{g.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gender filter */}
      <div className="flex gap-1">
        {([undefined, "M", "F"] as const).map((g) => (
          <Link
            key={g ?? "all"}
            href={buildFilterHref({ gender: g, page: "1" })}
            className={`rounded px-2 py-1 text-[11px] font-mono ${
              genderFilter === g
                ? "bg-purple-600 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {g === undefined ? `All (${totalIdols})` : g === "M" ? `Male (${maleCount})` : `Female (${femaleCount})`}
          </Link>
        ))}
      </div>

      {/* Search */}
      <form method="GET" action="/data-management/idols" className="flex gap-1">
        {genderFilter && <input type="hidden" name="gender" value={genderFilter} />}
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search by stage name…"
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
        {total} idols{genderFilter ? ` · ${genderFilter === "M" ? "Male" : "Female"}` : ""}
        {query ? ` · "${query}"` : ""} &middot; page {page}/{totalPages || 1}
      </p>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {["Stage Name", "Real Name", "Group", "Position", "Nationality", "Gender"].map(
                (col) => (
                  <th
                    key={col}
                    className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold whitespace-nowrap"
                  >
                    {col}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {idols.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-gray-400">
                  No idols found.
                </td>
              </tr>
            ) : (
              idols.map((idol) => (
                <tr
                  key={idol.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="px-2 py-1.5 text-gray-800 dark:text-gray-200 whitespace-nowrap">
                    {idol.stage_name}
                    {idol.korean_name && (
                      <span className="ml-1 text-gray-400">({idol.korean_name})</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                    {idol.real_name ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">
                    {idol.groups?.name ? (
                      <Link
                        href={`/data-management/groups?q=${encodeURIComponent(idol.groups.name)}`}
                        className="text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        {idol.groups.name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 max-w-[140px] truncate">
                    {idol.position ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                    {idol.nationality ?? "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {idol.gender ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          genderBadgeColors[idol.gender] ?? ""
                        }`}
                      >
                        {idol.gender === "M" ? "Male" : "Female"}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
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
