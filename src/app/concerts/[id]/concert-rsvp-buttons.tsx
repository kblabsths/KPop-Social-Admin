"use client";

import { useEffect, useState } from "react";

type RsvpStatus = "interested" | "going" | null;

export default function ConcertRsvpButtons({
  concertId,
  loggedIn,
}: {
  concertId: string;
  loggedIn: boolean;
}) {
  const [userStatus, setUserStatus] = useState<RsvpStatus>(null);
  const [interested, setInterested] = useState(0);
  const [going, setGoing] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/concerts/${concertId}/rsvp`)
      .then((res) => res.json())
      .then((data) => {
        setInterested(data.interested);
        setGoing(data.going);
        setUserStatus(data.userStatus ?? null);
      });
  }, [concertId]);

  async function handleRsvp(status: "interested" | "going") {
    if (!loggedIn || loading) return;
    setLoading(true);

    const isRemoving = userStatus === status;
    const prevStatus = userStatus;
    const prevInterested = interested;
    const prevGoing = going;

    // Optimistic update
    if (isRemoving) {
      setUserStatus(null);
      if (status === "interested") setInterested((c) => Math.max(0, c - 1));
      else setGoing((c) => Math.max(0, c - 1));
    } else {
      setUserStatus(status);
      if (status === "interested") {
        setInterested((c) => c + 1);
        if (prevStatus === "going") setGoing((c) => Math.max(0, c - 1));
      } else {
        setGoing((c) => c + 1);
        if (prevStatus === "interested")
          setInterested((c) => Math.max(0, c - 1));
      }
    }

    try {
      const res = isRemoving
        ? await fetch(`/api/concerts/${concertId}/rsvp`, { method: "DELETE" })
        : await fetch(`/api/concerts/${concertId}/rsvp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          });

      if (!res.ok) {
        // Revert on error
        setUserStatus(prevStatus);
        setInterested(prevInterested);
        setGoing(prevGoing);
      }
    } catch {
      // Revert on network error
      setUserStatus(prevStatus);
      setInterested(prevInterested);
      setGoing(prevGoing);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => handleRsvp("interested")}
          disabled={loading || !loggedIn}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            userStatus === "interested"
              ? "bg-purple-600 text-white shadow-md hover:bg-purple-700"
              : "border border-gray-300 text-gray-700 hover:border-purple-400 hover:text-purple-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-purple-500 dark:hover:text-purple-400"
          } disabled:opacity-50`}
        >
          {userStatus === "interested" ? "★ Interested" : "☆ Interested"}
        </button>
        <button
          onClick={() => handleRsvp("going")}
          disabled={loading || !loggedIn}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            userStatus === "going"
              ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md hover:from-purple-700 hover:to-pink-700"
              : "border border-gray-300 text-gray-700 hover:border-pink-400 hover:text-pink-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-pink-500 dark:hover:text-pink-400"
          } disabled:opacity-50`}
        >
          {userStatus === "going" ? "✓ Going" : "Going"}
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {interested > 0 && (
          <span>
            {interested} interested
            {going > 0 && " · "}
          </span>
        )}
        {going > 0 && <span>{going} going</span>}
        {interested === 0 && going === 0 && "Be the first to RSVP!"}
      </p>
      {!loggedIn && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          <a href="/login" className="text-purple-600 hover:underline dark:text-purple-400">
            Sign in
          </a>{" "}
          to RSVP
        </p>
      )}
    </div>
  );
}
