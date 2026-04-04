import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";
import type { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;

  const { data: run, error: runError } = await supabase
    .from("scraper_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (runError) return Response.json({ error: runError.message }, { status: 500 });

  if (!run) {
    return Response.json({ error: "Scraper run not found" }, { status: 404 });
  }

  // Fetch logs for this run ordered by created_at asc
  const { data: logs } = await supabase
    .from("scraper_logs")
    .select("*")
    .eq("scraper_run_id", id)
    .order("created_at", { ascending: true });

  return Response.json({ ...run, logs: logs ?? [] });
}
