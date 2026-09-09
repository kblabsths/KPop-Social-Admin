import { describe, expect, it } from "vitest";
import { VERDICT_ACTIONS } from "@/lib/verdict/decision";
import {
  alterTableTargets,
  blockBalance,
  dollarQuoteMarks,
  forbiddenConstructs,
  fencedBlocks,
  readHandoffNote,
  splitTopLevel,
  sqlArtifactOf,
  sqlBlocks,
  type SqlArtifact,
} from "./extract";

/**
 * The `verdicts` handoff artifact — campaign admin-window/TASK-0045.
 *
 * `agenticflow/tracker/for-human/M2-handoff-verdicts.md` carries a migration
 * NOBODY HERE INSTALLS: Ben pastes it into `kspace Scraper/supabase/migrations/`
 * and applies it with `supabase db push` from that repo. So no compiler, no
 * database and no `db push` ever sees it before he does, and this file is the
 * only thing standing between an authoring slip and a debugging session in a
 * repo this campaign may not enter.
 *
 * The bar it holds: spec §7's seven columns with their types, nullability,
 * defaults and both foreign keys and NO eighth; RLS on with zero policies; the
 * client-role revoke; no json column, no `commit`, no `dblink`, no autonomous
 * transaction; balanced `$$` and `begin`/`end` — and the one that matters most,
 * the `action` CHECK's value set equal to `VERDICT_ACTIONS` **imported** from
 * `src/lib/verdict/decision.ts`. That import is how SPEC gap 6 closes by
 * construction: the SQL Ben pastes and the UI that calls it cannot drift apart
 * without this file going red (a hand-copied list here would prove nothing).
 *
 * **Two fixtures, per LESSONS 3.** Every assertion below runs through one
 * grader, `gradeVerdicts`, exercised on the shipped block (it must report
 * nothing) and on doctored notes it must flag: a `create policy` line, a ninth
 * action in the CHECK, a `jsonb` column, a `commit;`, and a service_role write
 * grant — plus the other half of that lesson, a note that only TALKS about
 * those constructs in a comment and a string literal, which must grade clean.
 */

const NOTE = "M2-handoff-verdicts.md";
const noteText = readHandoffNote(NOTE);
const shipped = sqlArtifactOf(noteText);

/** The target file Ben creates in the sibling, and the command he runs there. */
const TARGET_PATH = "supabase/migrations/20260908000001_the_verdict_becomes_a_row.sql";
const APPLY_COMMAND = "supabase db push";

/** Spec §7's table, as the properties this file grades. */
interface ExpectedColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly def: string | null;
}

const EXPECTED_COLUMNS: readonly ExpectedColumn[] = [
  { name: "verdict_id", type: "uuid", nullable: false, def: "public.uuid_generate_v7()" },
  { name: "review_item_id", type: "uuid", nullable: true, def: null },
  { name: "actor", type: "text", nullable: false, def: null },
  { name: "action", type: "text", nullable: false, def: null },
  { name: "observation_id", type: "uuid", nullable: true, def: null },
  { name: "note", type: "text", nullable: true, def: null },
  { name: "created_at", type: "timestamptz", nullable: false, def: "now()" },
];

interface ParsedColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly def: string | null;
}

interface ParsedTable {
  readonly columns: readonly ParsedColumn[];
  readonly constraints: readonly string[];
}

/** `timestamp with time zone` and `timestamptz` are one type; so are the rest. */
function normalizeType(type: string): string {
  const flat = type.toLowerCase().replace(/\s+/g, " ").trim();
  if (flat === "timestamp with time zone") return "timestamptz";
  if (flat === "timestamp without time zone") return "timestamp";
  if (flat === "character varying") return "varchar";
  return flat;
}

/** Does this `create table` body entry declare a table constraint, not a column? */
function isConstraintEntry(entry: string): boolean {
  return /^(?:constraint|primary\s+key|foreign\s+key|check|unique|exclude|like)\b/i.test(entry);
}

/** Does this text declare a CHECK constraint? */
function isCheckEntry(entry: string): boolean {
  return /\bcheck\b/i.test(entry);
}

