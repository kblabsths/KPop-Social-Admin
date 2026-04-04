"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Notification = {
  id: string;
  type: "new_concert" | "group_post" | "concert_reminder" | "new_follower";
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
};

const TYPE_ICON: Record<Notification["type"], string> = {
  new_concert: "🎤",
  group_post: "💬",
  concert_reminder: "🔔",
  new_follower: "👤",
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const PAGE_SIZE = 20;

export default function NotificationsClient({
  userId,
  initialNotifications,
  initialTotal,
}: {
  userId: string;
  initialNotifications: Notification[];
  initialTotal: number;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [total, setTotal] = useState(initialTotal);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const hasMore = notifications.length < total;

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/users/${userId}/notifications?limit=${PAGE_SIZE}&offset=${notifications.length}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setNotifications((prev) => [...prev, ...(data.notifications ?? [])]);
      setTotal(data.total ?? total);
    } finally {
      setLoadingMore(false);
    }
  }, [userId, notifications.length, total]);

  const handleMarkAllRead = useCallback(async () => {
    setMarkingAll(true);
    try {
      const res = await fetch(`/api/users/${userId}/notifications/mark-all-read`, {
        method: "POST",
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      }
    } finally {
      setMarkingAll(false);
    }
  }, [userId]);

  const handleMarkRead = useCallback(
    async (n: Notification) => {
      if (n.read) {
        router.push(n.link);
        return;
      }
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
      );
      fetch(`/api/users/${userId}/notifications/${n.id}`, { method: "PATCH" }).catch(
        () => {}
      );
      router.push(n.link);
    },
    [userId, router]
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Notifications
          </h1>
          {unreadCount > 0 && (
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {unreadCount} unread
            </p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {markingAll ? "Marking…" : "Mark all as read"}
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-8 py-16 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-4xl">🔔</p>
          <p className="mt-3 text-lg font-medium text-gray-900 dark:text-white">
            You have no notifications
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            When something happens — a new concert, follower, or group post — you'll see
            it here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {notifications.map((n, i) => (
            <button
              key={n.id}
              onClick={() => handleMarkRead(n)}
              className={`flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800 ${
                i < notifications.length - 1
                  ? "border-b border-gray-100 dark:border-gray-800"
                  : ""
              } ${!n.read ? "bg-purple-50/50 dark:bg-purple-950/20" : ""}`}
            >
              <span className="mt-0.5 flex-shrink-0 text-xl leading-none">
                {TYPE_ICON[n.type] ?? "🔔"}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm ${
                    n.read
                      ? "text-gray-700 dark:text-gray-300"
                      : "font-semibold text-gray-900 dark:text-white"
                  }`}
                >
                  {n.title}
                </p>
                {n.body && (
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {n.body}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {formatTimeAgo(n.createdAt)}
                </p>
              </div>
              {!n.read && (
                <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-purple-500" />
              )}
            </button>
          ))}

          {hasMore && (
            <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full rounded-lg bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                {loadingMore ? "Loading…" : `Load more (${total - notifications.length} remaining)`}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 text-center">
        <Link
          href="/"
          className="text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
