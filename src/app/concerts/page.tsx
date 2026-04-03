import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function ConcertsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; eventType?: string }>;
}) {
  const { q, eventType } = await searchParams;

  const concerts = await prisma.concert.findMany({
    where: {
      AND: [
        q
          ? { title: { contains: q, mode: "insensitive" } }
          : {},
        eventType ? { eventType } : {},
      ],
    },
    include: {
      artists: true,
      venue: true,
    },
    orderBy: { date: "asc" },
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Concerts
        </h1>
      </div>

      <form className="mb-6 flex gap-3">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search concerts..."
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
        />
        <select
          name="eventType"
          defaultValue={eventType || ""}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        >
          <option value="">All Types</option>
          <option value="concert">Concert</option>
          <option value="fan_meeting">Fan Meeting</option>
          <option value="festival">Festival</option>
          <option value="showcase">Showcase</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
        >
          Search
        </button>
      </form>

      {concerts.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-12">
          {q || eventType
            ? "No concerts found matching your filters."
            : "No concerts yet."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {concerts.map((concert) => (
            <Link
              key={concert.id}
              href={`/concerts/${concert.id}`}
              className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
            >
              {concert.imageUrl && (
                <img
                  src={concert.imageUrl}
                  alt={concert.title}
                  className="mb-3 h-40 w-full rounded-lg object-cover"
                />
              )}
              <h2 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                {concert.title}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {concert.artists.map((a) => a.name).join(", ")}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {concert.venue.city}, {concert.venue.country} &middot;{" "}
                {new Date(concert.date).toLocaleDateString()}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  {concert.eventType.replace("_", " ")}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    concert.status === "scheduled"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      : concert.status === "on_sale"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                        : concert.status === "sold_out"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                          : concert.status === "cancelled"
                            ? "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300"
                            : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                  }`}
                >
                  {concert.status.replace("_", " ")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
