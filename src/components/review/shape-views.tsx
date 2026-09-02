import type { ReactNode } from "react";
import {
  EvidencePair,
  type EvidenceCanonical,
} from "@/components/evidence/evidence-pair";
import {
  GaugeCard,
  TrendTable,
  type EmptyWords,
  type GaugeState,
} from "@/components/gauges";
import { type Column, DataTable, Empty } from "@/components/ui";
import { EM_DASH, absoluteUtc, count } from "@/lib/format";
import type { Shape } from "@/lib/review/shapes";
import {
  factColumn,
  heldColumn,
  observedColumn,
  payloadColumn,
  sourceColumn,
  statusColumn,
  tierColumn,
  valueColumn,
  type EvidenceRow,
} from "./evidence-cells";

/**
 * **Each shape is its own detail view** over the shared anatomy — campaign
 * admin-window/TASK-0011, spec §6: "the evidence block renders what that
 * shape's evidence IS, not one generic layout".
 *
 * Three views, and `EVIDENCE_VIEW_BY_SHAPE` maps every `Shape` to exactly one
 * of them. The map is a `Record<Shape, …>`, so a fourth shape — which arrives
 * only with the migration that widens `review_items.queue`'s CHECK constraint
 * (ARCHITECTURE.md §6 trap 11) — fails to compile HERE, with no defensive
 * throw, no null return and no "unknown" view to write. Nothing in this file
 * re-derives a shape or a kind: `shapeOf`/`kindOfItem` are the only spellings
 * of that (spec §6, `src/lib/review/shapes.ts`).
 *
 * What differs between the views is what the evidence of that shape actually
 * is:
 *
 *  - a `data_conflict` fact item — the **contending claims**, against the
 *    value canonical holds now;
 *  - an `entity_link` fact item — the **stuck claims and the unmet
 *    requirement** the classification view names;
 *  - an `entity_link` source-pattern item — the **folded records as a list**,
 *    with the per-source dial beside it.
 *
 * The two fact views lead with the evidence pair — this app's signature
 * (LOOK_AND_FEEL): contenders left, the canonical value as the rightmost card,
 * labelled current. The table below is the same claims as EVIDENCE: the pair
 * answers "which value wins" in two seconds, the table carries the machine
 * detail an investigation needs (the claim's own status, its payload pointer,
 * what is holding it). The source-pattern view has no pair at all, and that is
 * not an omission: its subject is a SOURCE, so there is no fact and no
 * canonical value to stand anything beside.
 *
 * **Nothing here settles anything** (spec §7 is the verdict slice): every
 * control in this markup is a link, no card carries an action, and no
 * disabled control is scaffolded toward one.
 *
 * Pure synchronous components over plain props (ARCHITECTURE.md §5).
 */

/** The per-source dial's numbers, as the page reads them from the gauge. */
export interface DialSeries {
  /** Stuck records this source has in the window. A real zero is an answer. */
  claims: number;
  /** One point per UTC day of the window, zeros included, ascending. */
  points: readonly { day: string; claims: number }[];
  /**
   * The pattern threshold this trend would be drawn against, or `null` while
   * Admin has no way to read the dial. Null is every call today: the value
   * lives in the scraper repo's source registry and copying it here is
   * forbidden (spec §10, `src/lib/gauges/pending-claims.ts` — the seam).
   */
  threshold: { count: number; windowDays: number } | null;
}

/** The window the dial was read over, carried so the card can state it. */
export interface DialWindow {
  since: string;
  until: string;
  limit: number;
  /** The read filled its cap, so every figure from it is a floor. */
  truncated: boolean;
}

export interface DialProps {
  /** The `micro` label the figure stands under — the source, and what counts. */
  label: string;
  /** The numbers, or `null` when the read did not produce any — see `state`. */
  series: DialSeries | null;
  window: DialWindow | null;
  /** The words for a window holding no stuck record at all. */
  empty: EmptyWords;
  /**
   * Set when the dial's own read was unprovisioned or refused. It maps
   * straight off a `DbResult` and is rendered by the landed gauge state seam,
   * so the card names the object that refused rather than showing a zero for a
   * table nobody read (ARCHITECTURE §7, admin-window/TASK-0030).
   */
  state?: GaugeState;
}

