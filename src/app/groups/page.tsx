import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = getSupabaseAdmin();
  const session = await auth();

  let queryBuilder = supabase
    .from("groups")
    .select("*, artist:artists(id, name), member_count:group_members(count)")
    .order("created_at", { ascending: false });

  if (q) queryBuilder = queryBuilder.ilike("name", `%${q}%`);

  const { data } = await queryBuilder;
  const groups = (data ?? []).map((g) => ({
    ...g,
    _count: { members: ((g.member_count as { count: number }[])?.[0]?.count ?? 0) },
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Fan Groups
          </h1>
          {session?.user && (
            <Link
              href="/groups/create"
              className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
            >
              Create Group
            </Link>
          )}
        </div>

        <form className="mb-6 flex gap-3">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search groups..."
            className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
          />
          <button
            type="submit"
            className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
          >
            Search
          </button>
        </form>

        {groups.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12">
            {q ? "No groups found matching your search." : "No groups yet. Create the first one!"}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <Link
                key={group.id as string}
                href={`/groups/${group.id}`}
                className="group rounded-xl border border-gray-200 bg-white p-5 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                <div className="mb-3 flex items-center gap-3">
                  {group.image ? (
                    <img
                      src={group.image as string}
                      alt={group.name as string}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-lg font-bold text-white">
                      {(group.name as string)[0]}
                    </div>
                  )}
                  <div>
                    <h2 className="font-semibold text-gray-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                      {group.name as string}
                    </h2>
                    {group.artist && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {(group.artist as { name: string }).name}
                      </p>
                    )}
                  </div>
                </div>
                {group.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                    {group.description as string}
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
