import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Quality bar 12, measured rather than asserted by eye (campaign
 * admin-window, BUG-0006).
 *
 * LOOK_AND_FEEL.md: "every string a person reads to act measures >=4.5:1
 * against the fill behind it — page, surface or chrome; the active nav item's
 * chrome-inverse fill carries primary text only, and the
 * disabled/placeholder/null gray is exempt by job."
 *
 * The token layer is the whole palette (Tailwind 4 is CSS-first, there is no
 * tailwind.config.js), so this file reads the token VALUES out of globals.css
 * and computes WCAG 2.x contrast itself. It asserts ratios, never hexes: any
 * hex that clears the bar for its job is free to change, and any hex that
 * does not — every mid step this palette retired — reddens the suite.
 */

const CSS = readFileSync(
  fileURLToPath(new URL("../../../src/app/globals.css", import.meta.url)),
  "utf8",
);

/** Text jobs: a person reads these to act, so each must clear the bar. */
const TEXT_JOBS = ["ink", "ink-secondary", "accent", "healthy", "attention", "broken"] as const;

/** The three fills text sits on. */
const FILLS = ["page", "surface", "chrome"] as const;

/**
 * Excluded BY NAME, per the palette's stated exemption: disabled, placeholder
 * and the null em dash must read quieter than a value, so they are asserted
 * BELOW the bar instead of above it.
 */
const EXEMPT_BY_JOB = "ink-disabled";

/** Jobs that are fills for a named partner rather than free-standing text. */
const PAIRED_FILLS = ["chrome-inverse", "accent"] as const;

const BAR = 4.5;

// ---------------------------------------------------------------- parsing

/** The body of the first `{...}` block after `marker`, brace-balanced. */
function blockAfter(css: string, marker: string): string {
  const at = css.indexOf(marker);
  expect(at, `globals.css has no ${marker} block`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at + marker.length);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${marker} in globals.css`);
}

/** Every `--color-<job>: <hex>` declaration in a block, as job -> hex. */
function colorTokens(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of block.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
    found.set(m[1], m[2].toLowerCase());
  }
  return found;
}

const lightBlock = blockAfter(CSS, "@theme");
const darkBlock = blockAfter(blockAfter(CSS, "@media (prefers-color-scheme: dark)"), ":root");

const light = colorTokens(lightBlock);
/** Dark theme is the light layer with the media query's overrides applied. */
const dark = new Map([...light, ...colorTokens(darkBlock)]);

const THEMES: ReadonlyArray<readonly [string, Map<string, string>]> = [
  ["light", light],
  ["dark", dark],
];

// ------------------------------------------------------------- WCAG 2.x

/** sRGB channel -> linear, per WCAG 2.x. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rgb` or `#rrggbb` value, per WCAG 2.x. */
function luminance(hex: string): number {
  const body = hex.slice(1);
  const full = body.length === 3 ? [...body].map((c) => c + c).join("") : body;
  expect(full, `unparsable colour ${hex}`).toMatch(/^[0-9a-f]{6}$/);
  const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two colours, per WCAG 2.x: (L1 + 0.05) / (L2 + 0.05). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function value(theme: Map<string, string>, job: string): string {
  const hex = theme.get(job);
  expect(hex, `globals.css defines no --color-${job}`).toBeDefined();
  return hex as string;
}

function ratio(theme: Map<string, string>, fg: string, bg: string): number {
  return contrast(value(theme, fg), value(theme, bg));
}

// ------------------------------------------------------------ the checks

describe("WCAG 2.x helper", () => {
  it("returns the reference ratios for black, white and mid gray", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // order must not matter, and #rgb must expand like #rrggbb
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#777777"), 10);
    expect(contrast("#fff", "#000")).toBeCloseTo(21, 5);
  });
});

describe("globals.css token layer", () => {
  it("defines every palette job in both themes", () => {
    const jobs = [...TEXT_JOBS, ...FILLS, ...PAIRED_FILLS, EXEMPT_BY_JOB, "on-accent", "hairline"];
    for (const [name, theme] of THEMES) {
      for (const job of jobs) expect(value(theme, job), `${name}/${job}`).toMatch(/^#[0-9a-f]{3,8}$/);
    }
  });

  it("classifies every colour token, so a new palette job cannot slip past the bar", () => {
    const classified = new Set<string>([
      ...TEXT_JOBS,
      ...FILLS,
      ...PAIRED_FILLS,
      EXEMPT_BY_JOB,
      "on-accent",
      "hairline", // a border, never a string a person reads
    ]);
    expect([...light.keys()].filter((job) => !classified.has(job))).toEqual([]);
  });

  it("gives the dark theme its own value for every colour job", () => {
    const overridden = colorTokens(darkBlock);
    expect([...light.keys()].filter((job) => !overridden.has(job))).toEqual([]);
  });

  it("keeps the disabled gray out of the text jobs it is exempted from", () => {
    expect([...TEXT_JOBS]).not.toContain(EXEMPT_BY_JOB);
  });
});

describe.each(THEMES)("%s theme meets quality bar 12", (themeName, theme) => {
  it.each(TEXT_JOBS.flatMap((job) => FILLS.map((fill) => [job, fill] as const)))(
    "%s on %s reads at 4.5:1 or better",
    (job, fill) => {
      const measured = ratio(theme, job, fill);
      expect(
        measured,
        `${themeName}: ${job} on ${fill} measures ${measured.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(BAR);
    },
  );

  it("reads primary text on the active nav item's chrome-inverse fill", () => {
    const measured = ratio(theme, "ink", "chrome-inverse");
    expect(
      measured,
      `${themeName}: ink on chrome-inverse measures ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(BAR);
  });

  it("reads on-accent text on the accent fill", () => {
    const measured = ratio(theme, "on-accent", "accent");
    expect(
      measured,
      `${themeName}: on-accent on accent measures ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(BAR);
  });

  it.each(FILLS)("keeps the disabled gray quieter than a value on %s", (fill) => {
    const measured = ratio(theme, EXEMPT_BY_JOB, fill);
    expect(
      measured,
      `${themeName}: ${EXEMPT_BY_JOB} on ${fill} measures ${measured.toFixed(2)}:1 — a null must not read as loud as a value`,
    ).toBeLessThan(BAR);
  });
});
