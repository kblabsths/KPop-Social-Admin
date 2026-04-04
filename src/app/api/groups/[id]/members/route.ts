import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { data: group } = await supabase
    .from("groups")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!group) {
    return Response.json({ error: "Group not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("group_members")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("group_id", id)
    .maybeSingle();

  if (existing) {
    return Response.json({ error: "Already a member" }, { status: 409 });
  }

  const { data: member, error } = await supabase
    .from("group_members")
    .insert({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      group_id: id,
    })
    .select("*, user:web_users(id, name, image)")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(member, { status: 201 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("group_id", id)
    .maybeSingle();

  if (!membership) {
    return Response.json({ error: "Not a member" }, { status: 404 });
  }

  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("id", membership.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
