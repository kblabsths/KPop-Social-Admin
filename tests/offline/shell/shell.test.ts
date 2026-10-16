import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isFramed, isNavItemActive } from "@/components/shell/nav-items";
import { Sidebar } from "@/components/shell/shell";

import { codeText, sourceFiles } from "../source-tree";
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
  // The legacy pipeline's two dashboards, retired 2026-08-26 with it
  // (`AGENTS.md`). They predate this rebuild and were never in the sidebar,
  // but a stale bookmark and — until admin-window/TASK-0061 — the README
  // still pointed at them, so they belong in the same 404 set as the rest.
  "/scrapers",
  "/review",
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

/**
 * The README, the repo's front door (campaign admin-window/TASK-0061).
 *
 * It is navigation too — the first thing a new reader follows — so it is held
 * to the same honesty the not-found surface is: it may not send anyone at a
 * page that 404s, or at a file or a script that is not here. The assertions
 * below are structural on purpose. None of them pins a sentence, a heading or
 * a word of the prose; what they pin is that every ADDRESS the prose offers
 * resolves, which is the property the doc drift broke.
 */
describe("the README's front door", () => {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

  /**
   * The backticked tokens that look like a path: no spaces, and carrying a
   * `/` or a `.`. Commands (`npm …`, `npx …`) are words, not paths, and are
   * covered by their own assertion below; a bare identifier like a table or
   * an environment-variable name has neither separator and never lands here.
   */
  const backticked = [...readme.matchAll(/`([^`]+)`/g)].map(([, token]) => token);
  const pathLike = [
    ...new Set(
      backticked.filter(
        (token) => /^[\w.@/-]+$/.test(token) && /[./]/.test(token) && !/^np[mx]$/.test(token),
      ),
    ),
  ];

  /**
   * Files the repo deliberately does not track. `.env` holds values, so it
   * exists on a developer's machine and never in a checkout — naming it is
   * the point of the environment section.
   */
  const UNTRACKED_BY_DESIGN = new Set([".env"]);

  /**
   * Every environment name the app's own code reads, taken from the SOURCE
   * TREE — the thing this repo tracks (`../source-tree`, the one walker) —
   * and comment-stripped, so the many doc comments that say a module reaches
   * no `process.env` are not mistaken for reads.
   *
   * The first cut of this guard read `.env.example` off disk instead and
   * required every name the README documents to be declared there. That made
   * the suite's colour depend on UNCOMMITTED state: that file carries a local
   * edit implementing the ruling of 2026-09-03 (`agenticflow/docs/DECISIONS.md`
   * — the two names the app reads are in no file at all any more), so the case
   * was green in a git worktree, which checks out HEAD, and red in the primary
   * checkout, which is where `ci_check` and Ben run it (admin-window/BUG-0165).
   * A guard grades what the repo tracks; an env FILE is never that, in either
   * direction — committing that edit would redden a correct README just as
   * surely, since the app really does read both names.
   */
  const APP_ENV_READS = [
    ...new Set(
      sourceFiles().flatMap((file) =>
        [...codeText(file).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(([, name]) => name),
      ),
    ),
  ].sort();

  /** The backticked tokens shaped like an environment name: `A_B`, not `RLS`. */
  const envNames = [
    ...new Set(backticked.filter((token) => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(token))),
  ];

  it("names every one of the six pages", () => {
    for (const href of NAV_ITEMS.map((item) => item.href)) {
      if (href === "/") continue; // the root is not a searchable token
      expect(readme.includes(`\`${href}\``), `README does not name ${href}`).toBe(true);
    }
  });

  /** Which retired surfaces a piece of prose sends a reader at, if any. */
  const retiredNamedBy = (text: string): string[] =>
    RETIRED_PATHS.filter((retired) => text.includes(retired));

  it("sends nobody at a surface that 404s", () => {
    expect(retiredNamedBy(readme)).toEqual([]);
    // …and the check has teeth: the same predicate flags prose that does send
    // a reader at one, which is the drift this ticket found in the README.
    expect(retiredNamedBy("run the scraper dashboard at /scrapers")).toEqual(["/scrapers"]);
  });

  it("names no run instruction that has moved on", () => {
    // The two the retired dashboard's README carried: an env file this app has
    // never read, and a hard-coded port. Where the app actually listens, and
    // under which names, is STACK.md §5's to say — and the README points there
    // rather than keeping a second copy that can drift from it.
    expect(readme).not.toContain(".env.local");
    expect(readme).not.toContain(":3000");
    expect(readme).toContain("agenticflow/docs/STACK.md");
  });

  it("names only paths that are in the repo", () => {
    // Relative paths only: a leading `/` is an app route, checked against
    // `src/app` by the assertion below rather than against the repo root.
    const files = pathLike.filter((token) => !token.startsWith("/"));
    expect(files.length).toBeGreaterThan(10);
    const missing = files.filter(
      (token) =>
        !UNTRACKED_BY_DESIGN.has(token) && !fs.existsSync(path.join(repoRoot, token)),
    );
    expect(missing).toEqual([]);
  });

  it("names only app routes that have a page on disk", () => {
    // A route is `/…` rather than a relative path, so it is checked against
    // `src/app` and not the repo root. `/records/` is a parameterised segment:
    // the directory is what exists, the page lives under its two params.
    const routes = pathLike.filter((token) => token.startsWith("/"));
    expect(routes.length).toBeGreaterThan(0);
    const missing = routes.filter(
      (route) => !fs.existsSync(path.join(repoRoot, "src", "app", route.replace(/\/$/, ""))),
    );
    expect(missing).toEqual([]);
  });

  it("names only scripts that package.json defines", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ).scripts as Record<string, string>;
    const named = [...new Set(backticked.filter((token) => token.startsWith("npm run ")))];
    expect(named.length).toBeGreaterThan(3);
    for (const command of named) {
      const script = command.slice("npm run ".length).split(" ")[0];
      expect(Object.keys(scripts), `${command} is not a script`).toContain(script);
    }
    // `npm test` is the one script npm runs without `run`.
    if (readme.includes("`npm test`")) expect(Object.keys(scripts)).toContain("test");
  });

  it("documents every environment name the app itself reads", () => {
    // A name the app cannot start without, absent from the front door, is the
    // drift worth catching — and it is decided by `src/`, not by any env file.
    expect(APP_ENV_READS).not.toEqual([]);
    for (const name of APP_ENV_READS) {
      expect(readme.includes(`\`${name}\``), `README does not document ${name}`).toBe(true);
    }
  });

  it("prints no value beside any environment name it documents", () => {
    expect(envNames.length).toBeGreaterThan(5);
    const assigned = (text: string, name: string): boolean =>
      new RegExp(`${name}\\s*=\\s*\\S`).test(text);
    for (const name of envNames) {
      expect(assigned(readme, name), `README assigns a value to ${name}`).toBe(false);
    }
    // Teeth: the same predicate flags an assignment, so the zero above is a
    // read that could have found one.
    expect(assigned('AUTH_URL="http://example.invalid"', "AUTH_URL")).toBe(true);
  });

  it("grades itself from tracked files alone", () => {
    // The property BUG-0165 cost: every input to the cases above is either the
    // README, the source tree or `package.json`, so this file's verdict is the
    // same in the primary checkout and in a worktree. Reading an env file back
    // in — for a "declared" set, for a name list, for anything — reintroduces
    // an untracked judge, so the read itself is what is banned here.
    const filesRead = (source: string): string[] =>
      [...source.matchAll(/readFileSync\(\s*path\.join\(([^)]*)\)/g)].map(([, args]) =>
        args.replace(/\s+/g, " ").trim(),
      );
    const self = fs.readFileSync(
      path.join(repoRoot, "tests", "offline", "shell", "shell.test.ts"),
      "utf8",
    );
    expect(filesRead(self).length).toBeGreaterThan(1);
    expect(filesRead(self).filter((args) => /\.env/.test(args))).toEqual([]);

    // Teeth: the same scan finds the read this ticket removed, so the empty
    // list above is a search that could have found one. The probe is spelled
    // in two halves because the scan above reads THIS file: written whole, the
    // literal would be a match in its own right and redden the assertion.
    const probe = `fs.read${'FileSync(path.join(repoRoot, ".env.example"), "utf8")'}`;
    expect(filesRead(probe)).toEqual(['repoRoot, ".env.example"']);
  });
});

