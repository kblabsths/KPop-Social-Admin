import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function ConcertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const concert = await prisma.concert.findUnique({
    where: { id },
    include: {
      artists: true,
      venue: true,
    },
  });

  if (!concert) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link
        href="/concerts"
        className="mb-6 inline-block text-sm text-purple-600 hover:underline dark:text-purple-400"
      >
        &larr; All Concerts
      </Link>

      <div className="mb-8">
        {concert.imageUrl && (
          <img
            src={concert.imageUrl}
            alt={concert.title}
            className="mb-6 h-64 w-full rounded-xl object-cover"
          />
        )}
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {concert.title}
        </h1>
        {concert.tourName && (
          <p className="mt-1 text-lg text-gray-500 dark:text-gray-400">
            {concert.tourName}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
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
          <span>{new Date(concert.date).toLocaleDateString()}</span>
          {concert.endDate && (
            <span>
              &ndash; {new Date(concert.endDate).toLocaleDateString()}
            </span>
          )}
        </div>
        {concert.description && (
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            {concert.description}
          </p>
        )}
      </div>

      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
          Venue
        </h2>
        <Link
          href={`/venues/${concert.venue.id}`}
          className="font-medium text-purple-600 hover:underline dark:text-purple-400"
        >
          {concert.venue.name}
        </Link>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {concert.venue.city}, {concert.venue.country}
        </p>
        {concert.venue.address && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {concert.venue.address}
          </p>
        )}
      </div>

      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          Artists ({concert.artists.length})
        </h2>
        {concert.artists.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No artists listed.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {concert.artists.map((artist) => (
              <Link
                key={artist.id}
                href={`/artists/${artist.id}`}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                {artist.image ? (
                  <img
                    src={artist.image}
                    alt={artist.name}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-sm font-bold text-white">
                    {artist.name[0]}
                  </div>
                )}
                <span className="font-medium text-gray-900 dark:text-white">
                  {artist.name}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {concert.ticketUrl && (
        <a
          href={concert.ticketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
        >
          Get Tickets
        </a>
      )}

      {concert.source && (
        <p className="mt-6 text-xs text-gray-400 dark:text-gray-500">
          Source: {concert.sourceUrl ? (
            <a
              href={concert.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {concert.source}
            </a>
          ) : (
            concert.source
          )}
        </p>
      )}
    </main>
  );
}
