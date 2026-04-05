import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import ConcertRsvpButtons from "./concert-rsvp-buttons";

export default async function ConcertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const [{ data: raw }, session] = await Promise.all([
    supabase
      .from("concerts")
      .select("*, venue:venues(*), artists:concert_artists(artist:artists(*))")
      .eq("id", id)
      .maybeSingle(),
    auth(),
  ]);

  if (!raw) notFound();
  const loggedIn = !!session?.user;

  type ArtistRow = { id: string; name: string; image: string | null; [key: string]: unknown };
  const artists: ArtistRow[] = ((raw.artists as { artist: ArtistRow }[]) ?? []).map((a) => a.artist);
  const concert = { ...raw, artists };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link
        href="/concerts"
        className="mb-6 inline-block text-sm text-purple-600 hover:underline dark:text-purple-400"
      >
        &larr; All Concerts
      </Link>

      <div className="mb-8">
        {concert.image_url && (
          <img
            src={concert.image_url as string}
            alt={concert.title as string}
            className="mb-6 h-64 w-full rounded-xl object-cover"
          />
        )}
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {concert.title as string}
        </h1>
        {concert.tour_name && (
          <p className="mt-1 text-lg text-gray-500 dark:text-gray-400">
            {concert.tour_name as string}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
            {(concert.event_type as string).replace("_", " ")}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              concert.status === "scheduled"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : concert.status === "on_sale"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  : concert.status === "sold_out"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                    : concert.status === "cancelled"
                      ? "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300"
                      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
            }`}
          >
            {(concert.status as string).replace("_", " ")}
          </span>
          <span>{new Date(concert.date as string).toLocaleDateString()}</span>
          {concert.end_date && (
            <span>
              &ndash; {new Date(concert.end_date as string).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="mt-4">
          <ConcertRsvpButtons concertId={concert.id as string} loggedIn={loggedIn} />
        </div>
        {concert.description && (
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            {concert.description as string}
          </p>
        )}
      </div>

      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
          Venue
        </h2>
        <Link
          href={`/venues/${(concert.venue as { id: string }).id}`}
          className="font-medium text-purple-600 hover:underline dark:text-purple-400"
        >
          {(concert.venue as { name: string }).name}
        </Link>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {(concert.venue as { city: string; country: string }).city},{" "}
          {(concert.venue as { city: string; country: string }).country}
        </p>
        {(concert.venue as { address?: string | null }).address && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {(concert.venue as { address: string }).address}
          </p>
        )}
      </div>

      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          Artists ({artists.length})
        </h2>
        {artists.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No artists listed.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {artists.map((artist) => (
              <Link
                key={artist.id as string}
                href={`/artists/${artist.id}`}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition hover:border-purple-300 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
              >
                {artist.image ? (
                  <img
                    src={artist.image as string}
                    alt={artist.name as string}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-sm font-bold text-white">
                    {(artist.name as string)[0]}
                  </div>
                )}
                <span className="font-medium text-gray-900 dark:text-white">
                  {artist.name as string}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {concert.ticket_url && (
        <a
          href={concert.ticket_url as string}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
        >
          Get Tickets
        </a>
      )}

      {concert.source && (
        <p className="mt-6 text-xs text-gray-400 dark:text-gray-500">
          Source: {concert.source_url ? (
            <a
              href={concert.source_url as string}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {concert.source as string}
            </a>
          ) : (
            concert.source as string
          )}
        </p>
      )}
    </main>
  );
}
