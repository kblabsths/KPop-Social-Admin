import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";

export default async function ArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { q, type } = await searchParams;
  const supabase = getSupabaseAdmin();

  let queryBuilder = supabase
    .from("artists")
    .select("*, groups_count:groups(count)")
    .order("name", { ascending: true });

  if (type) queryBuilder = queryBuilder.eq("type", type);
  if (q) queryBuilder = queryBuilder.or(`name.ilike.%${q}%,korean_name.ilike.%${q}%`);

  const { data } = await queryBuilder;
  const artists = (data ?? []).map((a) => ({
    ...a,
    groupsCount: ((a.groups_count as { count: number }[])?.[0]?.count ?? 0),
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Artists
          </h1>
        </div>

        <form className="mb-6 flex gap-3">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search artists..."
            className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
          />
          <select
            name="type"
            defaultValue={type || ""}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">All Types</option>
            <option value="group">Groups</option>
            <option value="solo">Solo</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
          >
            Search
          </button>
        </form>

        {artists.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12">
            {q ? "No artists found matching your search." : "No artists yet."}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {artists.map((artist) => (
              <Link
                key={artist.id as string}
                href={`/artists/${artist.id}`}
                className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                <div className="mb-3 flex items-center gap-3">
                  {artist.image ? (
                    <img
                      src={artist.image as string}
                      alt={artist.name as string}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-lg font-bold text-white">
                      {(artist.name as string)[0]}
                    </div>
                  )}
                  <div>
                    <h2 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                      {artist.name as string}
                    </h2>
                    {artist.korean_name && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {artist.korean_name as string}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    {artist.type as string}
                  </span>
                  {artist.company && <span>{artist.company as string}</span>}
                  <span>{artist.groupsCount} fan groups</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
  );
}
