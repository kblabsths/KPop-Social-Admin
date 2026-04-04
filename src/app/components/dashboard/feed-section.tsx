"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PostCard from "@/app/components/post-card";

type Post = {
  id: string;
  content: string;
  imageUrl?: string | null;
  linkUrl?: string | null;
  createdAt: string;
  author: { id: string; name: string | null; image: string | null };
  group?: { id: string; name: string };
  _count: { replies: number; likes: number };
};

export default function FeedSection({ currentUserId }: { currentUserId: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feed")
      .then((r) => r.json())
      .then((data) => setPosts(Array.isArray(data) ? data.slice(0, 3) : []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Recent Feed
        </h2>
        <Link
          href="/groups"
          className="text-sm text-purple-600 hover:underline dark:text-purple-400"
        >
          Browse groups
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-1/3" />
                  <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-full" />
                  <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Join some{" "}
          <Link href="/groups" className="text-purple-600 hover:underline dark:text-purple-400">
            groups
          </Link>{" "}
          to see posts in your feed!
        </p>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              showGroup
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
