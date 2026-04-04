"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Concert = {
  id: string;
  title: string;
  slug: string | null;
  date: string;
  imageUrl: string | null;
  venue: { name: string; city: string; country: string };
  artists: { id: string; name: string }[];
};

type Recommendation = {
  concert: Concert;
  reason: string;
};

export default function RecommendationsSection({ userId }: { userId: string }) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/users/${userId}/recommendations`)
      .then((r) => r.json())
      .then((data) => setRecs(Array.isArray(data) ? data.slice(0, 6) : []))
      .catch(() => setRecs([]))
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Recommended Concerts
        </h2>
        <Link
          href="/concerts"
          className="text-sm text-purple-600 hover:underline dark:text-purple-400"
        >
          Browse all
        </Link>
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="min-w-[200px] animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-800"
            >
              <div className="h-28 rounded-t-xl bg-gray-200 dark:bg-gray-700" />
              <div className="p-3 space-y-2">
                <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-3/4" />
                <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-1/2" />
                <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : recs.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Follow some artists to get personalized recommendations!
        </p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {recs.map(({ concert, reason }) => (
            <Link
              key={concert.id}
              href={`/concerts/${concert.slug ?? concert.id}`}
              className="group min-w-[200px] max-w-[200px] rounded-xl border border-gray-200 bg-white transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
            >
              {concert.imageUrl ? (
                <img
                  src={concert.imageUrl}
                  alt={concert.title}
                  className="h-28 w-full rounded-t-xl object-cover"
                />
              ) : (
                <div className="h-28 rounded-t-xl bg-gradient-to-br from-purple-200 to-pink-200 dark:from-purple-900/40 dark:to-pink-900/40" />
              )}
              <div className="p-3">
                <p className="font-semibold text-sm text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400 line-clamp-2">
                  {concert.title}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                  {concert.artists.map((a) => a.name).join(", ")}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {new Date(concert.date).toLocaleDateString()}
                </p>
                <p className="mt-1 text-xs text-purple-600 dark:text-purple-400 italic line-clamp-1">
                  {reason}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
