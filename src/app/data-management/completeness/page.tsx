import { getSupabaseAdmin } from "@/lib/supabase";
import { EditableCell } from "@/app/components/EditableCell";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Entity = "idols" | "groups";

interface Essential {
  field: string;
  label: string;
  multiline?: boolean;
}

const CONFIG: Record<
  Entity,
  {
    label: string;
    view: string;
    table: string;
    api: string;
    nameCol: string;
    essentials: Essential[];
    selectCols: string;
  }
> = {
  idols: {
    label: "Idols",
    view: "idol_completeness",
    table: "idols",
    api: "/api/admin/idols",
    nameCol: "stage_name",
    essentials: [
      { field: "image_url", label: "Image" },
      { field: "bio", label: "Bio", multiline: true },
      { field: "real_name", label: "Real name" },
      { field: "nationality", label: "Nationality" },
      { field: "birth_date", label: "Birthday" },
    ],
    selectCols: "id, stage_name, image_url, bio, real_name, nationality, birth_date",
  },
  groups: {
    label: "Groups",
    view: "group_completeness",
    table: "groups",
    api: "/api/admin/groups",
    nameCol: "name",
    essentials: [
      { field: "korean_name", label: "Korean name" },
      { field: "image_url", label: "Image" },
      { field: "bio", label: "Bio", multiline: true },
      { field: "company", label: "Company" },
      { field: "debut_date", label: "Debut" },
      { field: "type", label: "Type" },
    ],
    selectCols: "id, name, korean_name, image_url, bio, company, debut_date, type",
  },
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const scoreColor = (p: number) =>
  p >= 90 ? "text-green-600 dark:text-green-400" : p >= 60 ? "text-yellow-600 dark:text-yellow-500" : "text-red-600 dark:text-red-400";

type ViewRow = { id: string; missing_fields: string[]; completeness_score: number } & Record<string, unknown>;
type ValueRow = Record<string, string | null> & { id: string };

export default async function CompletenessPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; missing?: string; page?: string }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;
  const entity: Entity = params.entity === "groups" ? "groups" : "idols";
  const cfg = CONFIG[entity];
  const missing =
    params.missing && cfg.essentials.some((e) => e.field === params.missing) ? params.missing : undefined;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 25;

  // ── Overview counts (parallel) ──
  const totalP = supabase.from(cfg.view).select("*", { count: "exact", head: true });
  const completeP = supabase.from(cfg.view).select("*", { count: "exact", head: true }).gte("completeness_score", 1);
  const fieldPs = cfg.essentials.map((e) =>
    supabase.from(cfg.view).select("*", { count: "exact", head: true }).contains("missing_fields", [e.field]),
  );

  // ── List slice (most-incomplete first) ──
  let listQ = supabase
    .from(cfg.view)
    .select(`id, ${cfg.nameCol}, missing_fields, completeness_score`, { count: "exact" })
    .order("completeness_score", { ascending: true })
    .order(cfg.nameCol, { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  listQ = missing ? listQ.contains("missing_fields", [missing]) : listQ.lt("completeness_score", 1);

  const [totalR, completeR, listR, fieldRs] = await Promise.all([
    totalP,
    completeP,
    listQ,
    Promise.all(fieldPs),
  ]);

  const total = totalR.count ?? 0;
  const complete = completeR.count ?? 0;
  const fieldStats = cfg.essentials.map((e, i) => {
    const miss = fieldRs[i].count ?? 0;
    return { ...e, missing: miss, filled: total - miss };
  });

  const listRows = (listR.data ?? []) as unknown as ViewRow[];
  const listCount = listR.count ?? 0;
  const totalPages = Math.ceil(listCount / pageSize);

  const ids = listRows.map((r) => r.id);
  const valuesR = ids.length ? await supabase.from(cfg.table).select(cfg.selectCols).in("id", ids) : { data: [] };
  const valueById = new Map<string, ValueRow>(
    ((valuesR.data ?? []) as unknown as ValueRow[]).map((v) => [v.id, v]),
  );

  function href(overrides: Record<string, string | undefined>): string {
    const next: Record<string, string | undefined> = { entity, missing, page: "1", ...overrides };
    const qs = Object.entries(next)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join("&");
    return `/data-management/completeness${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-4">
      {/* Entity toggle */}
      <div className="flex gap-1">
        {(["idols", "groups"] as const).map((e) => (
          <Link
            key={e}
            href={href({ entity: e, missing: undefined, page: "1" })}
            className={`rounded px-3 py-1 text-[11px] font-mono ${
              entity === e
                ? "bg-purple-600 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {CONFIG[e].label}
          </Link>
        ))}
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-1.5">
        <Card label="Complete" value={`${pct(complete, total)}%`} sub={`${complete}/${total}`} big />
        {fieldStats.map((f) => (
          <Card key={f.field} label={f.label} value={`${pct(f.filled, total)}%`} sub={`${f.missing} missing`} />
        ))}
      </div>

      {/* Missing-field filter */}
      <div className="flex flex-wrap gap-1">
        <Link
          href={href({ missing: undefined, page: "1" })}
          className={`rounded px-2 py-1 text-[11px] font-mono ${
            !missing
              ? "bg-purple-600 text-white"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          All incomplete ({total - complete})
        </Link>
        {fieldStats.map((f) => (
          <Link
            key={f.field}
            href={href({ missing: f.field, page: "1" })}
            className={`rounded px-2 py-1 text-[11px] font-mono ${
              missing === f.field
                ? "bg-purple-600 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            missing {f.label} ({f.missing})
          </Link>
        ))}
      </div>

      <p className="text-[11px] text-gray-400 font-mono">
        {listCount} {cfg.label.toLowerCase()}
        {missing ? ` missing ${missing}` : " incomplete"} &middot; page {page}/{totalPages || 1} &middot; click any
        cell to edit
      </p>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">
                {cfg.nameCol === "name" ? "Name" : "Stage Name"}
              </th>
              {cfg.essentials.map((e) => (
                <th
                  key={e.field}
                  className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold whitespace-nowrap"
                >
                  {e.label}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {listRows.length === 0 ? (
              <tr>
                <td colSpan={cfg.essentials.length + 2} className="px-2 py-6 text-center text-gray-400">
                  Nothing here — all {cfg.label.toLowerCase()} complete for this filter. 🎉
                </td>
              </tr>
            ) : (
              listRows.map((row) => {
                const vals = valueById.get(row.id);
                const score = pct(Number(row.completeness_score), 1);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 align-top"
                  >
                    <td className="px-2 py-1.5 text-gray-800 dark:text-gray-200 whitespace-nowrap font-semibold">
                      {String(row[cfg.nameCol] ?? "—")}
                    </td>
                    {cfg.essentials.map((e) => {
                      const isMissing = row.missing_fields.includes(e.field);
                      const value = vals?.[e.field] ?? null;
                      return (
                        <td
                          key={e.field}
                          className={`px-2 py-1.5 max-w-[160px] ${
                            isMissing ? "bg-red-50 dark:bg-red-900/10" : ""
                          }`}
                        >
                          {e.field === "image_url" ? (
                            <div className="flex items-center gap-1">
                              {value && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={value} alt="" className="h-7 w-7 rounded object-cover shrink-0" />
                              )}
                              <EditableCell
                                value={value}
                                recordId={row.id}
                                field={e.field}
                                apiPath={cfg.api}
                                placeholder={isMissing ? "missing" : "—"}
                                className="truncate inline-block max-w-[100px] text-gray-500 dark:text-gray-400"
                              />
                            </div>
                          ) : (
                            <EditableCell
                              value={value}
                              recordId={row.id}
                              field={e.field}
                              apiPath={cfg.api}
                              multiline={e.multiline}
                              placeholder={isMissing ? "missing" : "—"}
                              className={`block ${isMissing ? "text-red-500 dark:text-red-400" : "text-gray-600 dark:text-gray-300"}`}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className={`px-2 py-1.5 text-right font-bold ${scoreColor(score)}`}>{score}%</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex gap-1">
          {page > 1 && (
            <Link
              href={href({ page: String(page - 1) })}
              className="rounded px-2 py-1 text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
            >
              ← Prev
            </Link>
          )}
          {page < totalPages && (
            <Link
              href={href({ page: String(page + 1) })}
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

function Card({ label, value, sub, big }: { label: string; value: string; sub: string; big?: boolean }) {
  return (
    <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</p>
      <p
        className={`font-bold font-mono ${big ? "text-lg" : "text-base"} ${
          parseInt(value) >= 90
            ? "text-green-600 dark:text-green-400"
            : parseInt(value) >= 60
              ? "text-yellow-600 dark:text-yellow-500"
              : "text-red-600 dark:text-red-400"
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] font-mono text-gray-400">{sub}</p>
    </div>
  );
}
