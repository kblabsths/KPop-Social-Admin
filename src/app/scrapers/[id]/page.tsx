import { getSupabaseAdmin } from "@/lib/supabase";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default async function ScraperRunDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const { data: run } = await supabase
    .from("scraper_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!run) notFound();

  const duration =
    run.completed_at
      ? `${Math.floor((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
      : "Running...";

  // error_log is a jsonb array of {message, step, timestamp, source_event_id?}
  const errorLog: Array<{ message: string; step?: string; timestamp?: string; source_event_id?: string | null }> =
    Array.isArray(run.error_log) ? run.error_log : [];

  return (
    <div>
      <Link
        href="/scrapers"
        className="text-sm text-purple-600 hover:underline dark:text-purple-400 mb-4 inline-block"
      >
        &larr; Back to Scraper Runs
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {run.source}
        </h1>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[run.status] || ""}`}
        >
          {run.status}
        </span>
        <span className="text-xs text-gray-400 font-mono">{run.scrape_mode}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Started</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {new Date(run.started_at).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Duration</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {duration}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Events New</p>
          <p className="text-sm font-medium text-green-600">{run.events_new}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Events Updated</p>
          <p className="text-sm font-medium text-blue-600">{run.events_updated}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Events Found</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{run.events_found}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Events Parsed</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{run.events_parsed}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Events Skipped</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{run.events_skipped}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500">Events Errored</p>
          <p className={`text-sm font-medium ${run.events_errored > 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
            {run.events_errored}
          </p>
        </div>
      </div>

      {run.errors > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-800 dark:text-red-200">
            <strong>{run.errors}</strong> error{run.errors !== 1 ? "s" : ""} recorded
          </p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <h2 className="border-b border-gray-200 px-4 py-3 text-lg font-semibold text-gray-900 dark:border-gray-800 dark:text-white">
          Error Log ({errorLog.length})
        </h2>
        {errorLog.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No error log entries.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto p-4 font-mono text-xs">
            {errorLog.map((entry, i) => (
              <div key={i} className="flex gap-3 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
                {entry.timestamp && (
                  <span className="shrink-0 text-gray-400">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                )}
                {entry.step && (
                  <span className="shrink-0 w-20 font-bold text-yellow-600 dark:text-yellow-400">
                    {entry.step}
                  </span>
                )}
                <span className="text-red-700 dark:text-red-300 break-all">
                  {entry.message}
                </span>
                {entry.source_event_id && (
                  <span className="shrink-0 text-gray-400">({entry.source_event_id})</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
