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

export default async function DatabasePage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string; page?: string }>;
}) {
  const params = await searchParams;
  const selectedModel = params.model || "user";
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;

  const modelInfo = MODELS.find((m) => m.key === selectedModel);
  if (!modelInfo) {
    return <p className="text-red-600">Invalid model selected.</p>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[selectedModel];
  const [records, total] = await Promise.all([
    delegate.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    delegate.count(),
  ]);

  const totalPages = Math.ceil(total / pageSize);
  const columns =
    records.length > 0
      ? Object.keys(records[0]).filter(
          (k) => typeof records[0][k] !== "object" || records[0][k] === null
        )
      : [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Database Browser
      </h1>

      <div className="flex flex-wrap gap-2 mb-4">
        {MODELS.map((m) => (
          <Link
            key={m.key}
            href={`/admin/database?model=${m.key}`}
            className={`rounded-md px-3 py-1.5 text-sm ${selectedModel === m.key ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
          >
            {m.label}
          </Link>
        ))}
      </div>

      <p className="text-sm text-gray-500 mb-3">
        {total} {modelInfo.label.toLowerCase()} total
      </p>

      {records.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-gray-500">No records found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap"
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
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-48 truncate whitespace-nowrap"
                      title={String(record[col] ?? "")}
                    >
                      {record[col] instanceof Date
                        ? (record[col] as Date).toLocaleString()
                        : String(record[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {page > 1 && (
            <Link
              href={`/admin/database?model=${selectedModel}&page=${page - 1}`}
              className="rounded-md bg-gray-100 px-3 py-1.5 text-sm dark:bg-gray-800"
            >
              Previous
            </Link>
          )}
          <span className="px-3 py-1.5 text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/database?model=${selectedModel}&page=${page + 1}`}
              className="rounded-md bg-gray-100 px-3 py-1.5 text-sm dark:bg-gray-800"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
