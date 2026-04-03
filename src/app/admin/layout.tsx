import Link from "next/link";
import { prisma } from "@/lib/prisma";

const STALE_THRESHOLD_HOURS = 24;

const navItems = [
  { href: "/admin", label: "Overview", icon: "◈" },
  { href: "/admin/scrapers", label: "Scrapers", icon: "⟳" },
  { href: "/admin/alerts", label: "Alerts", icon: "▲" },
  { href: "/admin/database", label: "Database", icon: "◻" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeAlerts, latestRun] = await Promise.all([
    prisma.dataQualityAlert.count({ where: { resolvedAt: null } }),
    prisma.scraperRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  const hoursSinceLastRun = latestRun
    ? (Date.now() - latestRun.startedAt.getTime()) / (60 * 60 * 1000)
    : null;
  const isStale =
    !latestRun ||
    (hoursSinceLastRun !== null && hoursSinceLastRun > STALE_THRESHOLD_HOURS);
  const lastScrapeStatus = latestRun?.status ?? "NONE";

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 border-r border-gray-300 bg-gray-50 dark:border-gray-800 dark:bg-gray-900 flex flex-col">
        <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Admin Panel
          </h2>
        </div>
        <nav className="px-1 py-1 flex flex-col gap-0.5 flex-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              <span className="text-[10px] opacity-60">{item.icon}</span>
              {item.label}
              {item.label === "Alerts" && activeAlerts > 0 && (
                <span className="ml-auto rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                  {activeAlerts}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="px-3 py-2 border-t border-gray-300 dark:border-gray-800">
          <Link
            href="/"
            className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ← Back to site
          </Link>
        </div>
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
