import Link from "next/link";

interface SearchResults {
  concerts: Array<{
    id: string;
    title: string;
    date: string;
    eventType: string;
    status: string;
    imageUrl: string | null;
    artists: Array<{ id: string; name: string }>;
    venue: { id: string; name: string; city: string; country: string };
  }>;
  artists: Array<{
    id: string;
    name: string;
    koreanName: string | null;
    type: string;
    company: string | null;
    image: string | null;
  }>;
  venues: Array<{
    id: string;
    name: string;
    city: string;
    country: string;
    type: string | null;
    capacity: number | null;
  }>;
}

async function getSearchResults(query: string): Promise<SearchResults> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(
    `${baseUrl}/api/search?q=${encodeURIComponent(query)}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    return { concerts: [], artists: [], venues: [] };
  }
  return res.json();
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  if (!q?.trim()) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Search
        </h1>
        <p className="mt-4 text-gray-500 dark:text-gray-400">
          Enter a search term to find concerts, artists, and venues.
        </p>
      </main>
    );
  }

  const results = await getSearchResults(q);
  const totalResults =
    results.concerts.length + results.artists.length + results.venues.length;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
        Search results for &ldquo;{q}&rdquo;
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {totalResults} result{totalResults !== 1 ? "s" : ""} found
      </p>

      {totalResults === 0 && (
        <p className="mt-8 text-center text-gray-500 dark:text-gray-400 py-12">
          No results found. Try a different search term.
        </p>
      )}

      {results.concerts.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
            Concerts ({results.concerts.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.concerts.map((concert) => (
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
                <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                  {concert.title}
                </h3>
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
        </section>
      )}

      {results.artists.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
            Artists ({results.artists.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.artists.map((artist) => (
              <Link
                key={artist.id}
                href={`/artists/${artist.id}`}
                className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                <div className="mb-3 flex items-center gap-3">
                  {artist.image ? (
                    <img
                      src={artist.image}
                      alt={artist.name}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-lg font-bold text-white">
                      {artist.name[0]}
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                      {artist.name}
                    </h3>
                    {artist.koreanName && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {artist.koreanName}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    {artist.type}
                  </span>
                  {artist.company && <span>{artist.company}</span>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {results.venues.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
            Venues ({results.venues.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.venues.map((venue) => (
              <Link
                key={venue.id}
                href={`/venues/${venue.id}`}
                className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                  {venue.name}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {venue.city}, {venue.country}
                </p>
                <div className="mt-3 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                  {venue.type && (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                      {venue.type.replace("_", " ")}
                    </span>
                  )}
                  {venue.capacity && (
                    <span>Capacity: {venue.capacity.toLocaleString()}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
