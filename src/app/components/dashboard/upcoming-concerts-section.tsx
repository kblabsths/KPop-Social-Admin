"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Concert = {
  id: string;
  title: string;
  slug: string | null;
  date: string;
  imageUrl: string | null;
  venue: { name: string; city: string; country: string } | null;
  artists: { id: string; name: string }[];
  rsvpStatus: string | null;
};

export default function UpcomingConcertsSection() {
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/my-concerts?past=false&limit=4")
      .then((r) => r.json())
      .then((data) => setConcerts(Array.isArray(data?.concerts) ? data.concerts.slice(0, 4) : []))
      .catch(() => setConcerts([]))
      .finally(() => setLoading(false));
  }, []);

  const rsvpBadgeClass = (status: string | null) => {
    switch (status) {
      case "going":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
      case "maybe":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
      case "not_going":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Upcoming Concerts
        </h2>
        <Link
          href="/my-concerts"
          className="text-sm text-purple-600 hover:underline dark:text-purple-400"
        >
          View all
        </Link>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-800"
            >
              <div className="h-32 rounded-t-xl bg-gray-200 dark:bg-gray-700" />
              <div className="p-4 space-y-2">
                <div className="h-4 rounded bg-gray-200 dark:bg-gray-700 w-3/4" />
                <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : concerts.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          No upcoming concerts.{" "}
          <Link href="/concerts" className="text-purple-600 hover:underline dark:text-purple-400">
            Browse concerts
          </Link>{" "}
          to find your next show!
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {concerts.map((concert) => (
            <Link
              key={concert.id}
              href={`/concerts/${concert.slug ?? concert.id}`}
              className="group rounded-xl border border-gray-200 bg-white transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
            >
              {concert.imageUrl ? (
                <img
                  src={concert.imageUrl}
                  alt={concert.title}
                  className="h-32 w-full rounded-t-xl object-cover"
                />
              ) : (
                <div className="h-32 rounded-t-xl bg-gradient-to-br from-purple-200 to-pink-200 dark:from-purple-900/40 dark:to-pink-900/40" />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400 line-clamp-1">
                    {concert.title}
                  </p>
                  {concert.rsvpStatus && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${rsvpBadgeClass(concert.rsvpStatus)}`}
                    >
                      {concert.rsvpStatus.replace("_", " ")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {new Date(concert.date).toLocaleDateString()}
                  {concert.venue && ` · ${concert.venue.city}`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
