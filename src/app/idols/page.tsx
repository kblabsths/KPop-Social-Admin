import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";
import { EditableCell } from "@/app/components/EditableCell";

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

const VALID_SORTS = ["stage_name", "real_name", "position", "nationality", "gender"] as const;
type SortCol = typeof VALID_SORTS[number];

const PAGE_SIZES = [25, 50, 100] as const;

export default async function IdolsPage({
  searchParams,
}: {
  searchParams: Promise<{ gender?: string; page?: string; q?: string; sort?: string; dir?: string; limit?: string }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const limitParam = parseInt(params.limit || "25", 10);
  const pageSize = PAGE_SIZES.includes(limitParam as typeof PAGE_SIZES[number]) ? limitParam : 25;
  const genderFilter = params.gender || undefined;
  const query = params.q || undefined;
  const sortCol: SortCol = VALID_SORTS.includes(params.sort as SortCol) ? (params.sort as SortCol) : "stage_name";
  const sortDir = params.dir === "desc" ? false : true;

  let pageQuery = supabase
    .from("idols")
    .select("id, stage_name, real_name, korean_name, position, nationality, gender, group_id, groups(name)", {
      count: "exact",
    })
    .order(sortCol, { ascending: sortDir })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (genderFilter) pageQuery = pageQuery.eq("gender", genderFilter);
  if (query) pageQuery = pageQuery.ilike("stage_name", `%${query}%`);

  const [pageResult, maleResult, femaleResult, totalResult] = await Promise.all([
    pageQuery,
    supabase.from("idols").select("*", { count: "exact", head: true }).eq("gender", "M"),
    supabase.from("idols").select("*", { count: "exact", head: true }).eq("gender", "F"),
    supabase.from("idols").select("*", { count: "exact", head: true }),
  ]);

  const idols = (pageResult.data ?? []) as unknown as IdolRow[];
  const total = pageResult.count ?? 0;
  const maleCount = maleResult.count ?? 0;
  const femaleCount = femaleResult.count ?? 0;
  const totalIdols = totalResult.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  function buildHref(overrides: Record<string, string | undefined>) {
    const next: Record<string, string | undefined> = {
      gender: genderFilter,
      q: query,
      page: "1",
      sort: sortCol !== "stage_name" ? sortCol : undefined,
      dir: !sortDir ? "desc" : undefined,
      limit: pageSize !== 25 ? String(pageSize) : undefined,
      ...overrides,
    };
    const qs = Object.entries(next)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return `/idols${qs ? `?${qs}` : ""}`;
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

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Idols
      </h1>

      {/* Gender filter */}
      <div className="flex gap-1">
        {([undefined, "M", "F"] as const).map((g) => (
          <Link
            key={g ?? "all"}
            href={buildHref({ gender: g, page: "1" })}
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

      {/* Search + rows per page */}
      <div className="flex flex-wrap gap-2 items-center">
        <form method="GET" action="/idols" className="flex gap-1">
          {genderFilter && <input type="hidden" name="gender" value={genderFilter} />}
          {sortCol !== "stage_name" && <input type="hidden" name="sort" value={sortCol} />}
          {!sortDir && <input type="hidden" name="dir" value="desc" />}
          {pageSize !== 25 && <input type="hidden" name="limit" value={String(pageSize)} />}
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
        {total} idols{genderFilter ? ` · ${genderFilter === "M" ? "Male" : "Female"}` : ""}
        {query ? ` · "${query}"` : ""} &middot; page {page}/{totalPages || 1}
      </p>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {(
                [
                  { label: "Stage Name", col: "stage_name" },
                  { label: "Real Name", col: "real_name" },
                  { label: "Group", col: null },
                  { label: "Position", col: "position" },
                  { label: "Nationality", col: "nationality" },
                  { label: "Gender", col: "gender" },
                ] as { label: string; col: SortCol | null }[]
              ).map(({ label, col }) => (
                <th
                  key={label}
                  className="px-2 py-1.5 text-left whitespace-nowrap"
                >
                  {col ? (
                    <Link
                      href={sortHref(col)}
                      className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold hover:text-gray-700 dark:hover:text-gray-300 inline-flex items-center"
                    >
                      {label}{sortIndicator(col)}
                    </Link>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">
                      {label}
                    </span>
                  )}
                </th>
              ))}
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
                    <EditableCell value={idol.stage_name} recordId={idol.id} field="stage_name" apiPath="/api/admin/idols" />
                    {idol.korean_name && (
                      <span className="ml-1 text-gray-400">({idol.korean_name})</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                    <EditableCell value={idol.real_name} recordId={idol.id} field="real_name" apiPath="/api/admin/idols" />
                  </td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">
                    {idol.groups?.name ? (
                      <Link
                        href={`/groups?q=${encodeURIComponent(idol.groups.name)}`}
                        className="text-purple-600 dark:text-purple-400 hover:underline"
                      >
                        {idol.groups.name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 max-w-[140px] truncate">
                    <EditableCell value={idol.position} recordId={idol.id} field="position" apiPath="/api/admin/idols" />
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                    <EditableCell value={idol.nationality} recordId={idol.id} field="nationality" apiPath="/api/admin/idols" />
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
