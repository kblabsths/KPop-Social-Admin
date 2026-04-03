"use client";

import { useEffect, useState } from "react";
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
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [concerts, setConcerts] = useState<Concert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const dateFrom = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dateTo = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    fetch(`/api/concerts?dateFrom=${dateFrom}&dateTo=${dateTo}&limit=100`)
      .then((res) => res.json())
      .then((data) => {
        setConcerts(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [year, month]);

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

  const monthLabel = new Date(year, month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
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

      {/* Calendar grid */}
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

      {/* Empty state */}
      {!loading && concerts.length === 0 && (
        <p className="mt-8 text-center text-gray-500 dark:text-gray-400">
          No concerts scheduled for {monthLabel}.
        </p>
      )}
    </div>
  );
}
