"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinLeaveButton({
  groupId,
  isMember,
}: {
  groupId: string;
  isMember: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: isMember ? "DELETE" : "POST",
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        isMember
          ? "border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          : "bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700"
      } disabled:opacity-50`}
    >
      {loading ? "..." : isMember ? "Leave Group" : "Join Group"}
    </button>
  );
}
