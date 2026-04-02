import { prisma } from "@/lib/prisma";
import Link from "next/link";

const statusColors: Record<string, string> = {
  RUNNING: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SUCCESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  PARTIAL:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

function formatDuration(start: Date, end: Date | null) {
  if (!end) return "Running...";
  const ms = end.getTime() - start.getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

export default async function ScrapersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;
  const statusFilter = params.status || undefined;

  const where = statusFilter
    ? { status: statusFilter as "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL" }
    : {};

  const [runs, total] = await Promise.all([
    prisma.scraperRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.scraperRun.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Scraper Runs
      </h1>

      <div className="flex gap-2 mb-4">
        <Link
          href="/admin/scrapers"
          className={`rounded-md px-3 py-1.5 text-sm ${!statusFilter ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
        >
          All
        </Link>
        {["RUNNING", "SUCCESS", "FAILED", "PARTIAL"].map((s) => (
          <Link
            key={s}
            href={`/admin/scrapers?status=${s}`}
            className={`rounded-md px-3 py-1.5 text-sm ${statusFilter === s ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
          >
            {s}
          </Link>
        ))}
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-gray-500">No scraper runs yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Name
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Started
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Duration
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">
                  Created
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">
                  Updated
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">
                  Failed
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/scrapers/${run.id}`}
                      className="font-medium text-purple-600 hover:underline dark:text-purple-400"
                    >
                      {run.scraperName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[run.status] || ""}`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {run.startedAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {formatDuration(run.startedAt, run.finishedAt)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {run.recordsCreated}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {run.recordsUpdated}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {run.recordsFailed}
                  </td>
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
              href={`/admin/scrapers?page=${page - 1}${statusFilter ? `&status=${statusFilter}` : ""}`}
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
              href={`/admin/scrapers?page=${page + 1}${statusFilter ? `&status=${statusFilter}` : ""}`}
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
