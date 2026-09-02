import { describe, expect, it } from "vitest";
import { currentDecisions } from "@/lib/browse/rows";
import {
  fieldProvenanceOf,
  namedSourceIds,
  type FieldDecisionRow,
} from "@/lib/records/provenance";
import { ID, fieldProvenanceRow } from "../../fixtures/rows";
import { codeLines, codeText, sourceFiles } from "../source-tree";

/**
 * The record surface's provenance leaf (campaign admin-window/TASK-0029) — a
 * pure function over rows, so every case here is data in, data out.
 *
 * These assert BEHAVIOUR: which decision a field answers to, who its authority
 * is, and what the lookup asks for. The words the surface prints from that
 * (`admin-set`, `applied 3d ago`) are the component's and are asserted where
 * they are drawn, never pinned as literals here.
 */

const EVENT = ID.eventEntity;

function decision(overrides: Partial<FieldDecisionRow>): FieldDecisionRow {
  const row = fieldProvenanceRow({ entity_id: EVENT, ...overrides });
  return {
    provenance_id: row.provenance_id,
    entity_id: row.entity_id,
    field: row.field,
    source_id: row.source_id,
    applied_at: row.applied_at,
    admin_locked: row.admin_locked,
  };
}

const NAMES = [
  { source_id: ID.sourceTicketmaster, source: "ticketmaster" },
  { source_id: ID.sourceBandsintown, source: "bandsintown" },
];

describe("fieldProvenanceOf", () => {
  it("keys each fact by its column and carries the apply instant", () => {
    const facts = fieldProvenanceOf(
      [
        decision({ field: "title" }),
        decision({ field: "starts_at", applied_at: "2026-08-30T10:00:00Z" }),
      ],
      NAMES,
    );
    expect([...facts.keys()].sort()).toEqual(["starts_at", "title"]);
    expect(facts.get("starts_at")?.appliedAt).toBe("2026-08-30T10:00:00Z");
    expect(facts.get("starts_at")?.field).toBe("starts_at");
  });

  it("names the source behind a value the resolver applied", () => {
    const fact = fieldProvenanceOf(
      [decision({ field: "title", source_id: ID.sourceBandsintown })],
      NAMES,
    ).get("title");
    expect(fact?.authority).toBe("source");
    expect(fact && "source" in fact ? fact.source : null).toBe("bandsintown");
  });

  it("keeps a source id verbatim when its name was not read", () => {
    // The decision behind the field is real whether or not the name lookup
    // answered; dropping it would understate what is behind the value.
    const fact = fieldProvenanceOf(
      [decision({ field: "title", source_id: ID.sourceTicketmaster })],
      [],
    ).get("title");
    expect(fact && "source" in fact ? fact.source : null).toBe(
      ID.sourceTicketmaster,
    );
  });

  it("answers to the admin when the fact is pinned, whatever source is on the row", () => {
    // `admin_locked` is "a human pinned this field, so resolution leaves it
    // alone" — the authority an operator must see is that human (spec §8).
    const fact = fieldProvenanceOf(
      [
        decision({
          field: "title",
          admin_locked: true,
          source_id: ID.sourceTicketmaster,
        }),
      ],
      NAMES,
    ).get("title");
    expect(fact?.authority).toBe("admin");
    expect(fact && "source" in fact).toBe(false);
  });

  it("answers to no source at all on a verdict unset", () => {
    const fact = fieldProvenanceOf(
      [decision({ field: "title", source_id: null })],
      NAMES,
    ).get("title");
    expect(fact?.authority).toBe("unset");
    expect(fact && "source" in fact).toBe(false);
  });

  it("says nothing about a field the log says nothing about", () => {
    const facts = fieldProvenanceOf([decision({ field: "title" })], NAMES);
    expect(facts.get("description")).toBeUndefined();
    expect(facts.has("venue_id")).toBe(false);
  });

  it("reports the CURRENT decision when handed the reduction, not the history", () => {
    // The latest-per-fact rule has exactly one implementation in this repo
    // (`currentDecisions`), and this is the composition the data layer makes:
    // reduce the append-only log, then shape it. A superseded source must not
    // be named as current.
    const log = [
      decision({
        provenance_id: "01920000-0000-7000-8000-0000000004a1",
        field: "title",
        source_id: ID.sourceBandsintown,
        applied_at: "2026-08-01T00:00:00Z",
      }),
      decision({
        provenance_id: "01920000-0000-7000-8000-0000000004a2",
        field: "title",
        source_id: ID.sourceTicketmaster,
        applied_at: "2026-09-01T00:00:00Z",
      }),
    ];
    const fact = fieldProvenanceOf(currentDecisions(log), NAMES).get("title");
    expect(fact && "source" in fact ? fact.source : null).toBe("ticketmaster");
  });
});

