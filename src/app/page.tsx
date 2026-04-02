import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-purple-50 to-pink-50 dark:from-gray-950 dark:to-purple-950">
      <main className="flex flex-col items-center gap-8 p-8 text-center">
        <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
          KPop Social Space
        </h1>
        <p className="max-w-md text-lg text-gray-600 dark:text-gray-300">
          Connect with fellow fans, share your favorite moments, and celebrate
          K-Pop together.
        </p>

        {session?.user ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-gray-700 dark:text-gray-200">
              Welcome back, <strong>{session.user.name}</strong>!
            </p>
            <Link
              href="/api/auth/signout"
              className="rounded-full bg-gray-200 px-6 py-3 font-medium text-gray-800 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              Sign Out
            </Link>
          </div>
        ) : (
          <a
            href="/login"
            className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-8 py-3 font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
          >
            Get Started
          </a>
        )}
      </main>
    </div>
  );
}
