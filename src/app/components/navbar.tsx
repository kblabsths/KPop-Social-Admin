import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import SearchBar from "./search-bar";

export default async function Navbar() {
  const session = await auth();

  return (
    <nav className="border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          className="text-lg font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent"
        >
          KPop Space
        </Link>

        <div className="flex items-center gap-4">
          <SearchBar />
          <Link
            href="/artists"
            className="text-sm font-medium text-gray-700 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400"
          >
            Artists
          </Link>
          <Link
            href="/groups"
            className="text-sm font-medium text-gray-700 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400"
          >
            Groups
          </Link>
          <Link
            href="/concerts"
            className="text-sm font-medium text-gray-700 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400"
          >
            Concerts
          </Link>
          <Link
            href="/venues"
            className="text-sm font-medium text-gray-700 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400"
          >
            Venues
          </Link>
          {session?.user && (
            <>
              <Link
                href="/my-concerts"
                className="text-sm font-medium text-gray-700 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400"
              >
                My Concerts
              </Link>
              <Link
                href="/feed"
                className="text-sm font-medium text-gray-700 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400"
              >
                Feed
              </Link>
            </>
          )}
          {session?.user ? (
            <>
              <Link
                href={`/profile/${session.user.id}`}
                className="text-sm font-medium text-gray-700 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-400"
              >
                Profile
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-1.5 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
