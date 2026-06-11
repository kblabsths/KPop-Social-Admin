import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { error } = await requireAdmin();
  if (error) return error;

  // Counts come from the tables that exist in the shared Supabase project
  // (the catalog is groups/idols; app users live in profiles).
  const [usersResult, groupsResult, idolsResult, venuesResult, eventsResult, scraperRunsResult] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("groups").select("*", { count: "exact", head: true }),
      supabase.from("idols").select("*", { count: "exact", head: true }),
      supabase.from("venues").select("*", { count: "exact", head: true }),
      supabase.from("events").select("*", { count: "exact", head: true }),
      supabase.from("scraper_runs").select("*", { count: "exact", head: true }),
    ]);

  return Response.json({
    users: usersResult.count ?? 0,
    groups: groupsResult.count ?? 0,
    idols: idolsResult.count ?? 0,
    venues: venuesResult.count ?? 0,
    events: eventsResult.count ?? 0,
    scraperRuns: scraperRunsResult.count ?? 0,
  });
}
