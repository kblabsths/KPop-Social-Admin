import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Creates a notification for a user when a followed artist has a new concert.
 * Fire-and-forget — do not await in the request path.
 */
export async function createConcertNotification(
  userId: string,
  concertId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: concert } = await supabase
    .from("concerts")
    .select("title")
    .eq("id", concertId)
    .maybeSingle();
  if (!concert) return;

  await supabase.from("web_notifications").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    type: "new_concert",
    title: "New concert announced",
    body: concert.title,
    link: `/concerts/${concertId}`,
  });
}

/**
 * Creates a notification for all group members when someone posts in a group.
 * Skips the post author. Fire-and-forget — do not await in the request path.
 */
export async function createGroupPostNotification(
  authorId: string,
  groupId: string,
  postId: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const [{ data: group }, { data: members }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", groupId).maybeSingle(),
    supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .neq("user_id", authorId),
  ]);

  if (!group || !members || members.length === 0) return;

  await supabase.from("web_notifications").insert(
    members.map(({ user_id }) => ({
      id: crypto.randomUUID(),
      user_id,
      type: "group_post",
      title: `New post in ${group.name}`,
      body: "Someone posted in a group you belong to.",
      link: `/groups/${groupId}/posts/${postId}`,
    }))
  );
}
