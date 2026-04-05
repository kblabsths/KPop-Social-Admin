import { notFound } from "next/navigation";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import Navbar from "@/app/components/navbar";
import ProfileActivityTabs from "./ProfileActivityTabs";
import InlineEditProfile from "./InlineEditProfile";

async function fetchActivity(userId: string, baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/users/${userId}/activity`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const session = await auth();

  const { data: user } = await supabase
    .from("web_users")
    .select("id, name, email, image, bio, favorite_artists, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!user) {
    notFound();
  }

  const isOwnProfile = session?.user?.id === user.id;

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  const activity = await fetchActivity(user.id, appUrl);

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-pink-50 dark:from-gray-950 dark:to-purple-950">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl bg-white p-8 shadow-lg dark:bg-gray-900">
          {/* Header: avatar + name */}
          <div className="flex items-start gap-6">
            {user.image ? (
              <img
                src={user.image as string}
                alt={user.name ?? "User avatar"}
                className="h-20 w-20 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-2xl font-bold text-white">
                {(user.name ?? "?")[0]?.toUpperCase()}
              </div>
            )}

            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {user.name ?? "Anonymous"}
                </h1>
                {isOwnProfile && (
                  <Link
                    href={`/profile/${user.id}/edit`}
                    className="rounded-lg bg-purple-100 px-4 py-2 text-sm font-medium text-purple-700 transition hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
                  >
                    Edit Profile
                  </Link>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Joined{" "}
                {new Date(user.created_at as string).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>

          {/* Bio and favorite artists — inline-editable for own profile */}
          {isOwnProfile ? (
            <InlineEditProfile
              userId={user.id as string}
              initialBio={user.bio as string | null}
              initialFavoriteArtists={user.favorite_artists as string[]}
            />
          ) : (
            <>
              {user.bio && (
                <div className="mt-6">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Bio
                  </h2>
                  <p className="mt-2 text-gray-700 dark:text-gray-300">
                    {user.bio as string}
                  </p>
                </div>
              )}

              {(user.favorite_artists as string[]).length > 0 && (
                <div className="mt-6">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Favorite Artists
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(user.favorite_artists as string[]).map((artist) => (
                      <span
                        key={artist}
                        className="rounded-full bg-gradient-to-r from-purple-100 to-pink-100 px-3 py-1 text-sm font-medium text-purple-700 dark:from-purple-900/30 dark:to-pink-900/30 dark:text-purple-300"
                      >
                        {artist}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!user.bio && (user.favorite_artists as string[]).length === 0 && (
                <p className="mt-6 text-center text-gray-400 dark:text-gray-500">
                  This user hasn&apos;t added any details yet.
                </p>
              )}
            </>
          )}

          {/* Activity sections */}
          {activity ? (
            <ProfileActivityTabs activity={activity} />
          ) : (
            <p className="mt-8 text-center text-sm text-gray-400 dark:text-gray-500">
              Activity data unavailable.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
