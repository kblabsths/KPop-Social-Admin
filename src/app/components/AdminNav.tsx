"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const navItems = [
  { href: "/", label: "Overview", icon: "◈" },
  { href: "/data-management", label: "Data Management", icon: "◫" },
  { href: "/scrapers", label: "Scrapers", icon: "⟳" },
  { href: "/alerts", label: "Alerts", icon: "▲" },
  { href: "/analytics", label: "Analytics", icon: "◈̈" },
];

export function AdminNav({ activeAlerts }: { activeAlerts: number }) {
  const pathname = usePathname();

  return (
    <nav className="px-1 py-1 flex flex-col gap-0.5 flex-1">
      {navItems.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
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
      <div className="mt-auto px-1 pb-2 pt-1 border-t border-gray-300 dark:border-gray-800">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
        >
          <span className="text-[10px] opacity-60">⏻</span>
          Sign Out
        </button>
      </div>
    </nav>
  );
}
