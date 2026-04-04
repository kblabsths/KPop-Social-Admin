import Link from "next/link";
import { auth } from "@/lib/auth";
import Navbar from "@/app/components/navbar";
import RecommendationsSection from "@/app/components/dashboard/recommendations-section";
import UpcomingConcertsSection from "@/app/components/dashboard/upcoming-concerts-section";
import FeedSection from "@/app/components/dashboard/feed-section";
import QuickLinksSection from "@/app/components/dashboard/quick-links-section";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-purple-50 to-pink-50 dark:from-gray-950 dark:to-purple-950">
      <Navbar />

      {session?.user ? (
        <main className="mx-auto w-full max-w-5xl px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              Welcome back, {session.user.name}!
            </h1>
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              Here&apos;s what&apos;s happening in your K-Pop world.
            </p>
          </div>

          <div className="space-y-10">
            <RecommendationsSection userId={session.user.id!} />
            <UpcomingConcertsSection />
            <FeedSection currentUserId={session.user.id!} />
            <QuickLinksSection userId={session.user.id!} />
          </div>
        </main>
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
          <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            KPop Social Space
          </h1>
          <p className="max-w-md text-lg text-gray-600 dark:text-gray-300">
            Connect with fellow fans, share your favorite moments, and celebrate
            K-Pop together.
          </p>
          <Link
            href="/login"
            className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-8 py-3 font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
          >
            Get Started
          </Link>
        </main>
      )}
    </div>
  );
}
