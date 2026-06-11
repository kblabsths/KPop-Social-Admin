import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase";

// Resolve a needs_review scraped event:
//   { action: "link", kind: "group"|"idol", catalogId } — set the match and
//     flip the row back to 'pending'; the reconciler promotes it next run.
//   { action: "skip" } — mark 'skipped' (not a catalog event).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { action?: string; kind?: string; catalogId?: string }
    | null;

  if (!body || !["link", "skip"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "action must be 'link' or 'skip'" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  let update: Record<string, unknown>;
  if (body.action === "skip") {
    update = { status: "skipped" };
  } else {
    if (!body.catalogId || !["group", "idol"].includes(body.kind ?? "")) {
      return NextResponse.json(
        { error: "link requires kind ('group'|'idol') and catalogId" },
        { status: 400 },
      );
    }
    // Validate the catalog row exists before linking
    const table = body.kind === "group" ? "groups" : "idols";
    const { data: target, error: targetErr } = await supabase
      .from(table)
      .select("id")
      .eq("id", body.catalogId)
      .maybeSingle();
    if (targetErr) return NextResponse.json({ error: targetErr.message }, { status: 500 });
    if (!target) return NextResponse.json({ error: `${body.kind} not found` }, { status: 404 });

    update = {
      matched_group_id: body.kind === "group" ? body.catalogId : null,
      matched_idol_id: body.kind === "idol" ? body.catalogId : null,
      status: "pending",
    };
  }

  const { data: updated, error: updateErr } = await supabase
    .from("scraped_events")
    .update(update)
    .eq("id", id)
    .eq("status", "needs_review")
    .select("id");

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "Event not found or no longer awaiting review" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
