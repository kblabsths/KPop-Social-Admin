import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AdminNav } from "@/app/components/AdminNav";
import "./globals.css";

// NOTE: no `revalidate` — auth() reads headers, which forces dynamic
// rendering of every route anyway.

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

  // Catalog freshness = the newest canonical event (intake / adapters write them).
  const latestEventResult = await supabase
    .from("events")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestEvent = latestEventResult.data;

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const hoursSinceLastEvent = latestEvent
    ? (now - new Date(latestEvent.created_at).getTime()) / (60 * 60 * 1000)
    : null;
  const isStale =
    !latestEvent ||
    (hoursSinceLastEvent !== null && hoursSinceLastEvent > STALE_THRESHOLD_HOURS);

  return htmlWrapper(
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 border-r border-gray-300 bg-gray-50 dark:border-gray-800 dark:bg-gray-900 flex flex-col">
        <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Admin Panel
          </h2>
        </div>
        <AdminNav />
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
            <span className="text-gray-500 dark:text-gray-400">Events:</span>
            <span
              className={`font-semibold ${
                isStale
                  ? "text-red-600 dark:text-red-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            >
              {isStale ? "STALE" : "FRESH"}
            </span>
            {hoursSinceLastEvent !== null && (
              <span className="text-gray-400 dark:text-gray-500">
                ({hoursSinceLastEvent < 1
                  ? `${Math.round(hoursSinceLastEvent * 60)}m ago`
                  : `${Math.round(hoursSinceLastEvent * 10) / 10}h ago`})
              </span>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
