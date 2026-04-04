import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; notificationId: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id, notificationId } = await params;

  const session = await auth();
  if (!session?.user?.id || session.user.id !== id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: notification } = await supabase
    .from("web_notifications")
    .select("id, user_id")
    .eq("id", notificationId)
    .maybeSingle();

  if (!notification) {
    return Response.json({ error: "Notification not found" }, { status: 404 });
  }

  if (notification.user_id !== id) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { data: updated, error } = await supabase
    .from("web_notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(updated);
}
