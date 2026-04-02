import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

const statusColors: Record<string, string> = {
  RUNNING: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SUCCESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  PARTIAL:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

const logLevelColors: Record<string, string> = {
  INFO: "text-gray-500",
  WARN: "text-yellow-600 dark:text-yellow-400",
  ERROR: "text-red-600 dark:text-red-400",
};

export default async function ScraperRunDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const run = await prisma.scraperRun.findUnique({
    where: { id },
    include: {
      logs: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!run) notFound();

  const duration =
    run.finishedAt
      ? `${Math.floor((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)}s`
      : "Running...";

  return (
    <div>
      <Link
        href="/admin/scrapers"
        className="text-sm text-purple-600 hover:underline dark:text-purple-400 mb-4 inline-block"
      >
        &larr; Back to Scraper Runs
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {run.scraperName}
        </h1>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[run.status] || ""}`}
        >
          {run.status}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Started</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {run.startedAt.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Duration</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {duration}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Records Created</p>
          <p className="text-sm font-medium text-green-600">{run.recordsCreated}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Records Updated</p>
          <p className="text-sm font-medium text-blue-600">{run.recordsUpdated}</p>
        </div>
      </div>

      {run.recordsFailed > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-800 dark:text-red-200">
            <strong>{run.recordsFailed}</strong> records failed
          </p>
          {run.errorMessage && (
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              {run.errorMessage}
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <h2 className="border-b border-gray-200 px-4 py-3 text-lg font-semibold text-gray-900 dark:border-gray-800 dark:text-white">
          Logs ({run.logs.length})
        </h2>
        {run.logs.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No log entries.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto p-4 font-mono text-xs">
            {run.logs.map((log) => (
              <div key={log.id} className="flex gap-3 py-1">
                <span className="shrink-0 text-gray-400">
                  {log.createdAt.toLocaleTimeString()}
                </span>
                <span
                  className={`shrink-0 w-12 font-bold ${logLevelColors[log.level] || ""}`}
                >
                  {log.level}
                </span>
                <span className="text-gray-700 dark:text-gray-300 break-all">
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
