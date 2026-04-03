import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

type Concert = {
  id: string;
  title: string;
  slug: string | null;
  date: string;
  endDate: string | null;
  status: string;
  eventType: string;
  imageUrl: string | null;
  venue: { id: string; name: string; city: string; country: string } | null;
  artists: { id: string; name: string; slug: string; image: string | null }[];
  rsvpStatus: string | null;
  source: "rsvp" | "followed_artist";
};

async function fetchMyConcerts(
  cookieHeader: string,
  past: boolean
): Promise<{ concerts: Concert[]; pagination: { total: number } }> {
  const url = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/my-concerts?past=${past}&limit=100`;
  const res = await fetch(url, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return { concerts: [], pagination: { total: 0 } };
  return res.json();
}

export default async function MyConcertsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { tab } = await searchParams;
  const showPast = tab === "past";

  const { headers } = await import("next/headers");
  const headerStore = await headers();
  const cookieHeader = headerStore.get("cookie") ?? "";

  const { concerts } = await fetchMyConcerts(cookieHeader, showPast);

  const rsvpConcerts = concerts.filter((c) => c.source === "rsvp");
  const followedArtistConcerts = concerts.filter(
    (c) => c.source === "followed_artist"
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          My Concerts
        </h1>
      </div>

      <div className="mb-6 flex gap-2">
        <Link
          href="/my-concerts"
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            !showPast
              ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          Upcoming
        </Link>
        <Link
          href="/my-concerts?tab=past"
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            showPast
              ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          Past
        </Link>
      </div>

      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
          My RSVPs
        </h2>
        {rsvpConcerts.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            {showPast
              ? "No past RSVPs yet."
              : "You haven't RSVP'd to any upcoming concerts yet. Browse concerts to find events!"}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rsvpConcerts.map((concert) => (
              <ConcertCard key={concert.id} concert={concert} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
          From Followed Artists
        </h2>
        {followedArtistConcerts.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            {showPast
              ? "No past concerts from followed artists."
              : "No upcoming concerts from artists you follow. Follow some artists to see their events here!"}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {followedArtistConcerts.map((concert) => (
              <ConcertCard key={concert.id} concert={concert} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ConcertCard({ concert }: { concert: Concert }) {
  return (
    <Link
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
      {concert.venue && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {concert.venue.city}, {concert.venue.country} &middot;{" "}
          {new Date(concert.date).toLocaleDateString()}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
          {concert.eventType.replace("_", " ")}
        </span>
        {concert.rsvpStatus && (
          <span
            className={`rounded-full px-2 py-0.5 ${
              concert.rsvpStatus === "going"
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
            }`}
          >
            {concert.rsvpStatus === "going" ? "Going" : "Interested"}
          </span>
        )}
        {concert.source === "followed_artist" && (
          <span className="rounded-full bg-pink-100 px-2 py-0.5 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300">
            followed artist
          </span>
        )}
      </div>
    </Link>
  );
}
