import { getSupabaseAdmin } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const severityColors: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  MEDIUM:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  LOW: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

const typeLabels: Record<string, string> = {
  MISSING_FIELD: "Missing Field",
  DUPLICATE: "Duplicate",
  STALE_DATA: "Stale Data",
  INCONSISTENCY: "Inconsistency",
};

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    severity?: string;
    resolved?: string;
    page?: string;
  }>;
}) {
  const supabase = getSupabaseAdmin();
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;
  const typeFilter = params.type;
  const severityFilter = params.severity;
  const resolvedFilter = params.resolved;

  let queryBuilder = supabase
    .from("data_quality_alerts")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (typeFilter) queryBuilder = queryBuilder.eq("alert_type", typeFilter);
  if (severityFilter) queryBuilder = queryBuilder.eq("severity", severityFilter);
  if (resolvedFilter === "true") queryBuilder = queryBuilder.not("resolved_at", "is", null);
  if (resolvedFilter === "false") queryBuilder = queryBuilder.is("resolved_at", null);

  const { data: alerts, count: total } = await queryBuilder;

  const totalPages = Math.ceil((total ?? 0) / pageSize);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Data Quality Alerts
      </h1>

      <div className="flex flex-wrap gap-2 mb-4">
        <Link
          href="/admin/alerts"
          className={`rounded-md px-3 py-1.5 text-sm ${!resolvedFilter ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
        >
          All
        </Link>
        <Link
          href="/admin/alerts?resolved=false"
          className={`rounded-md px-3 py-1.5 text-sm ${resolvedFilter === "false" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
        >
          Active
        </Link>
        <Link
          href="/admin/alerts?resolved=true"
          className={`rounded-md px-3 py-1.5 text-sm ${resolvedFilter === "true" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
        >
          Resolved
        </Link>
      </div>

      {(alerts ?? []).length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-gray-500">No alerts found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(alerts ?? []).map((alert) => (
            <div
              key={alert.id}
              className={`rounded-lg border bg-white p-4 dark:bg-gray-900 ${alert.resolved_at ? "border-gray-200 dark:border-gray-800 opacity-60" : "border-gray-200 dark:border-gray-800"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityColors[alert.severity] || ""}`}
                    >
                      {alert.severity}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {typeLabels[alert.alert_type] || alert.alert_type}
                    </span>
                    {alert.resolved_at && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                        Resolved
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {alert.message}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {alert.entity_type}:{alert.entity_id} &middot;{" "}
                    {new Date(alert.created_at).toLocaleString()}
                  </p>
                </div>
                {!alert.resolved_at && (
                  <form
                    action={async () => {
                      "use server";
                      const { error } = await requireAdmin();
                      if (error) throw new Error("Unauthorized");
                      const supabaseAdmin = getSupabaseAdmin();
                      await supabaseAdmin
                        .from("data_quality_alerts")
                        .update({ resolved_at: new Date().toISOString() })
                        .eq("id", alert.id);
                      revalidatePath("/admin/alerts");
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-800"
                    >
                      Resolve
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {page > 1 && (
            <Link
              href={`/admin/alerts?page=${page - 1}${typeFilter ? `&type=${typeFilter}` : ""}${severityFilter ? `&severity=${severityFilter}` : ""}${resolvedFilter ? `&resolved=${resolvedFilter}` : ""}`}
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
              href={`/admin/alerts?page=${page + 1}${typeFilter ? `&type=${typeFilter}` : ""}${severityFilter ? `&severity=${severityFilter}` : ""}${resolvedFilter ? `&resolved=${resolvedFilter}` : ""}`}
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
