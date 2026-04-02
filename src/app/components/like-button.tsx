"use client";

import { useState } from "react";

export default function LikeButton({
  postId,
  initialCount,
  loggedIn,
}: {
  postId: string;
  initialCount: number;
  loggedIn: boolean;
}) {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!loggedIn) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${postId}/likes`, {
        method: liked ? "DELETE" : "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setLiked(data.liked);
        setCount(data.count);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading || !loggedIn}
      className={`flex items-center gap-1 text-sm transition ${
        liked
          ? "text-pink-600 dark:text-pink-400"
          : "text-gray-500 hover:text-pink-600 dark:text-gray-400 dark:hover:text-pink-400"
      } disabled:opacity-50`}
    >
      <span>{liked ? "♥" : "♡"}</span>
      <span>{count}</span>
    </button>
  );
}
