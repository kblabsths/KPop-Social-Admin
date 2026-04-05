import { notFound, redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import Navbar from "@/app/components/navbar";

export default async function EditProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user?.id || session.user.id !== id) {
    redirect("/login");
  }

  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase
    .from("web_users")
    .select("id, name, bio, favorite_artists")
    .eq("id", id)
    .maybeSingle();

  if (!user) {
    notFound();
  }

  async function updateProfile(formData: FormData) {
    "use server";

    const currentSession = await auth();
    if (!currentSession?.user?.id || currentSession.user.id !== id) {
      throw new Error("Unauthorized");
    }

    const name = (formData.get("name") as string)?.trim() || null;
    const bio = (formData.get("bio") as string)?.trim() || null;
    const artistsRaw = (formData.get("favoriteArtists") as string) ?? "";
    const favoriteArtists = artistsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const supabaseServer = getSupabaseAdmin();
    await supabaseServer
      .from("web_users")
      .update({ name, bio, favorite_artists: favoriteArtists, updated_at: new Date().toISOString() })
      .eq("id", id);

    redirect(`/profile/${id}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-pink-50 dark:from-gray-950 dark:to-purple-950">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl bg-white p-8 shadow-lg dark:bg-gray-900">
          <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
            Edit Profile
          </h1>

          <form action={updateProfile} className="flex flex-col gap-5">
            <div>
              <label
                htmlFor="name"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Display Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                defaultValue={user.name ?? ""}
                maxLength={50}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-purple-400"
              />
            </div>

            <div>
              <label
                htmlFor="bio"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Bio
              </label>
              <textarea
                id="bio"
                name="bio"
                rows={4}
                defaultValue={user.bio ?? ""}
                maxLength={300}
                placeholder="Tell us about yourself..."
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-purple-400"
              />
            </div>

            <div>
              <label
                htmlFor="favoriteArtists"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Favorite Artists
              </label>
              <input
                id="favoriteArtists"
                name="favoriteArtists"
                type="text"
                defaultValue={(user.favorite_artists as string[] ?? []).join(", ")}
                placeholder="BTS, BLACKPINK, aespa, NewJeans..."
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 transition focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-purple-400"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Separate with commas
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2.5 font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
              >
                Save Changes
              </button>
              <a
                href={`/profile/${user.id}`}
                className="rounded-lg bg-gray-100 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </a>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
