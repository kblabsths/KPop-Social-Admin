"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
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

/**
 * One nav item. A link, so middle-click and Cmd-click behave.
 *
 * Two renderings, and they are never the same one (admin-window/BUG-0015).
 * The Look gives the active item a rendering of its own — "Active item =
 * chrome-inverse fill … with primary text" — and that fill is the window's
 * only claim of place, so it is spent here and nowhere else: hover is a state,
 * not a claim, and this file previously handed hover the identical pair, so
 * two items read as current whenever the pointer was in the sidebar.
 *
 * Hover therefore takes the treatment the Look already sanctions for a
 * non-active interactive row — the data table's "hover fills the row with
 * chrome", i.e. the surface/chrome pair, one step of the ramp. The sidebar is
 * already the chrome half of that pair, so the hovered item takes the other
 * half, `surface`, with its ink lifting from secondary to primary. In both
 * themes that lands on the opposite side of chrome from `chrome-inverse`
 * (white vs gray-200 in light, gray-900 vs gray-700 in dark), so a hovered
 * item can never be mistaken for the active one — no new colour, and nothing
 * outside the eleven token jobs.
 */
function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rounded-control px-2 py-1.5 type-body transition-colors",
        active
          ? "bg-chrome-inverse text-ink"
          : "text-ink-secondary hover:bg-surface hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}

/**
 * The Frame's chrome, as a pure function of the path.
 *
 * Exported so the offline suite can render it and assert what each state
 * actually emits: `Shell` reads `usePathname`, which needs a router, while
 * this takes the path as a prop and needs nothing.
 */
export function Sidebar({ pathname }: { pathname: string }) {
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
        {/*
         * Sign out is an action, not a seventh page, so it is the Look's
         * secondary button — hairline border, transparent fill, primary text —
         * rather than a nav item with a nav item's states. It carries no nav
         * hover class in any state, which is what keeps the pointer from
         * dressing it as a place you can be (admin-window/BUG-0015).
         */}
        <Button variant="secondary" className="w-full" onClick={() => signOut({ redirectTo: "/login" })}>
          Sign out
        </Button>
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
