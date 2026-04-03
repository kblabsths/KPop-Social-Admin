import { prisma } from "@/lib/prisma";
import Link from "next/link";

const statusColors: Record<string, string> = {
  RUNNING: "text-blue-600 dark:text-blue-400",
  SUCCESS: "text-green-600 dark:text-green-400",
  FAILED: "text-red-600 dark:text-red-400",
  PARTIAL: "text-yellow-600 dark:text-yellow-400",
};

const statusBadgeColors: Record<string, string> = {
  RUNNING: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SUCCESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  PARTIAL: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

function formatDuration(start: Date, end: Date | null) {
  if (!end) return "Running...";
  const ms = end.getTime() - start.getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function formatAvgDuration(ms: number): string {
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
  const pageSize = 25;
  const statusFilter = params.status || undefined;

  const where = statusFilter
    ? { status: statusFilter as "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL" }
    : {};

  const [runs, total, totalAllRuns, successCount, failedCount, lastSuccess, completedRuns] =
    await Promise.all([
      prisma.scraperRun.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.scraperRun.count({ where }),
      prisma.scraperRun.count(),
      prisma.scraperRun.count({ where: { status: "SUCCESS" } }),
      prisma.scraperRun.count({ where: { status: "FAILED" } }),
      prisma.scraperRun.findFirst({
        where: { status: "SUCCESS" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
      prisma.scraperRun.findMany({
        where: { finishedAt: { not: null } },
        select: { startedAt: true, finishedAt: true },
        orderBy: { startedAt: "desc" },
        take: 100,
      }),
    ]);

  const totalPages = Math.ceil(total / pageSize);

  // Compute average duration from completed runs
  const durations = completedRuns
    .filter((r) => r.finishedAt)
    .map((r) => r.finishedAt!.getTime() - r.startedAt.getTime());
  const avgDurationMs =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

  const successRate =
    totalAllRuns > 0
      ? Math.round((successCount / totalAllRuns) * 1000) / 10
      : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Scraper Runs
      </h1>

      {/* Aggregate stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
        <StatCard label="Total Runs" value={totalAllRuns.toLocaleString()} />
        <StatCard
          label="Success Rate"
          value={`${successRate}%`}
          color={
            successRate >= 90
              ? "text-green-600 dark:text-green-400"
              : successRate >= 70
                ? "text-yellow-600 dark:text-yellow-400"
                : "text-red-600 dark:text-red-400"
          }
        />
        <StatCard
          label="Avg Duration"
          value={avgDurationMs > 0 ? formatAvgDuration(avgDurationMs) : "--"}
        />
        <StatCard
          label="Failed"
          value={failedCount.toString()}
          color={
            failedCount > 0
              ? "text-red-600 dark:text-red-400"
              : "text-gray-600 dark:text-gray-400"
          }
        />
        <StatCard
          label="Last Success"
          value={
            lastSuccess?.finishedAt
              ? lastSuccess.finishedAt.toISOString().replace("T", " ").slice(0, 16)
              : "--"
          }
        />
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1">
        <Link
          href="/admin/scrapers"
          className={`rounded px-2 py-1 text-[11px] font-mono ${
            !statusFilter
              ? "bg-purple-600 text-white"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          All ({totalAllRuns})
        </Link>
        {(["RUNNING", "SUCCESS", "FAILED", "PARTIAL"] as const).map((s) => (
          <Link
            key={s}
            href={`/admin/scrapers?status=${s}`}
            className={`rounded px-2 py-1 text-[11px] font-mono ${
              statusFilter === s
                ? "bg-purple-600 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <p className="text-[11px] font-mono text-gray-400">
        {total} runs{statusFilter ? ` (${statusFilter})` : ""} &middot; page {page}/{totalPages || 1}
      </p>

      {/* Runs table */}
      {runs.length === 0 ? (
        <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-6 text-center">
          <p className="text-xs text-gray-400 font-mono">No scraper runs found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-left">
                <th className="px-2 py-1.5 font-medium">Name</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 font-medium">Started</th>
                <th className="px-2 py-1.5 font-medium">Duration</th>
                <th className="px-2 py-1.5 font-medium text-right">Created</th>
                <th className="px-2 py-1.5 font-medium text-right">Updated</th>
                <th className="px-2 py-1.5 font-medium text-right">Failed</th>
                <th className="px-2 py-1.5 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/admin/scrapers/${run.id}`}
                      className="font-medium text-purple-600 hover:underline dark:text-purple-400"
                    >
                      {run.scraperName}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeColors[run.status] || ""}`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                    {run.startedAt.toISOString().replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                    {formatDuration(run.startedAt, run.finishedAt)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-500 dark:text-gray-400">
                    {run.recordsCreated}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-500 dark:text-gray-400">
                    {run.recordsUpdated}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-500 dark:text-gray-400">
                    {run.recordsFailed > 0 ? (
                      <span className="text-red-600 dark:text-red-400">{run.recordsFailed}</span>
                    ) : (
                      run.recordsFailed
                    )}
                  </td>
                  <td className="px-2 py-1.5 max-w-48 truncate text-red-500 dark:text-red-400">
                    {run.errorMessage ? (
                      <span title={run.errorMessage}>
                        {run.errorMessage.slice(0, 60)}{run.errorMessage.length > 60 ? "..." : ""}
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-700">--</span>
                    )}
                  </td>
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
              href={`/admin/scrapers?page=${page - 1}${statusFilter ? `&status=${statusFilter}` : ""}`}
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
              href={`/admin/scrapers?page=${page + 1}${statusFilter ? `&status=${statusFilter}` : ""}`}
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
      <p
        className={`text-sm font-bold font-mono ${
          color ?? "text-gray-800 dark:text-gray-200"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
