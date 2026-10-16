import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { BrowseTable } from "@/components/browse/browse-table";
import { recordFields } from "@/components/records/fields";
import { RECENT_EVENTS, type BrowseColumnKey } from "@/lib/browse/views";
import { editConfigFor } from "@/lib/edit/config";
import { recordHref } from "@/lib/records/routes";
import { codeLines, codeText, sourceFiles } from "../source-tree";
import { h, render } from "../ui/markup";

/**
 * The app's ONE record URL (campaign admin-window/DEBT-0001).
 *
 * The behavioural cases of this function are asserted where its callers are —
 * `claims/filters.test.ts` (where a claim leads), `browse/views.test.ts` (the
 * record link) and the page suites that check a rendered href — and the fold
 * rewrote none of them, because the fold changed no URL. What is asserted
 * HERE is what the fold bought and nothing else: that there is exactly one
 * spelling of the template in `src/`, that it stayed a leaf, and that the two
 * shapes the old pair disagreed about (a null answer, an events-only domain)
 * are now one shape.
 */

describe("recordHref", () => {
  it("names one canonical row, whatever its domain", () => {
    expect(recordHref("events", "e-1")).toBe("/records/events/e-1");
    expect(recordHref("venues", "v-1")).toBe("/records/venues/v-1");
    expect(recordHref("groups", "g-1")).toBe("/records/groups/g-1");
  });

  it("encodes BOTH halves, because both are data", () => {
    // Either half could otherwise change the path it is supposed to name —
    // the one Browse's old spelling encoded and the one it hard-coded are
    // now encoded by the same line.
    expect(recordHref("a b", "c/d?e")).toBe("/records/a%20b/c%2Fd%3Fe");
    expect(recordHref("events", "a b#c")).toBe("/records/events/a%20b%23c");
  });

  it("answers null when there is no canonical row to lead to", () => {
    // `awaiting_row`: no fact exists yet, so the caller names what it is
    // waiting for, or renders unlinked — never a link to nothing.
    expect(recordHref("events", null)).toBeNull();
    expect(recordHref("events", "")).toBeNull();
  });
});

/* ── the fold this module exists to keep ─────────────────────────────────── */

describe("one spelling of the record URL", () => {
  const LEAF = "src/lib/records/routes.ts";

  it("contains the module this rule is about", () => {
    expect(sourceFiles()).toContain(LEAF);
  });

  it("is the only file in src/ that builds the record URL", () => {
    // The ticket's own check, asserted here so it survives the check list: a
    // template literal whose text opens the records path and interpolates.
    // `components/records/submit.ts` builds the PATCH endpoint under `/api`,
    // a different URL, and its `/api` prefix is what keeps it out.
    const builds = /`\/records\/[^`]*\$\{/;
    const builders = sourceFiles().filter((file) => builds.test(codeText(file)));
    expect(builders).toEqual([LEAF]);
  });

  it("keeps the leaf a leaf: it imports nothing at all", () => {
    // ARCHITECTURE §4 rule 7. It cannot live in `lib/browse/rows.ts` or
    // `lib/claims/filters.ts` for the same reason: those are leaves too, and
    // a leaf importing a leaf is a sideways arrow the module map lacks.
    const imports = codeLines(LEAF).filter((line) =>
      /^\s*import\b|\brequire\s*\(|\bfrom\s+["']/.test(line),
    );
    expect(imports).toEqual([]);
  });

  it("exports one function, with no never-null or events-only variant beside it", () => {
    const declarations = /export\s+(?:function|const)\s+(\w+)/g;
    const exported = [...codeText(LEAF).matchAll(declarations)].map(
      (match) => match[1],
    );
    expect(exported).toEqual(["recordHref"]);
  });

  it("leaves the two old names spelled nowhere in src/ as code", () => {
    // The `provenanceHref` PROP on `components/claims/claim-list.tsx` is a
    // row field, not the helper, and stays: this looks for a call.
    const called = /\b(?:provenanceHref|eventRecordHref)\s*\(/;
    const offenders = sourceFiles().filter((file) =>
      codeLines(file).some((line) => called.test(line)),
    );
    expect(offenders).toEqual([]);
  });
});

/* ── QA (admin-window/DEBT-0001): the fold held at the rendered surfaces ──── */

describe("the same URL arrives at every surface that draws one", () => {
  // The fold's whole claim is that two surfaces that used to spell the route
  // themselves now render exactly what the one helper returns. Asserted on the
  // MARKUP and on the field the edit surface hands its link component, for an
  // id that actually needs encoding — the case where two spellings would drift
  // first, and the one neither surface's own suite drives.
  const NEEDS_ENCODING = "a/b?c d#e";

  it("browse draws the helper's href verbatim in the row's anchor", () => {
    const markup = render(
      h(BrowseTable, {
        view: RECENT_EVENTS,
        shown: ["title"] as BrowseColumnKey[],
        rows: [
          {
            event_id: NEEDS_ENCODING,
            title: "a row that links",
            description: null,
            poster_url: null,
            starts_at: null,
            created_at: null,
            venue_name: null,
            sources: [],
          },
        ],
      }),
    );
    expect(cheerio.load(markup)("a").attr("href")).toBe(
      recordHref("events", NEEDS_ENCODING),
    );
  });

  it("the edit surface's reference field carries the helper's href verbatim", () => {
    // `events.venue_id` is the one reference column in the map today.
    const config = editConfigFor("events");
    expect(config).not.toBeNull();
    const venue = recordFields(
      config!,
      { venue_id: NEEDS_ENCODING },
      new Map(),
      "a venue",
    ).find((field) => field.name === "venue_id");
    expect(venue?.reference?.href).toBe(recordHref("venues", NEEDS_ENCODING));
  });
});
