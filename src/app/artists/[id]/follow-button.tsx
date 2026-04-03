"use client";

import { useEffect, useState } from "react";

export default function FollowButton({
  artistId,
  loggedIn,
}: {
  artistId: string;
  loggedIn: boolean;
}) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/artists/${artistId}/follow`)
      .then((res) => res.json())
      .then((data) => {
        setFollowerCount(data.followerCount);
        setIsFollowing(data.isFollowing);
      });
  }, [artistId]);

  async function handleToggle() {
    if (!loggedIn || loading) return;
    setLoading(true);

    const wasFollowing = isFollowing;
    const prevCount = followerCount;

    // Optimistic update
    setIsFollowing(!wasFollowing);
    setFollowerCount(wasFollowing ? Math.max(0, prevCount - 1) : prevCount + 1);

    try {
      const res = await fetch(`/api/artists/${artistId}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
      });

      if (!res.ok) {
        setIsFollowing(wasFollowing);
        setFollowerCount(prevCount);
      }
    } catch {
      setIsFollowing(wasFollowing);
      setFollowerCount(prevCount);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleToggle}
        disabled={loading || !loggedIn}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
          isFollowing
            ? "bg-purple-600 text-white shadow-md hover:bg-purple-700"
            : "border border-gray-300 text-gray-700 hover:border-purple-400 hover:text-purple-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-purple-500 dark:hover:text-purple-400"
        } disabled:opacity-50`}
      >
        {isFollowing ? "Following" : "Follow"}
      </button>
      <span className="text-sm text-gray-500 dark:text-gray-400">
        {followerCount} {followerCount === 1 ? "follower" : "followers"}
      </span>
      {!loggedIn && (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          <a
            href="/login"
            className="text-purple-600 hover:underline dark:text-purple-400"
          >
            Sign in
          </a>{" "}
          to follow
        </span>
      )}
    </div>
  );
}
