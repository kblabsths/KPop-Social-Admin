import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";

// Models map 1:1 to tables that actually exist in the shared Supabase
// project (the old web_users/artists/concerts/scraper_logs/
// data_quality_alerts tables were never created there).
const MODELS = [
  { key: "user", label: "Profiles" },
  { key: "group", label: "Groups" },
  { key: "idol", label: "Idols" },
  { key: "venue", label: "Venues" },
  { key: "event", label: "Events" },
  { key: "scrapedEvent", label: "Scraped Events (archive)" },
  { key: "post", label: "Posts" },
] as const;

type ModelKey = (typeof MODELS)[number]["key"];

const MODEL_TO_TABLE: Record<ModelKey, string> = {
  user: "profiles",
  group: "groups",
  idol: "idols",
  venue: "venues",
  event: "events",
  scrapedEvent: "scraped_events",
  post: "posts",
};

const MODEL_ORDER_COLUMN: Record<ModelKey, string> = {
  user: "created_at",
  group: "created_at",
  idol: "created_at",
  venue: "created_at",
  event: "created_at",
  scrapedEvent: "created_at",
  post: "created_at",
};

async function getModelStats(modelKey: ModelKey) {
  const supabase = getSupabaseAdmin();
  const tableName = MODEL_TO_TABLE[modelKey];
  const orderColumn = MODEL_ORDER_COLUMN[modelKey];
  const [totalResult, newestRec, oldestRec] = await Promise.all([
    supabase.from(tableName).select("*", { count: "exact", head: true }),
    supabase
      .from(tableName)
      .select(orderColumn)
      .order(orderColumn, { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(tableName)
      .select(orderColumn)
      .order(orderColumn, { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const newest = (newestRec.data as Record<string, string> | null)?.[orderColumn] ?? null;
  const oldest = (oldestRec.data as Record<string, string> | null)?.[orderColumn] ?? null;
  return { total: totalResult.count ?? 0, newest, oldest };
}

const getCachedAllModelStats = unstable_cache(
  async () =>
    Promise.all(
      MODELS.map((m) =>
        getModelStats(m.key).then((s) => ({
          key: m.key,
          label: m.label,
          ...s,
        }))
      )
    ),
  ["db-all-model-stats"],
  { revalidate: 60 }
);

function formatDate(d: string | null): string {
  if (!d) return "--";
  return d.replace("T", " ").slice(0, 16);
}

function isDateString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}T/.test(value) || /^\d{4}-\d{2}-\d{2} /.test(value);
}

export default async function DatabasePage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string; page?: string }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;
  const selectedModel = (params.model || "user") as ModelKey;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 25;

  const modelInfo = MODELS.find((m) => m.key === selectedModel);
  if (!modelInfo) {
    return <p className="text-red-600">Invalid model selected.</p>;
  }

  const tableName = MODEL_TO_TABLE[selectedModel];

  const [recordsResult, allModelStats] = await Promise.all([
    supabase
      .from(tableName)
      .select("*", { count: "exact" })
      .order(MODEL_ORDER_COLUMN[selectedModel], { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1),
    getCachedAllModelStats(),
  ]);

  const records = recordsResult.data ?? [];
  const total = recordsResult.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const columns =
    records.length > 0
      ? Object.keys(records[0]).filter(
          (k) => typeof records[0][k] !== "object" || records[0][k] === null
        )
      : [];

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Database Browser
      </h1>

      {/* Per-model summary stats */}
      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
          Record Counts
        </h2>
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-1.5">
          {allModelStats.map((s) => (
            <Link
              key={s.key}
              href={`/database?model=${s.key}`}
              className={`border px-2 py-1.5 transition-colors ${
                selectedModel === s.key
                  ? "border-purple-500 bg-purple-50 dark:bg-purple-950"
                  : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-400 dark:hover:border-gray-600"
              }`}
            >
              <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 truncate">
                {s.label}
              </p>
              <p className="text-sm font-bold font-mono text-gray-800 dark:text-gray-200">
                {s.total.toLocaleString()}
              </p>
              <div className="text-[9px] font-mono text-gray-400 dark:text-gray-500 leading-tight">
                {s.newest ? (
                  <>
                    <span>new: {s.newest.slice(0, 10)}</span>
                    <br />
                    <span>old: {s.oldest?.slice(0, 10)}</span>
                  </>
                ) : (
                  <span>no records</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Field completeness lives at /data-management/completeness (prod views) */}

      {/* Model selector tabs */}
      <div className="flex flex-wrap gap-1">
        {MODELS.map((m) => {
          const stat = allModelStats.find((s) => s.key === m.key);
          return (
            <Link
              key={m.key}
              href={`/database?model=${m.key}`}
              className={`rounded px-2 py-1 text-[11px] font-mono ${
                selectedModel === m.key
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {m.label}
              {stat ? ` (${stat.total})` : ""}
            </Link>
          );
        })}
      </div>

      <p className="text-[11px] font-mono text-gray-400">
        {total} {modelInfo.label.toLowerCase()} total &middot; page {page}/{totalPages || 1} &middot; {pageSize}/page
      </p>

      {/* Data table */}
      {records.length === 0 ? (
        <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-6 text-center">
          <p className="text-xs text-gray-400 font-mono">No records found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-left">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-2 py-1 font-medium whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record: Record<string, unknown>, i: number) => (
                <tr
                  key={i}
                  className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="px-2 py-1 text-gray-600 dark:text-gray-400 max-w-40 truncate whitespace-nowrap"
                      title={String(record[col] ?? "")}
                    >
                      {isDateString(record[col])
                        ? formatDate(record[col] as string)
                        : String(record[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/database?model=${selectedModel}&page=${page - 1}`}
              className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              Prev
            </Link>
          )}
          <span className="px-2 py-1 text-[11px] font-mono text-gray-400">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/database?model=${selectedModel}&page=${page + 1}`}
              className="rounded bg-gray-100 px-2 py-1 text-[11px] font-mono dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
