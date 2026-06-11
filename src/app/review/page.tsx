import { getSupabaseAdmin } from "@/lib/supabase";
import { ReviewActions } from "./ReviewActions";

// Scraped events the reconciler could not match to a catalog group/idol
// (scraped_events.status = 'needs_review'). Linking one sets
// matched_group_id/matched_idol_id and flips it back to 'pending'; the next
// reconciler run promotes it using the admin-set link. Skipping marks it
// 'skipped' permanently.
export default async function ReviewQueuePage() {
  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from("scraped_events")
    .select("id, source, title, artist, venue, city, country, date")
    .eq("status", "needs_review")
    .order("date", { ascending: true })
    .limit(200);

  if (error) {
    return (
      <p className="text-xs font-mono text-red-600">
        Failed to load review queue: {error.message}
      </p>
    );
  }

  const queue = rows ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Review Queue
      </h1>
      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">
        {queue.length} scraped event{queue.length === 1 ? "" : "s"} with no
        catalog match. Link to the correct artist (promoted on the next
        reconciler run, nightly 04:30 UTC) or skip non-catalog events
        (tributes, multi-artist showcases, non-K-Pop).
      </p>

      {queue.length === 0 ? (
        <div className="border border-gray-300 dark:border-gray-700 px-3 py-6 text-center text-xs font-mono text-gray-400">
          Queue is empty — every scraped event is matched. ✓
        </div>
      ) : (
        <div className="border border-gray-300 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-800">
          {queue.map((e) => (
            <div key={e.id} className="px-3 py-2 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-900">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-semibold text-gray-800 dark:text-gray-200">{e.title}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  artist: “{e.artist || "—"}”
                </span>
                <span className="text-gray-400 dark:text-gray-500">
                  {[e.venue, e.city, e.country].filter(Boolean).join(", ")}
                </span>
                <span className="text-gray-400 dark:text-gray-500">
                  {e.date ? new Date(e.date).toISOString().slice(0, 10) : "—"}
                </span>
                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {e.source}
                </span>
              </div>
              <ReviewActions id={e.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
