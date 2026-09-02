import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Shell } from "@/components/shell/shell";

import "./globals.css";

/**
 * The root layout: the Frame and nothing else (campaign admin-window/TASK-0005).
 *
 * It is synchronous and reads no data. The deprecated app's global
 * "Events: STALE/FRESH" strip and the `events` query behind it are gone:
 * LOOK_AND_FEEL puts health on the Dashboard, and a database read in the root
 * layout would take every page down when a table is absent — the opposite of
 * the not-provisioned behaviour every ecosystem page owes.
 *
 * Keeping it synchronous also keeps ARCHITECTURE §5's rule true: a route's page
 * function is the only async component on that route.
 */

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