/** What every shape view is handed. Each uses what its evidence has. */
export interface ShapeEvidenceProps {
  /** The item's `evidence` ids, resolved, in the stored fold order. */
  rows: readonly EvidenceRow[];
  /** Evidence ids that resolved to no claim — named, never dropped. */
  unresolved: readonly string[];
  /** The words for an evidence block with no resolved claim in it. */
  empty: EmptyWords;
  /**
   * The canonical card: the fact's current value and its provenance. `null`
   * when the item names no fact at all, which is what a per-source item is.
   */
  canonical: EvidenceCanonical | null;
  /** The per-source dial. `null` on every shape but the source pattern. */
  dial: DialProps | null;
}

/** The lede: what this shape's evidence is, said once, above it. */
function Lede({ children }: { children: ReactNode }) {
  return <p className="type-body text-ink-secondary">{children}</p>;
}

/**
 * The evidence ids that named no claim.
 *
 * Listed verbatim in mono rather than dropped: an item carries the ids the
 * resolver folded into it, and a list that silently shortened would read as an
 * item with less evidence than it has.
 */
function Unresolved({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return null;
  return (
    <p className="type-body text-ink-secondary">
      {count(ids.length)} of this item&rsquo;s evidence ids name no claim this
      database holds:{" "}
      {ids.map((id) => (
        <span key={id} data-unresolved={id} className="type-data text-ink">
          {id}{" "}
        </span>
      ))}
    </p>
  );
}

/**
 * The claims, as rows. The columns are the SHAPE's; the emptiness is this
 * component's to time and the caller's to word (the rule `TrendTable` and
 * `Distribution` already carry — admin-window/TASK-0030).
 */
function ClaimRows({
  rows,
  columns,
  label,
  empty,
  unresolved,
}: {
  rows: readonly EvidenceRow[];
  columns: Column<EvidenceRow>[];
  label: string;
  empty: EmptyWords;
  unresolved: readonly string[];
}) {
  return (
    <>
      {rows.length === 0 ? (
        <Empty holds={empty.holds} filledBy={empty.filledBy} />
      ) : (
        <DataTable<EvidenceRow>
          columns={columns}
          rows={[...rows]}
          rowKey={(row) => row.observationId}
          label={label}
        />
      )}
      <Unresolved ids={unresolved} />
    </>
  );
}

/**
 * The contenders, as the pair renders them.
 *
 * A tier this app could not read is the app's own dash, not a blank and not a
 * guessed tier: `sources.tier` is the only place a claim's current tier comes
 * from (§6 trap 5).
 */
function contenders(rows: readonly EvidenceRow[]) {
  return rows.map((row) => ({
    id: row.observationId,
    value: row.value,
    source: row.source,
    tier: row.tier ?? EM_DASH,
    observedAt: row.observedAt,
  }));
}

/* ── shape 1: the data_conflict fact item ────────────────────────────────── */

function ConflictEvidence({
  rows,
  unresolved,
  empty,
  canonical,
}: ShapeEvidenceProps) {
  return (
    <div data-evidence-view="conflict" className="flex flex-col gap-3">
      <Lede>
        Sources disagree about this fact. Each contending claim stands against
        the value canonical holds now — its tier is its source&rsquo;s tier
        today, the canonical card&rsquo;s is the tier frozen at the apply.
      </Lede>
      {canonical === null ? null : (
        // The signature block, hooked so its cards can be read structurally:
        // one card per contender, in the claims' own order, and the CANONICAL
        // card last — that rightmost position is the contract
        // (LOOK_AND_FEEL), not a styling choice.
        <div data-pair>
          <EvidencePair claims={contenders(rows)} canonical={canonical} />
        </div>
      )}
      <ClaimRows
        rows={rows}
        columns={[
          valueColumn,
          sourceColumn,
          tierColumn,
          observedColumn,
          statusColumn,
          payloadColumn,
        ]}
        label="Contending claims"
        empty={empty}
        unresolved={unresolved}
      />
    </div>
  );
}

/* ── shape 2: the entity_link fact item ──────────────────────────────────── */

function StuckFactEvidence({
  rows,
  unresolved,
  empty,
  canonical,
}: ShapeEvidenceProps) {
  return (
    <div data-evidence-view="stuck-fact" className="flex flex-col gap-3">
      <Lede>
        This record cannot link or be created. Every claim held by it is below,
        with what each one is waiting for.
      </Lede>
      {canonical === null ? null : (
        // The signature block, hooked so its cards can be read structurally:
        // one card per contender, in the claims' own order, and the CANONICAL
        // card last — that rightmost position is the contract
        // (LOOK_AND_FEEL), not a styling choice.
        <div data-pair>
          <EvidencePair claims={contenders(rows)} canonical={canonical} />
        </div>
      )}
      <ClaimRows
        rows={rows}
        columns={[
          valueColumn,
          sourceColumn,
          tierColumn,
          observedColumn,
          heldColumn,
          payloadColumn,
        ]}
        label="Stuck claims"
        empty={empty}
        unresolved={unresolved}
      />
    </div>
  );
}

/* ── shape 3: the entity_link source-pattern item ────────────────────────── */

/**
 * The per-source dial (spec §5's stuck-record-pattern knob, read through
 * `lib/gauges/pending-claims.ts`).
 *
 * **The trend is drawn and the threshold line is not.** The dial's threshold
 * lives in the scraper repo's source-registry YAML and where Admin reads it is
 * a blocked question (admin-window/TASK-0024); hand-copying the number into
 * this repo is the one answer that is forbidden. So the line below states that
 * gap in the app's voice rather than drawing a default nobody chose — and if
 * the seam is ever filled, the dial it hands over is stated here instead.
 */
function Dial({ label, series, window: read, empty, state }: DialProps) {
  return (
    <div data-dial className="flex flex-col gap-2">
      {state !== undefined || series === null ? (
        <GaugeCard
          label={label}
          state={
            state ?? {
              kind: "empty",
              holds: empty.holds,
              filledBy: empty.filledBy,
            }
          }
        />
      ) : (
        <GaugeCard
          label={label}
          value={series.claims}
          floor={read?.truncated ?? false}
          sub={
            series.claims === 0
              ? "nothing stuck in this window"
              : "stuck records this source has in the window below"
          }
        />
      )}
      {read === null ? null : (
        <p className="type-body text-ink-secondary">
          Claims observed since {absoluteUtc(read.since)}, read to{" "}
          {absoluteUtc(read.until)} — a window of at most {count(read.limit)}{" "}
          rows, not the whole table.
          {read.truncated
            ? " The window filled its cap, so every count here is a floor."
            : ""}
        </p>
      )}
      <p className="type-body text-ink-secondary">
        {series === null || series.threshold === null
          ? "No pattern threshold is readable from here — the dial is a source-registry setting in the scraper repo, so the trend is drawn without its line."
          : `Pattern threshold: ${count(series.threshold.count)} records in ${count(
              series.threshold.windowDays,
            )} days.`}
      </p>
      <TrendTable<{ day: string; claims: number }>
        label={label}
        period="day (UTC)"
        rows={series === null ? [] : [...series.points]}
        rowKey={(point) => point.day}
        rowLabel={(point) => point.day}
        measures={[
          { key: "claims", label: "records", value: (point) => point.claims },
        ]}
        empty={empty}
        state={state}
      />
    </div>
  );
}

function PatternEvidence({
  rows,
  unresolved,
  empty,
  dial,
}: ShapeEvidenceProps) {
  return (
    <div
      data-evidence-view="source-pattern"
      className="grid gap-4 lg:grid-cols-[2fr_1fr]"
    >
      <div className="flex flex-col gap-3">
        <Lede>
          One source, many records stuck the same way. Every record folded into
          this signal is listed here; the source&rsquo;s own dial is beside it.
          There is no canonical value to stand them against — the subject is the
          source, not a fact.
        </Lede>
        <ClaimRows
          rows={rows}
          columns={[
            factColumn,
            valueColumn,
            sourceColumn,
            tierColumn,
            observedColumn,
            payloadColumn,
          ]}
          label="Folded records"
          empty={empty}
          unresolved={unresolved}
        />
      </div>
      {dial === null ? null : <Dial {...dial} />}
    </div>
  );
}

/**
 * Shape → its detail view. The compiler requires every `Shape` to have one,
 * which is the whole guard: no default arm, no fallback view, and a fourth
 * shape cannot reach a screen by accident (§6 trap 11).
 */
export const EVIDENCE_VIEW_BY_SHAPE: Record<
  Shape,
  (props: ShapeEvidenceProps) => ReactNode
> = {
  data_conflict_fact: ConflictEvidence,
  entity_link_fact: StuckFactEvidence,
  entity_link_source_pattern: PatternEvidence,
};

/**
 * Which shape's view carries the per-source dial, so the page knows whether to
 * make that read at all — WITHOUT re-deriving anything from `queue` or
 * `source_id` (spec §11: `shapeOf` is the only spelling). It is exhaustive
 * over `Shape` for the same reason the view map is: a fourth shape must decide
 * this here rather than inherit a default.
 */
export const DIAL_BY_SHAPE: Record<Shape, boolean> = {
  data_conflict_fact: false,
  entity_link_fact: false,
  entity_link_source_pattern: true,
};
