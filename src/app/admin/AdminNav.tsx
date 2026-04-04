"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/admin", label: "Overview", icon: "◈" },
  { href: "/admin/scrapers", label: "Scrapers", icon: "⟳" },
  { href: "/admin/alerts", label: "Alerts", icon: "▲" },
  { href: "/admin/database", label: "Database", icon: "◻" },
];

export function AdminNav({ activeAlerts }: { activeAlerts: number }) {
  const pathname = usePathname();

  return (
    <nav className="px-1 py-1 flex flex-col gap-0.5 flex-1">
      {navItems.map((item) => {
        const isActive =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? "bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                : "text-gray-600 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <span className="text-[10px] opacity-60">{item.icon}</span>
            {item.label}
            {item.label === "Alerts" && activeAlerts > 0 && (
              <span className="ml-auto rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                {activeAlerts}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
