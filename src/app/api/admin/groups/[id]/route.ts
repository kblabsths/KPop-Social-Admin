import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase";

const ALLOWED_FIELDS = new Set([
  "name", "korean_name", "short_name", "company", "status", "type", "member_count", "debut_date",
  "image_url", "bio",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { field, value } = body as { field: string; value: string | number | null };

  if (!ALLOWED_FIELDS.has(field)) {
    return NextResponse.json({ error: "Field not editable" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("groups")
    .update({ [field]: value === "" ? null : value })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
