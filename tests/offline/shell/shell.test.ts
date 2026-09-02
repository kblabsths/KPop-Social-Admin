import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isFramed, isNavItemActive } from "@/components/shell/nav-items";
import { Sidebar } from "@/components/shell/shell";

import { classesOf, h } from "../ui/markup";

import BrowsePage from "@/app/browse/page";
import ClaimsPage from "@/app/claims/page";
import CyclesPage from "@/app/cycles/page";
import DashboardPage from "@/app/page";
import NotFound from "@/app/not-found";
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

/**
 * Paths a signed-in operator can still reach for: the deprecated app's
 * surfaces, which a stale bookmark still points at, and one that never
 * existed. All of them land on the not-found surface.
 */
const RETIRED_PATHS = [
  "/analytics",
  "/database",
  "/data-management",
  "/data-management/completeness",
  "/no-such-surface-here",
];

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

  /**
   * Run `body` with every SUPABASE name stripped from the environment.
   *
   * Two jobs, and both matter now that pages carry real reads
   * (admin-window/TASK-0018 gave the record route one): it proves a page
   * renders its own honest state instead of throwing when the app has no
   * credential, and it keeps this suite OFFLINE — a page rendered with a live
   * URL in the environment would open a socket, which `npm test` never does.
   */
  async function withoutDbCredentials(body: () => Promise<void>): Promise<void> {
    const restore = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.includes("SUPABASE")) delete process.env[key];
    }
    try {
      await body();
    } finally {
      process.env = restore;
    }
  }

  it("renders with no database credential in the environment", async () => {
    await withoutDbCredentials(async () => {
      for (const [route, Page] of pages) {
        const markup = renderToStaticMarkup(await Page());
        expect(markup.length, route).toBeGreaterThan(0);
      }
      const record = renderToStaticMarkup(
        await RecordPage({ params: Promise.resolve({ table: "groups", id: "abc" }) }),
      );
      expect(record.length).toBeGreaterThan(0);
    });
  });

  it("gives the page exactly one h1", async () => {
    await withoutDbCredentials(async () => {
      for (const [route, Page] of pages) {
        const markup = renderToStaticMarkup(await Page());
        expect([...markup.matchAll(/<h1[\s>]/g)].length, route).toBe(1);
        expect(markup.replace(/<[^>]*>/g, "").trim().length, route).toBeGreaterThan(0);
      }
    });
  });

  it("names the record the edit surface was asked for", async () => {
    // Whatever the read did — and with no credential it fails — the operator
    // is still told which row they asked for.
    await withoutDbCredentials(async () => {
      const markup = renderToStaticMarkup(
        await RecordPage({ params: Promise.resolve({ table: "groups", id: "2f0b-c11e" }) }),
      );
      expect(markup).toContain("2f0b-c11e");
      expect(markup).toContain("groups");
    });
  });
});

/**
 * The 404 (campaign admin-window/BUG-0014).
 *
 * Next serves its own `HTTPAccessErrorFallback` for unmatched URLs unless the
 * app owns `not-found.tsx`, and that fallback draws `system-ui` type and
 * injects a `body{color:…;background:…}` stylesheet that overrides the token
 * layer for the whole document. These assert the surface is ours and carries
 * no styling of its own; that the built app actually serves it — with a 404,
 * and without the framework's stylesheet — is `tests/http/auth.http.test.ts`.
 */
