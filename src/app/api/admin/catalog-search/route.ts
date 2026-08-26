import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase";

// Typeahead for the review queue: search groups and idols by name.
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json([]);

  // Strip PostgREST .or() syntax chars and LIKE wildcards
  const term = q.replace(/[%_,()]/g, "");
  if (!term) return NextResponse.json([]);

  const supabase = getSupabaseAdmin();
  const [groupsResult, idolsResult] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, company")
      .or(`name.ilike.%${term}%,short_name.ilike.%${term}%,korean_name.ilike.%${term}%`)
      .limit(8),
    supabase
      .from("idols")
      .select("id, stage_name, group_id, groups(name)")
      .or(`stage_name.ilike.%${term}%,korean_name.ilike.%${term}%`)
      .limit(8),
  ]);

  if (groupsResult.error || idolsResult.error) {
    return NextResponse.json(
      { error: groupsResult.error?.message ?? idolsResult.error?.message },
      { status: 500 },
    );
  }

  const hits = [
    ...(groupsResult.data ?? []).map((g) => ({
      kind: "group" as const,
      id: g.id,
      name: g.name,
      sub: g.company ?? null,
    })),
    ...(idolsResult.data ?? []).map((i) => ({
      kind: "idol" as const,
      id: i.id,
      name: i.stage_name,
      // many-to-one embed comes back as an object at runtime
      sub: (i.groups as unknown as { name: string } | null)?.name ?? "soloist",
    })),
  ];

  return NextResponse.json(hits);
}
