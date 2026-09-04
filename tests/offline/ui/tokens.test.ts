import { describe, expect, it } from "vitest";

import { EditStatus, EditableCell } from "@/components/EditableCell";
import { EvidencePair } from "@/components/evidence/evidence-pair";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { Empty } from "@/components/ui/empty";
import { ErrorLine } from "@/components/ui/error-line";
import { Loading } from "@/components/ui/loading";
import { NotProvisioned } from "@/components/ui/not-provisioned";
import { Page } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { StatCard } from "@/components/ui/stat-card";

import { classesOf, h, render } from "./markup";

/**
 * Token discipline, asserted against the markup every primitive actually
 * emits (campaign admin-window, TASK-0004).
 *
 * ARCHITECTURE §7: "Builders consume tokens and primitives, never raw values.
 * A hex code, an arbitrary `text-[13px]`, or a `rounded-lg` in a page file is
 * a defect." If the primitives themselves break that, every page inherits it,
 * so the rule is enforced here at its source.
 */

type Sample = { name: string; html: string };

const BADGE_TONES = ["neutral", "high", "low", "healthy", "broken"] as const;
const BUTTON_VARIANTS = ["primary", "secondary", "destructive"] as const;
const STAT_TONES = ["default", "healthy", "attention", "broken", "accent"] as const;

const row = { id: "a", source: "ticketmaster", failures: 1234 };

const SAMPLES: Sample[] = [
  { name: "Page", html: render(h(Page, { title: "Queues", actions: h(Button, {}, "Close") }, "body")) },
  { name: "Section", html: render(h(Section, { title: "Runs" }, "body")) },
  {
    name: "DataTable",
    html: render(
      h(DataTable<typeof row>, {
        columns: [
          { key: "source", label: "source", sort: { href: "?s=source", active: "asc" }, cell: (r) => r.source },
          { key: "failures", label: "failures", align: "right", sort: { href: "?s=failures" }, cell: () => null },
        ],
        rows: [row],
        rowKey: (r) => r.id,
        label: "runs",
      }),
    ),
  },
  {
    // The MARKED row is a second rendering of this primitive, and the rules
    // below only ever saw the first (admin-window/BUG-0054, QA probe): no
    // shadow, no animation, no arbitrary value, palette jobs only, 1px
    // borders. A rendering no sample reaches is a rendering no rule binds.
    name: "DataTable/marked",
    html: render(
      h(DataTable<typeof row>, {
        columns: [
          { key: "source", label: "source", cell: (r) => r.source },
          { key: "failures", label: "failures", align: "right", cell: (r) => r.failures },
        ],
        rows: [row],
        rowKey: (r) => r.id,
        marked: () => true,
        label: "runs",
      }),
    ),
  },
  { name: "StatCard", html: render(h(StatCard, { label: "decisions", value: 1234, sub: "oldest 3d", href: "/queues" })) },
  { name: "StatCard/null", html: render(h(StatCard, { label: "decisions", value: null })) },
  // every tone and variant renders here: a rule that only sees the default is
  // a rule the next variant walks straight past.
  ...STAT_TONES.map((tone) => ({
    name: `StatCard/${tone}`,
    html: render(h(StatCard, { label: "failed", value: 2, tone })),
  })),
  ...BADGE_TONES.map((tone) => ({ name: `Badge/${tone}`, html: render(h(Badge, { tone, children: "value" })) })),
  { name: "Chip/active", html: render(h(Chip, { label: "decision", href: "/q", active: true })) },
  { name: "Chip", html: render(h(Chip, { label: "signal", href: "/q" })) },
  ...BUTTON_VARIANTS.flatMap((variant) =>
    [false, true].map((disabled) => ({
      name: `Button/${variant}${disabled ? "/disabled" : ""}`,
      html: render(h(Button, { variant, disabled }, "Save override")),
    })),
  ),
  { name: "Loading", html: render(h(Loading, { what: "cycles" })) },
  { name: "Empty", html: render(h(Empty, { holds: "open decisions", filledBy: "the resolver files one here" })) },
  {
    name: "Empty/eyebrow",
    html: render(
      h(Empty, { holds: "open decisions", filledBy: "the resolver files one here", eyebrow: "cycle health" }),
    ),
  },
  { name: "NotProvisioned", html: render(h(NotProvisioned, { missing: "verdicts", arrivesWith: "a migration" })) },
  {
    name: "NotProvisioned/eyebrow",
    html: render(h(NotProvisioned, { missing: "verdicts", arrivesWith: "a migration", eyebrow: "cycle health" })),
  },
  { name: "ErrorLine", html: render(h(ErrorLine, { reading: "verdicts", failed: "no relation", retry: "reload" })) },
  {
    name: "EvidencePair",
    html: render(
      h(EvidencePair, {
        claims: [
          { id: "1", value: "a", source: "ticketmaster", tier: "primary", observedAt: "2026-08-26T04:12:00Z" },
          { id: "2", value: null, source: "bandsintown", tier: "secondary", observedAt: "2026-08-28T04:12:00Z" },
        ],
        canonical: { value: "a", provenance: "ticketmaster, applied 3d ago" },
      }),
    ),
  },
  {
    name: "EditableCell",
    html: render(h(EditableCell, { value: "BLACKPINK", onSave: async () => ({ ok: true }) as const, label: "name" })),
  },
  // The cell's three told states (admin-window/BUG-0066). They are reachable
  // only from React state, so the sample above — the resting cell — is the
  // only rendering these rules ever saw, and a raw ramp step in the in-flight
  // line would have walked straight past them.
  ...(["saving", "saved"] as const).map((kind) => ({
    name: `EditStatus/${kind}`,
    html: render(h(EditStatus, { status: { kind } })),
  })),
  {
    name: "EditStatus/failed",
    html: render(h(EditStatus, { status: { kind: "failed", message: "not editable" } })),
  },
];

