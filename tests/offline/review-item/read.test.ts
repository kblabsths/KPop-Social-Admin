import { describe, expect, it } from "vitest";
import {
  factOf,
  isLive,
  readItemEvidence,
  readReviewItem,
} from "@/lib/db/review-item";
import { T } from "@/lib/db/tables";
import {
  ID,
  fieldProvenanceRow,
  observationRow,
  reviewItemDataConflict,
  reviewItemEntityLink,
  reviewItemSourcePattern,
  sourceRow,
} from "../../fixtures/rows";
import { stubClient, type Script } from "../../fixtures/stub-client";

/**
 * The review-item detail's READS (campaign admin-window/TASK-0011).
 *
 * The page test asserts what reaches the screen; this file asserts the
 * properties the screen rests on — the read KINDS (ARCHITECTURE.md §4.3), the
 * two-step join (§4.2), and the latest-decision rule (§6 trap 7). They are
 * asserted against the query the stub client recorded, so "this is a complete
 * read" is checked rather than claimed in a comment.
 */

const CLAIM_A = observationRow();
const CLAIM_B = observationRow({
  observation_id: ID.observationB,
  source_id: ID.sourceBandsintown,
  value: "TWICE World Tour",
});

function healthy(overrides: Script = {}): Script {
  return {
    [T.observations]: { data: [CLAIM_A, CLAIM_B] },
    [T.fieldProvenance]: { data: [fieldProvenanceRow()], count: 1 },
    [T.sources]: { data: [sourceRow()] },
    ...overrides,
  };
}

/** Every method a recorded query called, in order. */
function stepsOn(client: ReturnType<typeof stubClient>, table: string) {
  return client.calls
    .filter((call) => call.table === table)
    .map((call) => call.steps.map((step) => step.method));
}

describe("the fact a review item names", () => {
  it("is the fact columns for a per-fact item, in the provenance spelling", () => {
    // `review_items` spells the canonical table `domain`; `field_provenance`
    // and `observations` spell it `entity_type` (§6 trap 1).
    const item = reviewItemDataConflict();
    expect(factOf(item)).toEqual({
      entityType: item.domain,
      entityId: item.entity_id,
      field: item.field,
    });
  });

  it("is nothing for a per-source item, and nothing for a record that has no row", () => {
    expect(factOf(reviewItemSourcePattern())).toBeNull();
    expect(factOf(reviewItemEntityLink())).toBeNull();
  });
});

describe("live claims", () => {
  it("counts pending and applied, and nothing else", () => {
    // `contracts/data-model.md`: live means `pending` or `applied`; the other
    // three are terminal and a decision resting on one has no current value.
    for (const status of ["pending", "applied"] as const) {
      expect(isLive(observationRow({ status })), status).toBe(true);
    }
    for (const status of ["superseded", "rejected", "quarantined"] as const) {
      expect(isLive(observationRow({ status })), status).toBe(false);
    }
  });
});

describe("the item read", () => {
  it("addresses one row by its primary key", async () => {
    const client = stubClient({ [T.reviewItems]: { data: reviewItemDataConflict() } });
    const result = await readReviewItem(
      ID.reviewItemDataConflict,
      client.asSupabaseClient(),
    );

    expect(result.kind).toBe("ok");
    expect(stepsOn(client, T.reviewItems)).toEqual([
      ["select", "eq", "maybeSingle"],
    ]);
  });

  it("comes back ok with no row when the table holds none", async () => {
    const client = stubClient({ [T.reviewItems]: { data: null } });
    const result = await readReviewItem("nope", client.asSupabaseClient());
    expect(result).toEqual({ kind: "ok", data: null });
  });
});

describe("the evidence read", () => {
  it("resolves the ids by an in() over the id set, deduplicated and in fold order", async () => {
    const item = reviewItemDataConflict({
      evidence: [ID.observationB, ID.observationA, ID.observationB],
    });
    const client = stubClient(healthy());
    const result = await readItemEvidence(item, client.asSupabaseClient());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Fold order, and the repeat folded id is one claim, not two.
    expect(result.data.claims.map((claim) => claim.observation.observation_id)).toEqual(
      [ID.observationB, ID.observationA],
    );
    // The second leg of the two-step join (§4.2), bounded by the ids it filtered on.
    expect(stepsOn(client, T.observations)[0]).toEqual([
      "select",
      "in",
      "limit",
    ]);
  });

  it("keeps a claim whose source row is missing, with its id verbatim and no tier", async () => {
    // The claim is real whether or not the registry row was read; borrowing a
    // tier from anywhere would be a fact this app never read (§6 trap 5).
    const item = reviewItemDataConflict();
    const client = stubClient(healthy({ [T.sources]: { data: [] } }));
    const result = await readItemEvidence(item, client.asSupabaseClient());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.claims).toHaveLength(2);
    expect(result.data.claims[0].source).toBe(CLAIM_A.source_id);
    expect(result.data.claims[0].tier).toBeNull();
  });

  it("reports the ids that resolved to no claim", async () => {
    const item = reviewItemDataConflict({
      evidence: [ID.observationA, "01920000-0000-7000-8000-0000000009ff"],
    });
    const client = stubClient(healthy({ [T.observations]: { data: [CLAIM_A] } }));
    const result = await readItemEvidence(item, client.asSupabaseClient());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.claims).toHaveLength(1);
    expect(result.data.unresolved).toEqual([
      "01920000-0000-7000-8000-0000000009ff",
    ]);
  });
});