describe("namedSourceIds", () => {
  it("asks for each distinct source once", () => {
    expect(
      namedSourceIds([
        decision({ field: "title", source_id: ID.sourceTicketmaster }),
        decision({ field: "description", source_id: ID.sourceTicketmaster }),
        decision({ field: "starts_at", source_id: ID.sourceBandsintown }),
      ]),
    ).toEqual([ID.sourceTicketmaster, ID.sourceBandsintown]);
  });

  it("asks for nothing on behalf of a decision that names no source", () => {
    // A verdict unset has no id to look a name up by, and a pinned fact's line
    // names the admin rather than a source.
    expect(
      namedSourceIds([
        decision({ field: "title", source_id: null }),
        decision({ field: "description", admin_locked: true }),
      ]),
    ).toEqual([]);
  });
});

/* ── the leaf is a leaf, and the surface above it takes plain props ───────── */

describe("the layering this leaf exists to keep", () => {
  const LEAF = "src/lib/records/provenance.ts";

  it("contains the modules these rules are about", () => {
    const files = sourceFiles();
    expect(files).toContain(LEAF);
    expect(files).toContain("src/components/records/fields.ts");
    expect(files).toContain("src/components/records/record-fields.tsx");
  });

  it("keeps the leaf below lib/db: it imports nothing at all", () => {
    // ARCHITECTURE §4 rule 7 — a pure domain leaf reaches no database, not
    // even by a type-only import, so no directory-level cycle can be written
    // into it. `lib/db/records.ts` imports THIS; never the other way.
    const imports = codeLines(LEAF).filter((line) =>
      /^\s*import\b|\brequire\s*\(|\bfrom\s+["']/.test(line),
    );
    expect(imports).toEqual([]);
  });

  it("keeps the record components off lib/db and off the client library", () => {
    // Rule 1: a component takes plain props and returns markup — which is what
    // lets this whole surface be rendered in a test with no database.
    for (const file of sourceFiles().filter((name) =>
      name.startsWith("src/components/records/"),
    )) {
      const text = codeText(file);
      expect(text, file).not.toMatch(/from\s+["']@\/lib\/db\//);
      expect(text, file).not.toContain("@supabase/supabase-js");
    }
  });

  it("has exactly one latest-per-fact rule, and this leaf is not a second one", () => {
    // The reduction lives in `currentDecisions` alone (ARCHITECTURE §6 trap 7).
    // This leaf CARRIES `applied_at` — it is a column of the row — but it must
    // never DECIDE with it: no instant parsed, no ordering, no tie-break. Those
    // are what "which decision is later" is made of, and writing them here
    // would be that one rule written twice.
    const leaf = codeText(LEAF);
    for (const deciding of ["Date.parse", ".sort(", "provenance_id >", "applied_at >"]) {
      expect(leaf, deciding).not.toContain(deciding);
    }
    // And the tie-break itself is spelled in exactly one file in this repo.
    const reducers = sourceFiles().filter((file) =>
      codeText(file).includes("provenance_id) >= 0"),
    );
    expect(reducers).toEqual(["src/lib/browse/rows.ts"]);
  });
});
