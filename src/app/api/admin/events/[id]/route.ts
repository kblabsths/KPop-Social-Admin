import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase";

// Canonical events (events cutover, 2026-08-25): the editable scalars live on the
// events row. Performers and venue are links (event_performers / venues) and are
// not field-edited here.
const ALLOWED_FIELDS = new Set([
  "title", "event_type", "status", "description", "ticket_url", "poster_url",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { field, value } = body as { field: string; value: string | null };

  if (!ALLOWED_FIELDS.has(field)) {
    return NextResponse.json({ error: "Field not editable" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("events")
    .update({ [field]: value === "" ? null : value })
    .eq("event_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
