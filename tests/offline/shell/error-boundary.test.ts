import { describe, expect, it, vi } from "vitest";

import { classesOf, h, render, runTogetherWords } from "../ui/markup";

/**
 * The route-level error boundary, `src/app/error.tsx` (campaign
 * admin-window/TASK-0082).
 *
 * What it renders is graded here with `renderToStaticMarkup` and the
 * framework's `usePathname` replaced by a fixed route — the component takes
 * nothing else from the client runtime. That a THROW in a real route reaches
 * it, inside the Frame, is a property of Next's mounting and was walked once
 * against a production build (the ticket's hand-back), not re-run here.
 *
 * What this file does NOT pin: that a `not_provisioned` answer still renders
 * its own card and never reaches a boundary. Every surface is already
 * rendered against a database lacking each object it reads, card asserted,
 * in `tests/offline/absence/pages.test.ts` ("survives %s being absent",
 * "against a database that lacks every ecosystem object") — a render that
 * threw there would fail those cases outright, so a second pin here would
 * restate them.
 */

const nav = vi.hoisted(() => ({ pathname: "/claims" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

// Imported after the mock is registered; vitest hoists `vi.mock` above
// imports, so the order here is for the reader.
import RouteError, { NO_DIGEST, RENDER_FIX } from "@/app/error";

/** A render error as a page would throw it — a message no operator should read. */
function thrown(digest?: string): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error(
    "TypeError: row.name.trim is not a function",
  );
  if (digest !== undefined) error.digest = digest;
  return error;
}

/** The text of every element wearing `step`. */
function textsIn(html: string, step: string): string[] {
  return [...html.matchAll(/<(\w+)[^>]*class="([^"]*)"[^>]*>([^<]*)<\/\1>/g)]
    .filter(([, , classes]) => classes.split(/\s+/).includes(step))
    .map(([, , , text]) => text);
}

describe("the route-level error boundary", () => {
  const ROUTE = "/claims";

  /**
   * The bug this catches: a boundary that prints the error's MESSAGE (a
   * redaction from a server render, a stack-shaped sentence from a client
   * one), drops the digest an operator needs to match a server log, or draws
   * a blank mono box when the digest is missing or blank.
   */
  it.each([
    ["a digest", "1234567890", "1234567890"],
    ["no digest", undefined, null],
    ["a blank digest", "   ", null],
  ])("with %s says the route, the token verbatim in mono, and the fix", (_, digest, shown) => {
    const error = thrown(digest);
    const html = render(h(RouteError, { error }));

    // The route, named, in the mono face — once as the h1's identifier and
    // once as the object of the red line — and never inside the uppercasing
    // title step, which would rewrite its case.
    expect([...html.matchAll(/<h1[\s>]/g)].length).toBe(1);
    expect(textsIn(html, "type-data").some((text) => text.startsWith(ROUTE))).toBe(true);
    for (const text of textsIn(html, "type-title")) expect(text).not.toContain(ROUTE);
    expect(html).toContain(`data-render-failed="${ROUTE}"`);

    // The machine's token wears the mono face; the app's words do not.
    const mono = textsIn(html, "type-data").join("\n");
    const sans = textsIn(html, "type-body").join("\n");
    if (shown === null) {
      expect(mono).not.toContain(NO_DIGEST);
      expect(sans).toContain(NO_DIGEST);
    } else {
      expect(mono).toContain(shown);
      expect(sans).not.toContain(shown);
    }
    expect(sans).toContain(RENDER_FIX);
    expect(mono).not.toContain(RENDER_FIX);

    // No cause invented, no stack quoted, no database fact stated.
    expect(html).not.toContain(error.message);
    expect(html).not.toContain("at ");
    expect(html).not.toMatch(/verdicts|review_items|PGRST/);

    // The shared refusal line, with the hooks every failed read carries.
    expect(html).toContain('data-state="error"');
    expect(html).toContain('role="alert"');
    expect(classesOf(html)).toContain("text-broken");
    expect(runTogetherWords(html)).toEqual([]);
  });

  it("carries no hard-coded colour, no arbitrary value, and only the five type steps", () => {
    const html = render(h(RouteError, { error: thrown("abc") }));
    const classes = classesOf(html);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((c) => /#[0-9a-f]{3,8}/i.test(c))).toEqual([]);
    expect(classes.filter((c) => c.includes("["))).toEqual([]);
    expect(classes.filter((c) => /^(text-(xs|sm|base|lg|xl|\d?xl)|text-\[)/.test(c))).toEqual([]);
    expect(html).not.toMatch(/style="/);
    const steps = classes.filter((c) => c.startsWith("type-"));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(["type-figure", "type-title", "type-body", "type-data", "type-micro"]).toContain(step);
    }
  });
});
