import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import Navbar from "@/app/components/navbar";
import NotificationsClient from "./notifications-client";

const PAGE_SIZE = 20;

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id;
  const supabase = getSupabaseAdmin();

  const [{ data: notifications, count: total }] = await Promise.all([
    supabase
      .from("web_notifications")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
  ]);

  const serialized = (notifications ?? []).map((n) => ({
    id: n.id as string,
    type: n.type as "new_concert" | "group_post" | "concert_reminder" | "new_follower",
    title: n.title as string,
    body: n.body as string,
    link: n.link as string,
    read: n.read as boolean,
    createdAt: n.created_at as string,
  }));

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-purple-50 to-pink-50 dark:from-gray-950 dark:to-purple-950">
      <Navbar />
      <main className="flex-1">
        <NotificationsClient
          userId={userId}
          initialNotifications={serialized}
          initialTotal={total ?? 0}
        />
      </main>
    </div>
  );
}
