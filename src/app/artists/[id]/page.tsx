import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import FollowButton from "./follow-button";

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [{ data: artist }, session] = await Promise.all([
    supabase
      .from("artists")
      .select("*, groups(*, member_count:group_members(count))")
      .eq("id", id)
      .maybeSingle(),
    auth(),
  ]);

  if (!artist) notFound();
  const loggedIn = !!session?.user;

  type RawGroup = {
    id: string;
    name: string;
    description: string | null;
    member_count: { count: number }[];
    [key: string]: unknown;
  };

  const groups = ((artist.groups as RawGroup[]) ?? [])
    .map((g) => ({
      ...g,
      _count: { members: g.member_count?.[0]?.count ?? 0 },
    }))
    .sort((a, b) => b._count.members - a._count.members);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <Link
          href="/artists"
          className="mb-6 inline-block text-sm text-purple-600 hover:underline dark:text-purple-400"
        >
          &larr; All Artists
        </Link>

        <div className="mb-8 flex items-start gap-5">
          {artist.image ? (
            <img
              src={artist.image as string}
              alt={artist.name as string}
              className="h-24 w-24 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 text-3xl font-bold text-white">
              {(artist.name as string)[0]}
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {artist.name as string}
            </h1>
            {artist.korean_name && (
              <p className="text-lg text-gray-500 dark:text-gray-400">
                {artist.korean_name as string}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                {artist.type as string}
              </span>
              {artist.company && <span>{artist.company as string}</span>}
              {artist.debut_date && (
                <span>
                  Debut:{" "}
                  {new Date(artist.debut_date as string).toLocaleDateString()}
                </span>
              )}
            </div>
            {artist.description && (
              <p className="mt-3 text-gray-600 dark:text-gray-300">
                {artist.description as string}
              </p>
            )}
            <div className="mt-3">
              <FollowButton artistId={artist.id as string} loggedIn={loggedIn} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Fan Groups ({groups.length})
          </h2>
          <Link
            href={`/groups/create?artistId=${artist.id}`}
            className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
          >
            Create Group
          </Link>
        </div>

        {groups.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">
            No fan groups yet. Be the first to create one!
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                  {group.name}
                </h3>
                {group.description && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                    {group.description}
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  {group._count.members} members
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
  );
}