describe("the active nav item", () => {
  it("lights the Dashboard on the Dashboard alone", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    for (const href of SIX_ROUTES.slice(1)) {
      expect(isNavItemActive(href, "/"), href).toBe(false);
    }
    expect(isNavItemActive("/records/events/abc", "/")).toBe(false);
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
    for (const pathname of [...SIX_ROUTES, "/queues/2f0b", "/records/events/abc"]) {
      const lit = NAV_ITEMS.filter((item) => isNavItemActive(pathname, item.href));
      expect(lit.length, pathname).toBeLessThanOrEqual(1);
    }
  });
});

describe("the Frame", () => {
  it("wraps every page of the window", () => {
    for (const pathname of [...SIX_ROUTES, "/queues/2f0b", "/records/events/abc"]) {
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
        await RecordPage({ params: Promise.resolve({ table: "events", id: "abc" }) }),
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
        await RecordPage({ params: Promise.resolve({ table: "events", id: "2f0b-c11e" }) }),
      );
      expect(markup).toContain("2f0b-c11e");
      expect(markup).toContain("events");
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

  it("keeps the active item's claim of place while the pointer is on it", () => {
    // The other half of BUG-0015, and the one the fix's own guards do not
    // reach: the tests above stop a non-active item from wearing the active
    // rendering, but nothing stopped the active item from LOSING it under the
    // pointer. A hover utility written on the shared part of the className —
    // the easy edit — would flip the active item to the hover fill too, and
    // then while the pointer is in the sidebar NO item claims the place. The
    // Frame's claim of place is a property of the route, not of the mouse.
    const { active } = frame("/");
    const el = active[0];
    expect(underPointer(el)).toEqual(resting(el));

    // …and the check has teeth: the same helper reports a change for an item
    // that does carry a hover fill over its resting one.
    const wouldFlip = {
      tag: "a",
      attrs: 'aria-current="page"',
      classes: new Set(["bg-chrome-inverse", "text-ink", "hover:bg-surface"]),
    };
    expect(underPointer(wouldFlip)).not.toEqual(resting(wouldFlip));
  });
});