describe("the not-found surface", () => {
  const markup = renderToStaticMarkup(NotFound());

  it("renders inside the Frame, on retired paths and on one that never existed", () => {
    // The root not-found renders through the root layout, so what decides
    // whether it wears the sidebar is the same predicate every page uses.
    for (const pathname of RETIRED_PATHS) {
      expect(isFramed(pathname), pathname).toBe(true);
    }
  });

  it("gives the page one h1 and words under it", () => {
    expect([...markup.matchAll(/<h1[\s>]/g)].length).toBe(1);
    expect(markup.replace(/<[^>]*>/g, "").trim().length).toBeGreaterThan(0);
  });

  it("carries no hard-coded hex, no arbitrary value and no styling of its own", () => {
    const classes = classesOf(markup);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((c) => /#[0-9a-f]{3,8}/i.test(c))).toEqual([]);
    expect(classes.filter((c) => c.includes("["))).toEqual([]);
    // The framework fallback styles every element inline and ships a <style>
    // element of its own; ours does neither.
    expect(markup).not.toMatch(/style="/);
    expect(markup).not.toMatch(/<style[\s>]/);
  });

  it("sizes text only through the five type steps", () => {
    const classes = classesOf(markup);
    const LEGACY = /^(text-(xs|sm|base|lg|xl|\d?xl)|text-\[)/;
    expect(classes.filter((c) => LEGACY.test(c))).toEqual([]);
    const steps = classes.filter((c) => c.startsWith("type-"));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(["type-figure", "type-title", "type-body", "type-data", "type-micro"]).toContain(step);
    }
  });

  it("offers a way back to a page that exists, without the back button", () => {
    const hrefs = [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    // Every link it offers is one of the window's own routes — each of which
    // is asserted to have a page.tsx on disk above — and the Dashboard is
    // among them.
    for (const href of hrefs) expect(SIX_ROUTES, href).toContain(href);
    expect(hrefs).toContain("/");
  });
});

/**
 * The Frame's nav states (campaign admin-window/BUG-0015).
 *
 * LOOK_AND_FEEL, the Frame: "Active item = chrome-inverse fill … with primary
 * text". That fill is the window's ONE claim of place, so no other item and no
 * other state may wear it — the shipped sidebar handed the identical pair to
 * hover, and two items read as current whenever the pointer was in the
 * sidebar.
 *
 * These assert the invariant, not the palette: whatever classes distinguish
 * the active item, no element in the Frame may reach them through `hover:`,
 * and the set an item wears under the pointer is never the set the active item
 * wears. A retoken of the Look leaves them green; a convergence reddens them.
 */
describe("the Frame's nav states", () => {
  interface Element {
    readonly tag: string;
    readonly attrs: string;
    readonly classes: ReadonlySet<string>;
  }

  /** Every element the markup emits, with its own class list kept per element. */
  function elementsOf(html: string): Element[] {
    return [...html.matchAll(/<([a-z][a-z0-9]*)\s([^>]*?)\/?>/g)].map(([, tag, attrs]) => ({
      tag,
      attrs,
      classes: new Set(
        (/class="([^"]*)"/.exec(attrs)?.[1] ?? "").split(/\s+/).filter(Boolean),
      ),
    }));
  }

  /**
   * The classes an element renders with while the pointer is on it.
   *
   * A `hover:` utility wins over a resting utility of the same property — a
   * hovered `hover:text-ink` on a resting `text-ink-secondary` computes one
   * colour, not two — so this drops the resting class of any property the
   * hover state also sets. That is what makes the comparison below the same
   * comparison the designer made in the browser: the pair the pointer
   * actually computes, against the pair the active item computes.
   */
  function underPointer(el: Element): string[] {
    const property = (c: string): string => c.split("-")[0];
    const hovered = [...el.classes]
      .filter((c) => c.startsWith("hover:"))
      .map((c) => c.slice("hover:".length));
    const overridden = new Set(hovered.map(property));
    const rest = [...el.classes].filter(
      (c) => !c.startsWith("hover:") && !overridden.has(property(c)),
    );
    return [...new Set([...rest, ...hovered])].sort();
  }

  const resting = (el: Element): string[] => [...el.classes].sort();

  function frame(pathname: string) {
    const markup = renderToStaticMarkup(h(Sidebar, { pathname }));
    const elements = elementsOf(markup);
    const links = elements.filter((el) => el.tag === "a");
    const active = links.filter((el) => el.attrs.includes('aria-current="page"'));
    const signOut = elements.filter((el) => el.tag === "button");
    return { markup, elements, links, active, signOut };
  }

  it("marks exactly one item as the page, on every route", () => {
    for (const pathname of [...SIX_ROUTES, "/queues/2f0b"]) {
      const { links, active } = frame(pathname);
      expect(links.length, pathname).toBe(NAV_ITEMS.length);
      expect(active.length, pathname).toBe(1);
    }
  });

  it("never lets a non-active item wear the active item's rendering, pointer or not", () => {
    const { links, active } = frame("/");
    const inactive = links.filter((el) => el !== active[0]);
    expect(inactive.length).toBeGreaterThan(0);
    for (const el of inactive) {
      // The bug: hovered "Queues" computed the same fill and ink as active
      // "Dashboard". The set an item wears under the pointer must never be
      // the set the active item wears.
      expect(underPointer(el)).not.toEqual(resting(active[0]));
      expect(resting(el)).not.toEqual(resting(active[0]));
      // …and it must actually change under the pointer, or hover says nothing.
      expect(underPointer(el)).not.toEqual(resting(el));
    }
  });

  it("spends the active item's fill on the active item and on no state of any other", () => {
    const { links, active, elements } = frame("/");
    // The Look gives the active item a fill of its own; whatever token that
    // is, it is the window's claim of place.
    const fills = (el: Element, prefix = ""): string[] =>
      [...el.classes].filter((c) => c.startsWith(`${prefix}bg-`));
    const claim = fills(active[0]);
    expect(claim.length).toBe(1);

    for (const el of elements) {
      if (el === active[0]) continue;
      // No other element rests in it…
      expect(fills(el), `${el.tag} rests in the active fill`).not.toContain(claim[0]);
      // …and none — nav item or sign-out — hovers into it.
      expect(fills(el, "hover:"), `${el.tag} hovers into the active fill`).not.toContain(
        `hover:${claim[0]}`,
      );
    }
    // The hover fill the items do use is a real fill, not the absence of one:
    // hover is a state of its own, distinct from resting and from active.
    const hoverFills = new Set(links.flatMap((el) => fills(el, "hover:")));
    expect(hoverFills.size).toBe(1);
  });

  it("keeps sign-out an action, in every state, including under the pointer", () => {
    const { links, signOut } = frame("/");
    expect(signOut.length).toBe(1);
    const control = signOut[0];
    // It is not a link and never claims a place in the window.
    expect(control.attrs).not.toContain("href=");
    expect(control.attrs).not.toContain("aria-current");
    // It carries none of the nav items' hover classes, so the pointer cannot
    // dress it as a seventh nav item…
    const navHover = new Set(
      links.flatMap((el) => [...el.classes].filter((c) => c.startsWith("hover:"))),
    );
    for (const c of navHover) expect(control.classes.has(c)).toBe(false);
    // …and its rendering is not a nav item's, resting or hovered.
    for (const el of links) {
      expect(resting(control)).not.toEqual(resting(el));
      expect(underPointer(control)).not.toEqual(underPointer(el));
    }
  });

  it("keeps the colour transition and touches no focus outline", () => {
    const { elements } = frame("/");
    const interactive = elements.filter((el) => el.tag === "a" || el.tag === "button");
    expect(interactive.length).toBe(NAV_ITEMS.length + 1);
    for (const el of interactive) {
      // The Look's whole motion budget here: a colour transition at the
      // token's 120ms default. Nothing sets its own duration.
      expect(el.classes.has("transition-colors"), el.tag).toBe(true);
      expect([...el.classes].filter((c) => c.startsWith("duration-"))).toEqual([]);
      // Quality bar 9: the focus ring is global CSS and no component opts out
      // of it, nor carries the hover distinction on a focus utility.
      expect([...el.classes].filter((c) => c.startsWith("focus"))).toEqual([]);
      expect(el.classes.has("outline-none")).toBe(false);
    }
  });
});
