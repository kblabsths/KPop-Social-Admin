import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const artistId = searchParams.get("artistId") || undefined;

  let queryBuilder = supabase
    .from("groups")
    .select("*, artist:artists(id, name, image), member_count:group_members(count)")
    .order("created_at", { ascending: false });

  if (query) queryBuilder = queryBuilder.ilike("name", `%${query}%`);
  if (artistId) queryBuilder = queryBuilder.eq("artist_id", artistId);

  const { data: groups, error } = await queryBuilder;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Flatten member count
  const result = (groups ?? []).map((g) => ({
    ...g,
    _count: { members: (g.member_count as { count: number }[])?.[0]?.count ?? 0 },
    member_count: undefined,
  }));

  return Response.json(result);
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, artistId, image } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }

  const groupId = crypto.randomUUID();

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({
      id: groupId,
      name: name.trim(),
      description: description || null,
      image: image || null,
      artist_id: artistId || null,
      created_by_id: session.user.id,
    })
    .select()
    .single();

  if (groupError) return Response.json({ error: groupError.message }, { status: 500 });

  // Add creator as admin member
  await supabase.from("group_members").insert({
    id: crypto.randomUUID(),
    user_id: session.user.id,
    group_id: groupId,
    role: "admin",
  });

  // Fetch with artist relation
  const { data: fullGroup } = await supabase
    .from("groups")
    .select("*, artist:artists(id, name), member_count:group_members(count)")
    .eq("id", groupId)
    .single();

  const result = fullGroup
    ? {
        ...fullGroup,
        _count: { members: (fullGroup.member_count as { count: number }[])?.[0]?.count ?? 0 },
        member_count: undefined,
      }
    : group;

  return Response.json(result, { status: 201 });
}
