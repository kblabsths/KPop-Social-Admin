"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type Concert = {
  id: string;
  title: string;
  date: string;
  status: string;
  eventType: string;
  artists: { id: string; name: string }[];
  venue: { id: string; name: string; city: string; country: string };
};

type Artist = {
  id: string;
  name: string;
};

type Venue = {
  id: string;
  name: string;
  city: string;
  country: string;
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const days: { date: Date; isCurrentMonth: boolean }[] = [];

  // Days from previous month
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d, isCurrentMonth: false });
  }

  // Days in current month
  for (let i = 1; i <= totalDays; i++) {
    days.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }

  // Days from next month to fill the grid
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
  }

  return days;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isToday(date: Date) {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

const MAX_VISIBLE_CONCERTS = 2;

export function CalendarView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [loading, setLoading] = useState(true);

  const [artists, setArtists] = useState<Artist[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);

  const artistId = searchParams.get("artistId") || "";
  const venueId = searchParams.get("venueId") || "";

  const updateFilters = useCallback(
    (newArtistId: string, newVenueId: string) => {
      const params = new URLSearchParams();
      if (newArtistId) params.set("artistId", newArtistId);
      if (newVenueId) params.set("venueId", newVenueId);
      const qs = params.toString();
      router.push(`/calendar${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router],
  );

  // Fetch artists and venues for dropdowns
  useEffect(() => {
    Promise.all([
      fetch("/api/artists?limit=100").then((r) => r.json()),
      fetch("/api/venues?limit=100").then((r) => r.json()),
    ]).then(([artistData, venueData]) => {
      setArtists(artistData);
      setVenues(venueData);
    });
  }, []);

  // Fetch concerts for the current month with filters
  useEffect(() => {
    setLoading(true);
    const dateFrom = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dateTo = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const params = new URLSearchParams({
      dateFrom,
      dateTo,
      limit: "100",
    });
    if (artistId) params.set("artistId", artistId);
    if (venueId) params.set("venueId", venueId);

    fetch(`/api/concerts?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setConcerts(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [year, month, artistId, venueId]);

  const days = getMonthDays(year, month);

  // Group concerts by date key
  const concertsByDate: Record<string, Concert[]> = {};
  for (const concert of concerts) {
    const d = new Date(concert.date);
    const key = formatDateKey(d);
    if (!concertsByDate[key]) concertsByDate[key] = [];
    concertsByDate[key].push(concert);
  }

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  }

  function goToToday() {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  const hasFilters = artistId || venueId;

  const monthLabel = new Date(year, month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/50">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          Artist
          <select
            value={artistId}
            onChange={(e) => updateFilters(e.target.value, venueId)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">All artists</option>
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          Venue
          <select
            value={venueId}
            onChange={(e) => updateFilters(artistId, e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">All venues</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {v.city}
              </option>
            ))}
          </select>
        </label>

        {hasFilters && (
          <button
            onClick={() => updateFilters("", "")}
            className="rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Month navigation */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          &larr; Prev
        </button>
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {monthLabel}
          </h2>
          <button
            onClick={goToToday}
            className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1 text-xs font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
          >
            Today
          </button>
        </div>
        <button
          onClick={nextMonth}
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Next &rarr;
        </button>
      </div>

      {/* Calendar grid — hidden on mobile, shown on md+ */}
      <div className="hidden md:block">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {/* Day of week headers */}
          <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800">
            {DAYS_OF_WEEK.map((day) => (
              <div
                key={day}
                className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Day cells */}
          {loading ? (
            <div className="flex h-96 items-center justify-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Loading concerts...
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const key = formatDateKey(day.date);
                const dayConcerts = concertsByDate[key] || [];
                const visibleConcerts = dayConcerts.slice(
                  0,
                  MAX_VISIBLE_CONCERTS,
                );
                const overflow = dayConcerts.length - MAX_VISIBLE_CONCERTS;
                const today = isToday(day.date);

                return (
                  <div
                    key={i}
                    className={`min-h-[100px] border-b border-r border-gray-100 p-1.5 dark:border-gray-800 ${
                      !day.isCurrentMonth
                        ? "bg-gray-50 dark:bg-gray-950"
                        : ""
                    } ${
                      today
                        ? "ring-2 ring-inset ring-purple-500 dark:ring-purple-400"
                        : ""
                    }`}
                  >
                    <div
                      className={`mb-1 text-xs font-medium ${
                        !day.isCurrentMonth
                          ? "text-gray-300 dark:text-gray-700"
                          : today
                            ? "font-bold text-purple-600 dark:text-purple-400"
                            : "text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {day.date.getDate()}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {visibleConcerts.map((concert) => (
                        <Link
                          key={concert.id}
                          href={`/concerts/${concert.id}`}
                          className="block truncate rounded bg-purple-100 px-1 py-0.5 text-[10px] font-medium leading-tight text-purple-700 transition hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
                          title={`${concert.title} — ${concert.artists.map((a) => a.name).join(", ")}`}
                        >
                          {concert.title}
                        </Link>
                      ))}
                      {overflow > 0 && (
                        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
                          +{overflow} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mobile list view — shown on small screens, hidden on md+ */}
      <div className="md:hidden">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Loading concerts...
            </p>
          </div>
        ) : concerts.length === 0 ? (
          <p className="py-8 text-center text-gray-500 dark:text-gray-400">
            No concerts scheduled for {monthLabel}.
          </p>
        ) : (
          <div className="space-y-6">
            {Object.entries(concertsByDate)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([dateKey, dayConcerts]) => {
                const dateObj = new Date(dateKey + "T00:00:00");
                const fullDate = dateObj.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                });
                const today = isToday(dateObj);

                return (
                  <div key={dateKey}>
                    <h3
                      className={`mb-2 text-sm font-semibold ${
                        today
                          ? "text-purple-600 dark:text-purple-400"
                          : "text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {fullDate}
                      {today && (
                        <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                          Today
                        </span>
                      )}
                    </h3>
                    <div className="space-y-2">
                      {dayConcerts.map((concert) => (
                        <Link
                          key={concert.id}
                          href={`/concerts/${concert.id}`}
                          className="block rounded-lg border border-gray-200 bg-white p-3 transition hover:border-purple-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
                        >
                          <p className="font-medium text-gray-900 dark:text-white">
                            {concert.title}
                          </p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {concert.artists.map((a) => a.name).join(", ")}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                            {concert.venue.name} — {concert.venue.city},{" "}
                            {concert.venue.country}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Empty state — desktop only (mobile has its own) */}
      {!loading && concerts.length === 0 && (
        <p className="mt-8 hidden text-center text-gray-500 md:block dark:text-gray-400">
          No concerts scheduled for {monthLabel}.
        </p>
      )}
    </div>
  );
}
