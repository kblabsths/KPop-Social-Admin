import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Navbar from "@/app/components/navbar";
import NotificationsClient from "./notifications-client";

const PAGE_SIZE = 20;

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);

  const serialized = notifications.map((n) => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-purple-50 to-pink-50 dark:from-gray-950 dark:to-purple-950">
      <Navbar />
      <main className="flex-1">
        <NotificationsClient
          userId={userId}
          initialNotifications={serialized}
          initialTotal={total}
        />
      </main>
    </div>
  );
}
