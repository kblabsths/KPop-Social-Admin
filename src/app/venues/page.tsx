import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; country?: string }>;
}) {
  const { q, country } = await searchParams;
  const supabase = getSupabaseAdmin();

  let queryBuilder = supabase
    .from("venues")
    .select("*, concerts_count:concerts(count)")
    .order("name", { ascending: true });

  if (q) queryBuilder = queryBuilder.or(`name.ilike.%${q}%,city.ilike.%${q}%`);
  if (country) queryBuilder = queryBuilder.ilike("country", `%${country}%`);

  const { data } = await queryBuilder;
  const venues = (data ?? []).map((v) => ({
    ...v,
    concertsCount: ((v.concerts_count as { count: number }[])?.[0]?.count ?? 0),
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Venues
        </h1>
      </div>

      <form className="mb-6 flex gap-3">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search venues or cities..."
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
        />
        <input
          type="text"
          name="country"
          defaultValue={country}
          placeholder="Country..."
          className="w-40 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
        >
          Search
        </button>
      </form>

      {venues.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-12">
          {q || country
            ? "No venues found matching your search."
            : "No venues yet."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {venues.map((venue) => (
            <Link
              key={venue.id as string}
              href={`/venues/${venue.id}`}
              className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
            >
              <h2 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                {venue.name as string}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {venue.city as string}, {venue.country as string}
              </p>
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                {venue.type && (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    {(venue.type as string).replace("_", " ")}
                  </span>
                )}
                {venue.capacity && (
                  <span>Capacity: {(venue.capacity as number).toLocaleString()}</span>
                )}
                <span>{venue.concertsCount} concerts</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
