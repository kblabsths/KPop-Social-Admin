import { prisma } from "@/lib/prisma";
import Link from "next/link";

const MODELS = [
  { key: "user", label: "Users" },
  { key: "artist", label: "Artists" },
  { key: "venue", label: "Venues" },
  { key: "concert", label: "Concerts" },
  { key: "group", label: "Groups" },
  { key: "post", label: "Posts" },
  { key: "scraperRun", label: "Scraper Runs" },
  { key: "scraperLog", label: "Scraper Logs" },
  { key: "dataQualityAlert", label: "Data Quality Alerts" },
] as const;

type ModelKey = (typeof MODELS)[number]["key"];

async function getModelStats(modelKey: ModelKey) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[modelKey];
  const total: number = await delegate.count();

  let newest: Date | null = null;
  let oldest: Date | null = null;
  if (total > 0) {
    const [newestRec, oldestRec] = await Promise.all([
      delegate.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      delegate.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    newest = newestRec?.createdAt ?? null;
    oldest = oldestRec?.createdAt ?? null;
  }

  return { total, newest, oldest };
}

async function getFieldCompleteness() {
  const [
    totalConcerts,
    concertsWithTourName,
    concertsWithEndDate,
    concertsWithDoorsOpen,
    concertsWithTicketUrl,
    concertsWithDescription,
    concertsWithImageUrl,
    concertsWithSource,
    totalArtists,
    artistsWithKoreanName,
    artistsWithCompany,
    artistsWithDescription,
    artistsWithImage,
    artistsWithDebutDate,
    totalVenues,
    venuesWithState,
    venuesWithLatLng,
    venuesWithCapacity,
    venuesWithType,
    venuesWithAddress,
  ] = await Promise.all([
    prisma.concert.count(),
    prisma.concert.count({ where: { tourName: { not: null } } }),
    prisma.concert.count({ where: { endDate: { not: null } } }),
    prisma.concert.count({ where: { doorsOpen: { not: null } } }),
    prisma.concert.count({ where: { ticketUrl: { not: null } } }),
    prisma.concert.count({ where: { description: { not: null } } }),
    prisma.concert.count({ where: { imageUrl: { not: null } } }),
    prisma.concert.count({ where: { source: { not: null } } }),
    prisma.artist.count(),
    prisma.artist.count({ where: { koreanName: { not: null } } }),
    prisma.artist.count({ where: { company: { not: null } } }),
    prisma.artist.count({ where: { description: { not: null } } }),
    prisma.artist.count({ where: { image: { not: null } } }),
    prisma.artist.count({ where: { debutDate: { not: null } } }),
    prisma.venue.count(),
    prisma.venue.count({ where: { state: { not: null } } }),
    prisma.venue.count({ where: { latitude: { not: null }, longitude: { not: null } } }),
    prisma.venue.count({ where: { capacity: { not: null } } }),
    prisma.venue.count({ where: { type: { not: null } } }),
    prisma.venue.count({ where: { address: { not: null } } }),
  ]);

  return {
    concert: {
      total: totalConcerts,
      fields: [
        { label: "tourName", filled: concertsWithTourName },
        { label: "endDate", filled: concertsWithEndDate },
        { label: "doorsOpen", filled: concertsWithDoorsOpen },
        { label: "ticketUrl", filled: concertsWithTicketUrl },
        { label: "description", filled: concertsWithDescription },
        { label: "imageUrl", filled: concertsWithImageUrl },
        { label: "source", filled: concertsWithSource },
      ],
    },
    artist: {
      total: totalArtists,
      fields: [
        { label: "koreanName", filled: artistsWithKoreanName },
        { label: "company", filled: artistsWithCompany },
        { label: "description", filled: artistsWithDescription },
        { label: "image", filled: artistsWithImage },
        { label: "debutDate", filled: artistsWithDebutDate },
      ],
    },
    venue: {
      total: totalVenues,
      fields: [
        { label: "state", filled: venuesWithState },
        { label: "lat/lng", filled: venuesWithLatLng },
        { label: "capacity", filled: venuesWithCapacity },
        { label: "type", filled: venuesWithType },
        { label: "address", filled: venuesWithAddress },
      ],
    },
  };
}

function pct(filled: number, total: number): number {
  return total > 0 ? Math.round((filled / total) * 1000) / 10 : 0;
}

function pctColor(value: number): string {
  if (value >= 90) return "text-green-600 dark:text-green-400";
  if (value >= 70) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function formatDate(d: Date | null): string {
  if (!d) return "--";
  return d.toISOString().replace("T", " ").slice(0, 16);
}

export default async function DatabasePage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string; page?: string }>;
}) {
  const params = await searchParams;
  const selectedModel = (params.model || "user") as ModelKey;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 25;

  const modelInfo = MODELS.find((m) => m.key === selectedModel);
  if (!modelInfo) {
    return <p className="text-red-600">Invalid model selected.</p>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[selectedModel];

  const [records, total, allModelStats, completeness] = await Promise.all([
    delegate.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    delegate.count(),
    Promise.all(MODELS.map((m) => getModelStats(m.key).then((s) => ({ key: m.key, label: m.label, ...s })))),
    getFieldCompleteness(),
  ]);

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
              href={`/admin/database?model=${s.key}`}
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
                    <span>new: {s.newest.toISOString().slice(0, 10)}</span>
                    <br />
                    <span>old: {s.oldest?.toISOString().slice(0, 10)}</span>
                  </>
                ) : (
                  <span>no records</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Field completeness for key models */}
      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
          Field Completeness
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {(["concert", "artist", "venue"] as const).map((modelName) => {
            const data = completeness[modelName];
            return (
              <div
                key={modelName}
                className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
              >
                <div className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {modelName} ({data.total})
                  </span>
                </div>
                <div className="px-2 py-1">
                  {data.fields.map((f) => {
                    const p = pct(f.filled, data.total);
                    return (
                      <div
                        key={f.label}
                        className="flex items-center justify-between py-0.5 text-[11px] font-mono"
                      >
                        <span className="text-gray-500 dark:text-gray-400">
                          {f.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 dark:text-gray-500">
                            {f.filled}/{data.total}
                          </span>
                          <span className={`font-semibold w-12 text-right ${pctColor(p)}`}>
                            {p}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Model selector tabs */}
      <div className="flex flex-wrap gap-1">
        {MODELS.map((m) => {
          const stat = allModelStats.find((s) => s.key === m.key);
          return (
            <Link
              key={m.key}
              href={`/admin/database?model=${m.key}`}
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
                      {record[col] instanceof Date
                        ? formatDate(record[col] as Date)
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
              href={`/admin/database?model=${selectedModel}&page=${page - 1}`}
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
              href={`/admin/database?model=${selectedModel}&page=${page + 1}`}
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
