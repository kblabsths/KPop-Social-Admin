"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { NAV_ITEMS, isFramed, isNavItemActive } from "./nav-items";

/**
 * The Frame (campaign admin-window/TASK-0005, LOOK_AND_FEEL "Spacing, borders,
 * density"): a 192px fixed left sidebar in chrome fill with a hairline right
 * edge, six text labels, the active one in chrome-inverse, sign-out at the
 * bottom behind a hairline.
 *
 * It is a client component because the active item is a function of the
 * current path and sign-out is a click. It takes `children` as a prop, so the
 * pages inside it stay server components and never cross into the client
 * bundle. It fetches nothing, and the root layout it lives in reads no
 * database — a read there would take every page down when a table is absent.
 *
 * The 16px content padding is the `Page` primitive's (`p-4`), not this file's:
 * padding both would put the content at 32px, off the spacing scale.
 */

/** One nav item. A link, so middle-click and Cmd-click behave. */
function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rounded-control px-2 py-1.5 type-body transition-colors",
        active
          ? "bg-chrome-inverse text-ink"
          : "text-ink-secondary hover:bg-chrome-inverse hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-hairline bg-chrome">
      <nav aria-label="Sections" className="flex flex-col gap-0.5 p-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            active={isNavItemActive(pathname, item.href)}
          />
        ))}
      </nav>
      <div className="mt-auto border-t border-hairline p-1">
        <button
          type="button"
          onClick={() => signOut({ redirectTo: "/login" })}
          className="w-full rounded-control px-2 py-1.5 text-left type-body text-ink-secondary transition-colors hover:bg-chrome-inverse hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!isFramed(pathname)) return <>{children}</>;
  return (
    <div className="flex min-h-screen">
      <Sidebar pathname={pathname} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