describe("the canonical side", () => {
  it("reads the decision log COMPLETE, ordered by applied_at then its key", async () => {
    const client = stubClient(healthy());
    await readItemEvidence(reviewItemDataConflict(), client.asSupabaseClient());
    const call = client.calls.find((one) => one.table === T.fieldProvenance);

    expect(call?.steps.map((step) => step.method)).toEqual([
      "select",
      "eq",
      "eq",
      "eq",
      "order",
      "order",
      "range",
    ]);
    // A complete read asks for the exact count and orders down to the key, or
    // "the latest decision" is not knowable (ARCHITECTURE.md §4.3, §6 trap 7).
    expect(call?.steps[0].args[1]).toEqual({ count: "exact" });
    expect(call?.steps.filter((step) => step.method === "order").map((step) => step.args)).toEqual(
      [
        ["applied_at", { ascending: false }],
        ["provenance_id", { ascending: false }],
      ],
    );
  });

  it("refuses rather than naming the latest decision out of a truncated log", async () => {
    // The count exceeds the rows returned: something truncated the log, so
    // "the latest" would be a guess. The read refuses with the real number.
    const client = stubClient(
      healthy({
        [T.fieldProvenance]: { data: [fieldProvenanceRow()], count: 4000 },
      }),
    );
    const result = await readItemEvidence(
      reviewItemDataConflict(),
      client.asSupabaseClient(),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reading).toBe(T.fieldProvenance);
    expect(result.message).toContain("4000");
  });

  it("reads no decision log at all for an item that names no fact", async () => {
    const client = stubClient({
      [T.observations]: { data: [CLAIM_B] },
      [T.sources]: { data: [sourceRow()] },
    });
    const result = await readItemEvidence(
      reviewItemSourcePattern(),
      client.asSupabaseClient(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data.canonical.kind).toBe("no_fact");
    expect(client.tablesRead()).not.toContain(T.fieldProvenance);
  });

  it("distinguishes a record that has no row from a fact nothing has been applied to", async () => {
    const noRow = await readItemEvidence(
      reviewItemEntityLink(),
      stubClient({
        [T.observations]: { data: [CLAIM_B] },
        [T.sources]: { data: [sourceRow()] },
      }).asSupabaseClient(),
    );
    expect(noRow.kind === "ok" && noRow.data.canonical.kind).toBe("no_row");

    const noDecision = await readItemEvidence(
      reviewItemDataConflict(),
      stubClient(healthy({ [T.fieldProvenance]: { data: [], count: 0 } })).asSupabaseClient(),
    );
    expect(noDecision.kind === "ok" && noDecision.data.canonical.kind).toBe(
      "no_decision",
    );
  });

  it("fetches the winning claim when the evidence does not already carry it", async () => {
    // The decision names an observation this item never folded in; it is read
    // by id rather than left out of the canonical card.
    const winner = observationRow({
      observation_id: "01920000-0000-7000-8000-000000000303",
      value: "TWICE 5TH WORLD TOUR: READY TO BE",
    });
    const item = reviewItemDataConflict({ evidence: [ID.observationB] });
    const client = stubClient(
      healthy({
        [T.observations]: [{ data: [CLAIM_B] }, { data: [winner] }],
        [T.fieldProvenance]: {
          data: [fieldProvenanceRow({ observation_id: winner.observation_id })],
          count: 1,
        },
      }),
    );
    const result = await readItemEvidence(item, client.asSupabaseClient());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.data.canonical.kind !== "decided") return;
    expect(result.data.canonical.decided.observation?.observation_id).toBe(
      winner.observation_id,
    );
    expect(result.data.canonical.decided.live).toBe(true);
    // ...and it is not smuggled into the evidence list.
    expect(result.data.claims).toHaveLength(1);
  });
});
