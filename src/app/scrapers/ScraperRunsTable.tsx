"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

const statusBadgeColors: Record<string, string> = {
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function formatDuration(start: string, end: string | null | undefined) {
  if (!end) return "Running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

type ScraperRun = {
  id: string;
  source: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  events_new: number;
  events_updated: number;
  events_errored: number;
  errors: number;
};

export function ScraperRunsTable({ runs }: { runs: ScraperRun[] }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-left">
            <th className="px-2 py-1.5 font-medium">Source</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
            <th className="px-2 py-1.5 font-medium">Started</th>
            <th className="px-2 py-1.5 font-medium">Duration</th>
            <th className="px-2 py-1.5 font-medium text-right">New</th>
            <th className="px-2 py-1.5 font-medium text-right">Updated</th>
            <th className="px-2 py-1.5 font-medium text-right">Errored</th>
            <th className="px-2 py-1.5 font-medium">Errors</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              onClick={() => router.push(`/scrapers/${run.id}`)}
              className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              <td className="px-2 py-1.5">
                <Link
                  href={`/scrapers/${run.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-purple-600 hover:underline dark:text-purple-400"
                >
                  {run.source}
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
                {new Date(run.started_at).toISOString().replace("T", " ").slice(0, 16)}
              </td>
              <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                {formatDuration(run.started_at, run.completed_at)}
              </td>
              <td className="px-2 py-1.5 text-right text-gray-500 dark:text-gray-400">
                {run.events_new}
              </td>
              <td className="px-2 py-1.5 text-right text-gray-500 dark:text-gray-400">
                {run.events_updated}
              </td>
              <td className="px-2 py-1.5 text-right text-gray-500 dark:text-gray-400">
                {run.events_errored > 0 ? (
                  <span className="text-red-600 dark:text-red-400">{run.events_errored}</span>
                ) : (
                  run.events_errored
                )}
              </td>
              <td className="px-2 py-1.5 max-w-48 truncate">
                {run.errors > 0 ? (
                  <span className="text-red-600 dark:text-red-400">
                    {run.errors} error{run.errors !== 1 ? "s" : ""}
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
  );
}
