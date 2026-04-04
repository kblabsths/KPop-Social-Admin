import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { error } = await requireAdmin();
  if (error) return error;

  const [usersResult, artistsResult, venuesResult, concertsResult, scraperRunsResult, activeAlertsResult] =
    await Promise.all([
      supabase.from("web_users").select("*", { count: "exact", head: true }),
      supabase.from("artists").select("*", { count: "exact", head: true }),
      supabase.from("venues").select("*", { count: "exact", head: true }),
      supabase.from("concerts").select("*", { count: "exact", head: true }),
      supabase.from("scraper_runs").select("*", { count: "exact", head: true }),
      supabase.from("data_quality_alerts").select("*", { count: "exact", head: true }).is("resolved_at", null),
    ]);

  return Response.json({
    users: usersResult.count ?? 0,
    artists: artistsResult.count ?? 0,
    venues: venuesResult.count ?? 0,
    concerts: concertsResult.count ?? 0,
    scraperRuns: scraperRunsResult.count ?? 0,
    activeAlerts: activeAlertsResult.count ?? 0,
  });
}