/**
 * The columns and table constraints of one `create table`, or null when the
 * artifact does not create that table at all.
 *
 * Reads the comment-stripped code, so a column named in prose is never mistaken
 * for one that exists, and splits the body at top level, so the commas inside
 * `array[...]` and `references x(y)` stay where they belong.
 */
function parseCreateTable(artifact: SqlArtifact, qualified: string): ParsedTable | null {
  const opener = new RegExp(
    `\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${qualified.replace(".", "\\.")}\\s*\\(`,
    "i",
  );
  const statement = artifact.statements.find((candidate) => opener.test(candidate));
  if (statement === undefined) return null;

  const body = statement.slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"));
  const entries = splitTopLevel(body, ",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const columns: ParsedColumn[] = [];
  const constraints: string[] = [];
  for (const entry of entries) {
    if (isConstraintEntry(entry)) {
      constraints.push(entry.replace(/\s+/g, " "));
      continue;
    }
    const [name, ...rest] = entry.split(/\s+/);
    const remainder = rest.join(" ");
    const defMatch = /\bdefault\s+(.*?)(?:\s+not\s+null\b|\s*$)/i.exec(remainder);
    columns.push({
      name: name.replace(/"/g, "").toLowerCase(),
      type: remainder
        .replace(/\bdefault\s+.*$/i, "")
        .replace(/\bnot\s+null\b/gi, "")
        .replace(/\bnull\b/gi, "")
        .trim(),
      nullable: !/\bnot\s+null\b/i.test(remainder),
      def: defMatch === null ? null : defMatch[1].trim(),
    });
  }
  return { columns, constraints };
}

/** Statements of the artifact whose first word is `verb`, whitespace-flattened. */
function statementsStartingWith(artifact: SqlArtifact, verb: string): string[] {
  return artifact.statements
    .map((statement) => statement.replace(/\s+/g, " ").toLowerCase())
    .filter((statement) => statement.startsWith(verb));
}

/** The single-quoted literals of one body entry, in order. */
function literalsOf(entry: string): string[] {
  return [...entry.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/**
 * Every reason this artifact must not be handed to Ben, as named findings —
 * EMPTY for the shipped block. One grader, so the doctored fixtures below are
 * graded by exactly the instrument the shipped block is.
 */
function gradeVerdicts(artifact: SqlArtifact): string[] {
  const findings: string[] = [...forbiddenConstructs(artifact.scan)];

  if (dollarQuoteMarks(artifact.code) % 2 !== 0) findings.push("unbalanced_dollar_quotes");
  const balance = blockBalance(artifact.scan);
  if (balance.openers !== balance.closers) findings.push("unbalanced_blocks");

  for (const target of alterTableTargets(artifact.scan)) {
    if (target !== "public.verdicts") findings.push(`alter_table_foreign:${target}`);
  }

  const table = parseCreateTable(artifact, "public.verdicts");
  if (table === null) return [...findings, "no_create_table"];

  const names = table.columns.map((column) => column.name);
  const expectedNames = EXPECTED_COLUMNS.map((column) => column.name);
  if (names.join(",") !== expectedNames.join(",")) findings.push(`column_set:${names.join(",")}`);

  for (const column of table.columns) {
    if (/\bjsonb?\b/i.test(column.type)) findings.push(`json_column:${column.name}`);
  }

  for (const expected of EXPECTED_COLUMNS) {
    const column = table.columns.find((candidate) => candidate.name === expected.name);
    if (column === undefined) continue; // already reported by column_set
    if (normalizeType(column.type) !== expected.type) findings.push(`type:${expected.name}`);
    if (column.nullable !== expected.nullable) findings.push(`nullability:${expected.name}`);
    if (column.def !== expected.def) findings.push(`default:${expected.name}`);
  }

  const constraints = table.constraints.join(" ").toLowerCase();
  if (!/primary\s+key\s*\(\s*verdict_id\s*\)/.test(constraints)) findings.push("primary_key");
  if (
    !/foreign\s+key\s*\(\s*review_item_id\s*\)\s*references\s+public\.review_items\s*\(\s*review_item_id\s*\)/.test(
      constraints,
    )
  ) {
    findings.push("fk_review_items");
  }
  if (
    !/foreign\s+key\s*\(\s*observation_id\s*\)\s*references\s+public\.observations\s*\(\s*observation_id\s*\)/.test(
      constraints,
    )
  ) {
    findings.push("fk_observations");
  }

  const checks = table.constraints.filter(isCheckEntry);
  if (checks.length !== 1) findings.push(`check_count:${checks.length}`);
  else {
    if (!/\baction\b/i.test(checks[0])) findings.push("check_column");
    const declared = [...literalsOf(checks[0])].sort();
    const expected = [...VERDICT_ACTIONS].sort();
    if (declared.join(",") !== expected.join(",")) findings.push(`action_set:${declared.join(",")}`);
  }

  if (!/\balter\s+table\s+public\.verdicts\s+enable\s+row\s+level\s+security\b/.test(artifact.scan)) {
    findings.push("rls_missing");
  }

  const revokes = statementsStartingWith(artifact, "revoke").filter((statement) =>
    statement.includes("public.verdicts"),
  );
  if (!revokes.some((statement) => /\banon\b/.test(statement) && /\bauthenticated\b/.test(statement))) {
    findings.push("client_revoke_missing");
  }

  const grants = statementsStartingWith(artifact, "grant").filter((statement) =>
    statement.includes("public.verdicts"),
  );
  if (grants.some((statement) => /\banon\b|\bauthenticated\b/.test(statement))) findings.push("client_grant");
  const toServiceRole = grants.filter((statement) => /\bto\s+service_role\b/.test(statement));
  if (!toServiceRole.some((statement) => /\bgrant\s+select\b/.test(statement))) {
    findings.push("service_role_select_missing");
  }
  // `settle_review_item` is the only writer (contract §7); it runs security
  // definer as the owner, so a table write grant here would be a second path.
  if (toServiceRole.some((statement) => /\b(?:insert|update|delete|truncate|all)\b/.test(statement))) {
    findings.push("service_role_write_grant");
  }

  if (!/\bnotify\s+pgrst\b/.test(artifact.scan)) findings.push("pgrst_reload_missing");

  return findings;
}

/** A doctored copy of the shipped NOTE — the fixture the grader must flag. */
function doctoredNote(find: string, replace: string): SqlArtifact {
  expect(noteText).toContain(find);
  return sqlArtifactOf(noteText.replace(find, replace));
}

describe("the verdicts handoff note", () => {
  it("carries exactly one fenced sql block", () => {
    expect(sqlBlocks(noteText)).toHaveLength(1);
    // Other fences are welcome (the apply command is one); only `sql` is unique.
    expect(fencedBlocks(noteText).length).toBeGreaterThan(1);
  });

  it("names the target path in the sibling, the apply command, and the rollback", () => {
    expect(noteText).toContain(TARGET_PATH);
    expect(noteText).toContain(APPLY_COMMAND);
    expect(noteText).toContain("drop table public.verdicts;");
  });

  it("cites, per identifier, the sibling migration that defines it", () => {
    const cited = [...noteText.matchAll(/(\d{14}_[a-z0-9_]+\.sql)/g)].map((match) => match[1]);
    // The PK default and both FK targets each resolve to a named sibling file.
    expect(cited).toContain("20260818000000_the_schema_arrives_as_one_snapshot.sql");
    expect(cited).toContain("20260901000002_the_review_item_opens_once_per_subject.sql");
    for (const identifier of ["public.uuid_generate_v7()", "public.review_items", "public.observations"]) {
      expect(noteText).toContain(identifier);
    }
    // A citation TABLE, not a paragraph: every citation sits in a table row.
    const rows = noteText.split("\n").filter((line) => line.startsWith("|") && line.includes(".sql"));
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the verdicts migration", () => {
  it("grades clean", () => {
    expect(gradeVerdicts(shipped)).toEqual([]);
  });

  it("creates spec §7's seven columns, in order, and no eighth", () => {
    const table = parseCreateTable(shipped, "public.verdicts");
    expect(table).not.toBeNull();
    expect(table?.columns.map((column) => column.name)).toEqual(
      EXPECTED_COLUMNS.map((column) => column.name),
    );
  });

  it("gives each column its type, nullability and default", () => {
    const table = parseCreateTable(shipped, "public.verdicts");
    const actual = table?.columns.map((column) => ({
      name: column.name,
      type: normalizeType(column.type),
      nullable: column.nullable,
      def: column.def,
    }));
    expect(actual).toEqual([...EXPECTED_COLUMNS]);
  });

  it("checks `action` against exactly VERDICT_ACTIONS, imported from the app's own leaf", () => {
    const table = parseCreateTable(shipped, "public.verdicts");
    const check = table?.constraints.find(isCheckEntry);
    expect(check).toBeDefined();
    expect(literalsOf(check ?? "").sort()).toEqual([...VERDICT_ACTIONS].sort());
  });

  it("enables RLS and creates zero policies", () => {
    expect(shipped.scan).toMatch(/alter\s+table\s+public\.verdicts\s+enable\s+row\s+level\s+security/);
    expect(shipped.scan).not.toMatch(/\bcreate\s+policy\b/);
  });

  it("revokes the client roles and grants service_role SELECT alone", () => {
    const revoke = statementsStartingWith(shipped, "revoke");
    expect(revoke.some((statement) => /anon/.test(statement) && /authenticated/.test(statement))).toBe(true);
    const grants = statementsStartingWith(shipped, "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toBe("grant select on table public.verdicts to service_role");
  });

  it("alters nothing but its own table, and carries no data statement", () => {
    expect(alterTableTargets(shipped.scan)).toEqual(["public.verdicts", "public.verdicts"]);
    expect(statementsStartingWith(shipped, "insert")).toEqual([]);
    expect(statementsStartingWith(shipped, "update")).toEqual([]);
    expect(statementsStartingWith(shipped, "delete")).toEqual([]);
    expect(statementsStartingWith(shipped, "drop")).toEqual([]);
  });

  it("is balanced: even `$$`, matched begin/end", () => {
    expect(dollarQuoteMarks(shipped.code) % 2).toBe(0);
    const balance = blockBalance(shipped.scan);
    expect(balance.openers).toBe(balance.closers);
  });
});

describe("the grader proves itself on doctored blocks", () => {
  it("flags a create policy line the shipped block does not have", () => {
    const doctored = doctoredNote(
      "notify pgrst, 'reload schema';",
      "create policy verdicts_are_readable on public.verdicts for select using (true);\n\nnotify pgrst, 'reload schema';",
    );
    expect(gradeVerdicts(doctored)).toContain("create_policy");
    expect(gradeVerdicts(shipped)).not.toContain("create_policy");
  });

  it("flags a ninth action in the CHECK", () => {
    const doctored = doctoredNote("'override'::text]", "'override'::text, 'escalate'::text]");
    const findings = gradeVerdicts(doctored);
    // Named for the divergence, and carrying the set it found: whoever reads
    // the red sees which spelling arrived, not just that one did.
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^action_set:/);
    expect(findings[0]).toContain("escalate");
  });

  it("flags a json column", () => {
    const doctored = doctoredNote("    note text,", "    note text,\n    payload jsonb,");
    const findings = gradeVerdicts(doctored);
    expect(findings).toContain("json_column:payload");
    expect(findings.some((finding) => finding.startsWith("column_set:"))).toBe(true);
  });

  it("flags a commit inside the artifact", () => {
    const doctored = doctoredNote(
      "notify pgrst, 'reload schema';",
      "commit;\n\nnotify pgrst, 'reload schema';",
    );
    expect(gradeVerdicts(doctored)).toContain("commit");
  });

  it("flags a service_role write grant, which would be a second writer", () => {
    const doctored = doctoredNote(
      "grant select on table public.verdicts to service_role;",
      "grant select, insert, update, delete on table public.verdicts to service_role;",
    );
    expect(gradeVerdicts(doctored)).toContain("service_role_write_grant");
  });

  it("reads a banned word in a comment or a string as prose, not as a construct", () => {
    // The other half of LESSONS 3: the grader must not fire on text that only
    // TALKS about the thing. Both of these are legal SQL and must grade clean.
    const inComment = doctoredNote(
      "-- ── 1. The table ",
      "-- A create policy here would be a defect, and we commit nothing.\n-- ── 1. The table ",
    );
    expect(gradeVerdicts(inComment)).toEqual([]);
    const inLiteral = doctoredNote(
      "'One row per decided verdict:",
      "'create policy, commit, dblink. One row per decided verdict:",
    );
    expect(gradeVerdicts(inLiteral)).toEqual([]);
  });
});
