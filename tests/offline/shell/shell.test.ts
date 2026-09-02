import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isFramed, isNavItemActive } from "@/components/shell/nav-items";

import BrowsePage from "@/app/browse/page";
import ClaimsPage from "@/app/claims/page";
import CyclesPage from "@/app/cycles/page";
import DashboardPage from "@/app/page";
import QueuesPage from "@/app/queues/page";
import RecordPage from "@/app/records/[table]/[id]/page";
import SourcesPage from "@/app/sources/page";

/**
 * The shell and the route skeleton (campaign admin-window/TASK-0005).
 *
 * These assert the shell's BEHAVIOUR — which routes it offers, which one it
 * marks active, which paths render inside the Frame, and that every page
 * renders standing alone with no database — never its wording or its classes.
 * Copy belongs to the pages and the walk; a test that pinned it would redden
 * on every copy edit.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/** The six pages of the window, as `src/app` route paths. */
const SIX_ROUTES = ["/", "/queues", "/claims", "/sources", "/cycles", "/browse"];

describe("the sidebar's routes", () => {
  it("offers exactly the six pages of the window", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(SIX_ROUTES);
  });

  it("gives every item a label and no icon", () => {
    // LOOK_AND_FEEL, the Frame: text labels, no icons. Asserting the shape of
    // the item — that there is no icon channel at all — outlives any glyph.
    for (const item of NAV_ITEMS) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(Object.keys(item)).toEqual(["href", "label"]);
    }
  });

  it("links only to routes that have a page on disk", () => {
    for (const href of NAV_ITEMS.map((item) => item.href)) {
      const segment = href === "/" ? "" : href;
      const file = path.join(repoRoot, "src", "app", segment, "page.tsx");
      expect(fs.existsSync(file), `${href} has no page.tsx`).toBe(true);
    }
  });
});

describe("the active nav item", () => {
  it("lights the Dashboard on the Dashboard alone", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    for (const href of SIX_ROUTES.slice(1)) {
      expect(isNavItemActive(href, "/"), href).toBe(false);
    }
    expect(isNavItemActive("/records/groups/abc", "/")).toBe(false);
  });

  it("keeps a section lit inside its own children", () => {
    expect(isNavItemActive("/queues", "/queues")).toBe(true);
    expect(isNavItemActive("/queues/2f0b", "/queues")).toBe(true);
  });

  it("does not light a section on a path that merely starts with its name", () => {
    expect(isNavItemActive("/queuesomething", "/queues")).toBe(false);
    expect(isNavItemActive("/claims-archive", "/claims")).toBe(false);
  });

  it("lights at most one item on any path", () => {
    for (const pathname of [...SIX_ROUTES, "/queues/2f0b", "/records/groups/abc"]) {
      const lit = NAV_ITEMS.filter((item) => isNavItemActive(pathname, item.href));
      expect(lit.length, pathname).toBeLessThanOrEqual(1);
    }
  });
});

describe("the Frame", () => {
  it("wraps every page of the window", () => {
    for (const pathname of [...SIX_ROUTES, "/queues/2f0b", "/records/groups/abc"]) {
      expect(isFramed(pathname), pathname).toBe(true);
    }
  });

  it("leaves sign-in outside it", () => {
    // A signed-out visitor is offered no sidebar of pages they cannot open.
    expect(isFramed("/login")).toBe(false);
  });
});

describe("every route's page", () => {
  const pages: Array<[string, () => Promise<React.ReactElement>]> = [
    ["/", DashboardPage],
    ["/queues", QueuesPage],
    ["/claims", ClaimsPage],
    ["/sources", SourcesPage],
    ["/cycles", CyclesPage],
    ["/browse", BrowsePage],
  ];

  it("renders with no database credential in the environment", async () => {
    // The pages carry no read yet, and the shell above them carries none
    // either. Stripping the names is what proves it: a page that reached for
    // `getDbClient()` would throw here rather than quietly pass.
    const restore = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.includes("SUPABASE")) delete process.env[key];
    }
    try {
      for (const [route, Page] of pages) {
        const markup = renderToStaticMarkup(await Page());
        expect(markup.length, route).toBeGreaterThan(0);
      }
      const record = renderToStaticMarkup(
        await RecordPage({ params: Promise.resolve({ table: "groups", id: "abc" }) }),
      );
      expect(record.length).toBeGreaterThan(0);
    } finally {
      process.env = restore;
    }
  });

  it("gives the page exactly one h1", async () => {
    for (const [route, Page] of pages) {
      const markup = renderToStaticMarkup(await Page());
      expect([...markup.matchAll(/<h1[\s>]/g)].length, route).toBe(1);
      expect(markup.replace(/<[^>]*>/g, "").trim().length, route).toBeGreaterThan(0);
    }
  });

  it("names the record the edit surface was asked for", async () => {
    const markup = renderToStaticMarkup(
      await RecordPage({ params: Promise.resolve({ table: "groups", id: "2f0b-c11e" }) }),
    );
    expect(markup).toContain("2f0b-c11e");
    expect(markup).toContain("groups");
  });
});
