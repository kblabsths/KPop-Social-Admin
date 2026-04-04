import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;
  const session = await auth();

  const { data: group, error } = await supabase
    .from("groups")
    .select(`
      *,
      artist:artists(*),
      created_by:web_users!groups_created_by_id_fkey(id, name, image),
      members:group_members(*, user:web_users(id, name, image)),
      member_count:group_members(count)
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (!group) {
    return Response.json({ error: "Group not found" }, { status: 404 });
  }

  // Sort members by joined_at asc
  const members = ((group.members as { joined_at: string; user_id: string; user: unknown; role: string }[]) ?? [])
    .sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime());

  const isMember = session?.user?.id
    ? members.some((m) => m.user_id === session.user!.id)
    : false;

  const result = {
    ...group,
    members,
    _count: { members: (group.member_count as { count: number }[])?.[0]?.count ?? 0 },
    member_count: undefined,
    isMember,
  };

  return Response.json(result);
}
