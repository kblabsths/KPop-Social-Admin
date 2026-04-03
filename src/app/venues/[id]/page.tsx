import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const venue = await prisma.venue.findUnique({
    where: { id },
    include: {
      concerts: {
        include: { artists: true },
        orderBy: { date: "asc" },
      },
    },
  });

  if (!venue) notFound();

  const upcomingConcerts = venue.concerts.filter(
    (c) => new Date(c.date) >= new Date()
  );
  const pastConcerts = venue.concerts.filter(
    (c) => new Date(c.date) < new Date()
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link
        href="/venues"
        className="mb-6 inline-block text-sm text-purple-600 hover:underline dark:text-purple-400"
      >
        &larr; All Venues
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {venue.name}
        </h1>
        <p className="mt-1 text-lg text-gray-500 dark:text-gray-400">
          {venue.city}, {venue.country}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          {venue.type && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {venue.type.replace("_", " ")}
            </span>
          )}
          {venue.capacity && (
            <span>Capacity: {venue.capacity.toLocaleString()}</span>
          )}
          {venue.address && <span>{venue.address}</span>}
        </div>
      </div>

      <div className="mb-8">
        <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
          Upcoming Concerts ({upcomingConcerts.length})
        </h2>
        {upcomingConcerts.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">
            No upcoming concerts at this venue.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {upcomingConcerts.map((concert) => (
              <Link
                key={concert.id}
                href={`/concerts/${concert.id}`}
                className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                  {concert.title}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {concert.artists.map((a) => a.name).join(", ")}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {new Date(concert.date).toLocaleDateString()}
                </p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    {concert.eventType.replace("_", " ")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {pastConcerts.length > 0 && (
        <div>
          <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
            Past Concerts ({pastConcerts.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {pastConcerts.map((concert) => (
              <Link
                key={concert.id}
                href={`/concerts/${concert.id}`}
                className="group rounded-xl border border-gray-200 bg-white p-4 opacity-70 transition hover:border-purple-300 hover:opacity-100 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                  {concert.title}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {concert.artists.map((a) => a.name).join(", ")}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {new Date(concert.date).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
