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

const VALID_SORTS = ["name", "korean_name", "company", "status", "type", "member_count", "debut_date"] as const;
type SortCol = typeof VALID_SORTS[number];

const PAGE_SIZES = [25, 50, 100] as const;

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string; q?: string; sort?: string; dir?: string; limit?: string }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const limitParam = parseInt(params.limit || "25", 10);
  const pageSize = PAGE_SIZES.includes(limitParam as typeof PAGE_SIZES[number]) ? limitParam : 25;
  const statusFilter = params.status || undefined;
  const typeFilter = params.type || undefined;
  const query = params.q || undefined;
  const sortCol: SortCol = VALID_SORTS.includes(params.sort as SortCol) ? (params.sort as SortCol) : "name";
  const sortDir = params.dir === "desc" ? false : true;

  let pageQuery = supabase
    .from("groups")
    .select("*", { count: "exact" })
    .order(sortCol, { ascending: sortDir })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (statusFilter) pageQuery = pageQuery.eq("status", statusFilter);
  if (typeFilter) pageQuery = pageQuery.eq("type", typeFilter);
  if (query) pageQuery = pageQuery.ilike("name", `%${query}%`);

  const pageResult = await pageQuery;

  const groups = pageResult.data ?? [];
  const total = pageResult.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  function buildHref(overrides: Record<string, string | undefined>) {
    const next: Record<string, string | undefined> = {
      status: statusFilter,
      type: typeFilter,
      q: query,
      page: "1",
      sort: sortCol !== "name" ? sortCol : undefined,
      dir: !sortDir ? "desc" : undefined,
      limit: pageSize !== 25 ? String(pageSize) : undefined,
      ...overrides,
    };
    const qs = Object.entries(next)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return `/groups${qs ? `?${qs}` : ""}`;
  }

  function sortHref(col: SortCol) {
    const isCurrent = sortCol === col;
    const newDir = isCurrent && sortDir ? "desc" : undefined;
    return buildHref({ sort: col, dir: newDir, page: "1" });
  }

  function sortIndicator(col: SortCol) {
    if (sortCol !== col) return <span className="text-gray-300 dark:text-gray-700 ml-0.5">↕</span>;
    return <span className="ml-0.5 text-purple-500">{sortDir ? "↑" : "↓"}</span>;
  }

  const columns: { label: string; col: SortCol }[] = [
    { label: "Name", col: "name" },
    { label: "Korean", col: "korean_name" },
    { label: "Company", col: "company" },
    { label: "Status", col: "status" },
    { label: "Type", col: "type" },
    { label: "Members", col: "member_count" },
    { label: "Debut", col: "debut_date" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Groups
      </h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Status filter */}
        <div className="flex gap-1">
          {([undefined, "active", "disbanded", "hiatus"] as const).map((s) => (
            <Link
              key={s ?? "all"}
              href={buildHref({ status: s, page: "1" })}
              className={`rounded px-2 py-1 text-[11px] font-mono ${
                statusFilter === s
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {s === undefined ? "All" : s}
            </Link>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex gap-1">
          {([undefined, "boy_group", "girl_group", "co_ed"] as const).map((t) => (
            <Link
              key={t ?? "all-type"}
              href={buildHref({ type: t, page: "1" })}
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

      {/* Search + rows per page */}
      <div className="flex flex-wrap gap-2 items-center">
        <form method="GET" action="/groups" className="flex gap-1">
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          {sortCol !== "name" && <input type="hidden" name="sort" value={sortCol} />}
          {!sortDir && <input type="hidden" name="dir" value="desc" />}
          {pageSize !== 25 && <input type="hidden" name="limit" value={String(pageSize)} />}
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
              href={buildHref({ q: undefined, page: "1" })}
              className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              Clear
            </Link>
          )}
        </form>

        {/* Rows per page */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[11px] font-mono text-gray-400">Rows:</span>
          {PAGE_SIZES.map((n) => (
            <Link
              key={n}
              href={buildHref({ limit: String(n), page: "1" })}
              className={`rounded px-2 py-1 text-[11px] font-mono ${
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
              {columns.map(({ label, col }) => (
                <th key={col} className="px-2 py-1.5 text-left whitespace-nowrap">
                  <Link
                    href={sortHref(col)}
                    className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold hover:text-gray-700 dark:hover:text-gray-300 inline-flex items-center"
                  >
                    {label}{sortIndicator(col)}
                  </Link>
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
        <div className="flex gap-1 items-center">
          {page > 1 && (
            <Link
              href={buildHref({ page: "1" })}
              className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
            >
              «
            </Link>
          )}
          {page > 1 && (
            <Link
              href={buildHref({ page: String(page - 1) })}
              className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
            >
              ← Prev
            </Link>
          )}
          <span className="px-2 py-1 text-[11px] font-mono text-gray-400">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={buildHref({ page: String(page + 1) })}
              className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
            >
              Next →
            </Link>
          )}
          {page < totalPages && (
            <Link
              href={buildHref({ page: String(totalPages) })}
              className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
            >
              »
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
