import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";
import type { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { data: alert } = await supabase
    .from("data_quality_alerts")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!alert) {
    return Response.json({ error: "Alert not found" }, { status: 404 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("data_quality_alerts")
    .update({
      resolved_at: body.resolved ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  return Response.json(updated);
}