function everyClass(): { sample: string; className: string }[] {
  return SAMPLES.flatMap((sample) =>
    classesOf(sample.html).map((className) => ({ sample: sample.name, className })),
  );
}

function offenders(predicate: (className: string) => boolean) {
  return everyClass()
    .filter(({ className }) => predicate(className))
    .map(({ sample, className }) => `${sample}: ${className}`);
}

describe("the primitives", () => {
  it("render markup at all, so the rules below are asserted against something", () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(24);
    for (const sample of SAMPLES) expect(sample.html.length).toBeGreaterThan(10);
    expect(everyClass().length).toBeGreaterThan(50);
  });

  it("use no arbitrary value and no literal colour", () => {
    expect(offenders((c) => c.includes("["))).toEqual([]);
    expect(offenders((c) => /#[0-9a-f]{3,8}/i.test(c))).toEqual([]);
    for (const sample of SAMPLES) expect(sample.html).not.toMatch(/style="/);
  });

  it("name a palette job rather than a raw ramp step — and blue stays retired", () => {
    const RAMP = /-(gray|slate|zinc|neutral|stone|purple|violet|green|emerald|amber|orange|yellow|red|rose|blue|sky|indigo|pink|fuchsia)-\d{2,3}$/;
    expect(offenders((c) => RAMP.test(c))).toEqual([]);
    expect(offenders((c) => /(^|:)(bg|text|border)-(white|black)$/.test(c))).toEqual([]);
    expect(offenders((c) => c.includes("blue"))).toEqual([]);
  });

  it("carry no dark: variant, because a palette job flips itself", () => {
    expect(offenders((c) => c.startsWith("dark:"))).toEqual([]);
  });

  it("size text only through the five type steps", () => {
    const LEGACY = /^(text-(xs|sm|base|lg|xl|\d?xl)|text-\[)/;
    expect(offenders((c) => LEGACY.test(c))).toEqual([]);
    const steps = everyClass().filter(({ className }) => className.startsWith("type-"));
    expect(steps.length).toBeGreaterThan(0);
    for (const { className } of steps) {
      expect(["type-figure", "type-title", "type-body", "type-data", "type-micro"]).toContain(className);
    }
  });

  it("space only on the 2/4/6/8/12/16/24 scale", () => {
    const SPACING =
      /^-?(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|top|right|bottom|left|inset|w|h|size|min-w|min-h|max-w|max-h)-([0-9.]+)$/;
    const IN_SCALE = new Set(["0", "0.5", "1", "1.5", "2", "3", "4", "6"]); // px: 0 2 4 6 8 12 16 24
    const bad = everyClass().filter(({ className }) => {
      const match = SPACING.exec(className);
      return match !== null && !IN_SCALE.has(match[2]);
    });
    expect(bad.map((b) => `${b.sample}: ${b.className}`)).toEqual([]);
  });

  it("round only interactive controls, and only at the control radius", () => {
    const rounded = everyClass().filter(({ className }) => className.startsWith("rounded"));
    for (const { className } of rounded) {
      expect(["rounded-control", "rounded-full"]).toContain(className);
    }
  });

  it("never suppress an outline and never animate outside the motion budget", () => {
    expect(offenders((c) => c.includes("outline-none"))).toEqual([]);
    expect(offenders((c) => /^(animate-|motion-safe:animate)/.test(c))).toEqual([]);
    expect(offenders((c) => /^duration-/.test(c))).toEqual([]); // the 120ms default is a token
  });

  it("draw structure with 1px hairlines, never with elevation", () => {
    expect(offenders((c) => c.startsWith("shadow"))).toEqual([]);
    const borders = everyClass().filter(({ className }) => /^border(-|$)/.test(className));
    for (const { className } of borders) {
      // border, border-t/l/r/b (all 1px) or the colour token — never border-2/4/8
      expect(className).not.toMatch(/^border(-[trblxy])?-\d+$/);
    }
  });
});
