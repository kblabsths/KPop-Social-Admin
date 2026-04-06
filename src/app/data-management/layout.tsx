"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const subNavItems = [
  { href: "/data-management/groups", label: "Groups" },
  { href: "/data-management/idols", label: "Idols" },
  { href: "/data-management/events", label: "Events" },
];

export default function DataManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
          Data Management
        </h1>
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
          {subNavItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 ${
                  isActive
                    ? "border-purple-600 text-purple-700 dark:text-purple-300"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}
