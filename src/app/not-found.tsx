import Link from "next/link";

import { Empty, Page } from "@/components/ui";

/**
 * The 404 (campaign admin-window/BUG-0014).
 *
 * Without this file Next serves its built-in `HTTPAccessErrorFallback` for
 * every unmatched URL. That fallback is not a page of this app: it draws its
 * two strings in `system-ui` at 24px/500 and 14px/400, and — the part that
 * reaches past itself — it injects `body{color:#000;background:#fff;margin:0}`
 * with a dark arm of `#fff/#000`, overriding the token layer for the whole
 * document. Owning the route is what stops that stylesheet from ever being
 * rendered; there is nothing to override once this component answers instead.
 *
 * A root `not-found.tsx` answers both cases (Next 16,
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`):
 * an unmatched URL anywhere in the app, and a `notFound()` thrown in a segment.
 * It renders inside the root layout, so it inherits the Frame, the page
 * padding and the tokens like every other route — which is why this is a plain
 * synchronous server component built from the primitives and holds no styling
 * of its own. `global-not-found.js` would have been the wrong tool: it is
 * experimental, it bypasses the layout, and bypassing the layout is precisely
 * the defect being fixed.
 *
 * A missing page is not a broken one, so this is the empty state and not
 * `ErrorLine`: red means broken (LOOK_AND_FEEL, the four data-surface states).
 *
 * The link back is written here rather than taken from a primitive because
 * the set has none that is a link with a label: `Chip` is a filter and
 * `StatCard` is a number. It is `next/link` (the shell's idiom, and what
 * `@next/next/no-html-link-for-pages` requires of a literal internal href),
 * carrying palette and type tokens like everything else.
 */
export default function NotFound() {
  return (
    <Page title="Page not found">
      <Empty
        holds="page at this address"
        filledBy="Analytics, Database and Data management were retired with the old dashboard, and nothing replaced their URLs. The window is the six pages in the sidebar."
      />
      <p className="type-body text-ink">
        <Link href="/" className="text-accent underline">
          Open the Dashboard
        </Link>
      </p>
    </Page>
  );
}
