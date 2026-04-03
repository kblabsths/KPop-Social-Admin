import { Suspense } from "react";
import { CalendarView } from "./calendar-view";

export default function CalendarPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Concert Calendar
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Browse upcoming concerts by date
        </p>
      </div>
      <Suspense
        fallback={
          <div className="flex h-96 items-center justify-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Loading calendar...
            </p>
          </div>
        }
      >
        <CalendarView />
      </Suspense>
    </main>
  );
}
