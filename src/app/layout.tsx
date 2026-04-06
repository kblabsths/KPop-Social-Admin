import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AdminNav } from "@/app/components/AdminNav";
import "./globals.css";

export const revalidate = 60;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KPop Social Space — Admin",
  description: "Admin dashboard for KPop Social Space.",
};

const STALE_THRESHOLD_HOURS = 24;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  const htmlWrapper = (content: React.ReactNode) => (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{content}</body>
    </html>
  );

  if (!session?.user) {
    return htmlWrapper(children);
  }

  const supabase = getSupabaseAdmin();

  const [activeAlertsResult, latestRunResult] = await Promise.all([
    supabase
      .from("data_quality_alerts")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null),
    supabase
      .from("scraper_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const activeAlerts = activeAlertsResult.count ?? 0;
  const latestRun = latestRunResult.data;

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const hoursSinceLastRun = latestRun
    ? (now - new Date(latestRun.started_at).getTime()) / (60 * 60 * 1000)
    : null;
  const isStale =
    !latestRun ||
    (hoursSinceLastRun !== null && hoursSinceLastRun > STALE_THRESHOLD_HOURS);
  const lastScrapeStatus = latestRun?.status ?? "NONE";

  return htmlWrapper(
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 border-r border-gray-300 bg-gray-50 dark:border-gray-800 dark:bg-gray-900 flex flex-col">
        <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Admin Panel
          </h2>
        </div>
        <AdminNav activeAlerts={activeAlerts} />
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Top status bar */}
        <header className="flex items-center gap-4 border-b border-gray-300 bg-gray-50 px-4 py-1.5 text-[11px] font-mono dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isStale
                  ? "bg-red-500 animate-pulse"
                  : "bg-green-500"
              }`}
            />
            <span className="text-gray-500 dark:text-gray-400">Data:</span>
            <span
              className={`font-semibold ${
                isStale
                  ? "text-red-600 dark:text-red-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            >
              {isStale ? "STALE" : "FRESH"}
            </span>
            {hoursSinceLastRun !== null && (
              <span className="text-gray-400 dark:text-gray-500">
                ({hoursSinceLastRun < 1
                  ? `${Math.round(hoursSinceLastRun * 60)}m ago`
                  : `${Math.round(hoursSinceLastRun * 10) / 10}h ago`})
              </span>
            )}
          </div>

          <span className="text-gray-300 dark:text-gray-700">|</span>

          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 dark:text-gray-400">Alerts:</span>
            <span
              className={`font-semibold ${
                activeAlerts > 0
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              {activeAlerts}
            </span>
          </div>

          <span className="text-gray-300 dark:text-gray-700">|</span>

          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 dark:text-gray-400">Last scrape:</span>
            <span
              className={`font-semibold ${
                lastScrapeStatus === "SUCCESS"
                  ? "text-green-600 dark:text-green-400"
                  : lastScrapeStatus === "FAILED"
                    ? "text-red-600 dark:text-red-400"
                    : lastScrapeStatus === "RUNNING"
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-gray-600 dark:text-gray-400"
              }`}
            >
              {lastScrapeStatus}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
