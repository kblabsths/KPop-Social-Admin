import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  implicitInterElementSpaces,
  implicitInterElementSpacesIn,
  repoRoot,
  sourceFiles,
  sourceText,
} from "../source-tree";
import { disagreeingCounts } from "./markup";

/**
 * The inter-element-space rule, asserted over the WHOLE source tree rather
 * than over three pages (campaign admin-window/BUG-0045, QA).
 *
 * The defect that reached the screen — `sourceis`, `stuck_patterndial` — is a
 * space a JSX transform is free to drop, and the transform the offline suite
 * runs disagrees with the one `next build` runs: `renderToStaticMarkup` keeps
 * a space the delivered HTML loses. So a rendered-markup assertion in this
 * suite cannot see the defect at all, and the source rule is the only guard
 * that can. It was applied by `sources/page.test.ts`, `claims/page.test.ts`
 * and `cycles/page.test.ts` — each to its own file — which leaves the shared
 * component that renders on EVERY page's not-provisioned state
 * (`src/components/ui/not-provisioned.tsx`, fixed by the same commit but
 * asserted nowhere) and every page written after this one unguarded. One
 * defect class deserves one assertion over the tree, not a new copy per page.
 *
 * The rule is deliberately conservative: whether the space survives depends on
 * where the text node sits among its parent's children (measured on delivered
 * HTML, 2026-09-03: `</span> is the run's`, last child, arrived glued;
 * `</span> says whose`, mid-paragraph, survived), and no line-oriented scanner
 * can know that. It therefore flags both positions, and the fix — writing the
 * space as `{" "}`, an expression container no transform may drop — is correct
 * in both.
 */
describe("inter-element spaces in every file the app ships", () => {
  const base = path.join(
    repoRoot,
    "tests",
    ".probes",
    `copy-spaces-${process.pid}-${randomUUID()}`,
  );
  const GLUED = "src/app/glued/page.tsx";
  const EXPLICIT = "src/app/explicit/page.tsx";

  beforeAll(() => {
    mkdirSync(path.join(base, "src", "app", "glued"), { recursive: true });
    mkdirSync(path.join(base, "src", "app", "explicit"), { recursive: true });
    writeFileSync(
      path.join(base, GLUED),
      [
        "export function Glued() {",
        "  return (",
        "    <p>",
        '      The read of <span className="type-data">source</span> is the run&rsquo;s own',
        "      text.",
        "    </p>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(base, EXPLICIT),
      [
        "export function Explicit() {",
        "  return (",
        "    <p>",
        '      The read of <span className="type-data">source</span>{" "}',
        "      is the run&rsquo;s own text.",
        "    </p>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("flags the spelling that reached the screen and clears the ones that did not", () => {
    // Must flag: the pre-fix spelling a user-sim read off /cycles as `sourceis`.
    expect(
      implicitInterElementSpacesIn('  <span className="type-data">source</span> is the run'),
    ).toEqual(['1: <span className="type-data">source</span> is the run']);
    // ...and the same spelling around the identifier PRIMITIVE, which is what
    // 48 of those spans became (admin-window/DEBT-0011). A tag list that knew
    // only the intrinsic elements would pass this file while seeing nothing.
    expect(implicitInterElementSpacesIn("  <Identifier>source</Identifier> is the run")).toEqual([
      "1: <Identifier>source</Identifier> is the run",
    ]);
    // Must NOT flag — or the assertion over the tree below is a formality:
    // an explicit expression, correct typography, and a comment that quotes
    // the defect while documenting it.
    for (const clean of [
      '<span className="type-data">source</span>{" "}',
      '<Identifier>source</Identifier>{" "}',
      "<Identifier>source</Identifier>, and the run",
      "<span>source</span>, and the run",
      "<span>source</span>.",
      "<span>source</span> — the run",
      "  // <span>source</span> is the run",
      "   * <span>source</span> is the run",
      "  /* <span>source</span> is the run */",
    ]) {
      expect(implicitInterElementSpacesIn(clean), clean).toEqual([]);
    }
  });

  it("reads every file of a tree, not the three the bug happened to name", () => {
    // A fixture tree carrying one glued file and one fixed file: the walk sees
    // both, the rule separates them. This is the RED state of the assertion
    // that follows, kept as a fixture so it can never go vacuous.
    expect(sourceFiles(base)).toEqual([EXPLICIT, GLUED]);
    expect(offenders(base)).toEqual([
      `${GLUED} 4: The read of <span className="type-data">source</span> is the run&rsquo;s own`,
    ]);
  });

  it("leaves no file under src/ leaning on a space a transform may drop", () => {
    const files = sourceFiles();
    // Non-vacuous: the shared component the three page tests do not cover, and
    // a tree that is plainly the real one rather than an empty walk.
    expect(files).toContain("src/components/ui/not-provisioned.tsx");
    expect(files.length).toBeGreaterThan(50);
    expect(offenders()).toEqual([]);
  });
});

/** Every site in a tree, as `file line: text`, so a failure names it. */
function offenders(base?: string): string[] {
  return sourceFiles(base).flatMap((file) =>
    implicitInterElementSpaces(file, base).map((hit) => `${file} ${hit}`),
  );
}

/**
 * The count-agreement guard, proved on both sides before three page tests lean
 * on it (campaign admin-window/BUG-0046).
 *
 * `disagreeingCounts` is a scanner, and a scanner that has never seen a
 * spelling it must flag passes vacuously. Every string below is either one the
 * walk actually read off the running app, or one the app renders correctly and
 * a blunter pattern would call a defect.
 */
describe("the count-with-its-noun guard", () => {
  it("flags the three strings the walk read off the running app", () => {
    expect(disagreeingCounts("<p>1 sources holding one</p>")).toEqual(["1 sources"]);
    expect(disagreeingCounts("<p>of 1 items read here, 700 folds in all</p>")).toEqual([
      "1 items",
    ]);
    expect(disagreeingCounts("<p>1 sources, 2 domains</p>")).toEqual(["1 sources"]);
  });

  it("flags a count and its noun that a gauge card splits across two elements", () => {
    // The shape that matters: a card's figure and its sub-line are siblings,
    // so the text either side of the boundary must not be read as one number.
    expect(
      disagreeingCounts('<div><span>1</span><span>1 sources holding one</span></div>'),
    ).toEqual(["1 sources"]);
    expect(disagreeingCounts("<span>1</span> rows in this window")).toEqual(["1 rows"]);
  });

  it("leaves alone the counts that are already correct", () => {
    for (const correct of [
      "<p>1 source, 2 domains</p>",
      "<p>0 sources holding a claim</p>",
      "<p>21,001 sources</p>",
      "<p>a window of at most 1,000 rows</p>",
      "<p>0.1 rows per cycle</p>",
      // A figure and a heading in two cells are not a phrase, and the app
      // renders whole tables of them.
      "<tr><td>1</td><td>sources</td></tr>",
      // Words ending in -s that no plural rule applies to.
      "<p>1 status, unchanged</p>",
      "<p>1 is the floor</p>",
    ]) {
      expect(disagreeingCounts(correct), correct).toEqual([]);
    }
  });
});

/**
 * The glossary's pinned nouns, asserted over every string the app renders
 * (campaign admin-window/BUG-0100, designer's M2 early walk).
 *
 * LOOK_AND_FEEL's Voice glossary pins one name per concept, and the first row
 * is the one the app leans on hardest: **claim**, never "observation",
 * "assertion" or "datapoint" — "`observation_id` stays a machine id; the
 * operator reads claims". The defect the walk read was the regime note at the
 * top of every resolver-owned record page calling an override "an observation
 * at the admin tier": the banned synonym for the app's most-used noun, in
 * `type-body` prose, on the app's only explanation of what an override does.
 *
 * Asserted over the tree for the same reason the inter-element-space rule
 * above is: three pages carried the same regime sentence and two other
 * surfaces carried the same word in other copy, so a per-page markup
 * assertion would have pinned the page the walk happened to open and left the
 * next one free. A rule over the source tree covers the copy nobody has
 * written yet.
 *
 * ## What counts as prose here, and what does not
 *
 * The scanner reads the app's rendered TEXT channels, not its code:
 *
 *  - the body of a string or template literal — with `${…}` elided, and with
 *    literals joined by `+` read as the one sentence they concatenate to
 *    (`"…through the resolution " + "pipeline, …"` is one string on screen,
 *    and reading the two halves separately would report the sanctioned
 *    compound as a bare "resolution");
 *  - a JSX text node, taken as the run between `>` and `<` and kept only when
 *    every character in it is one prose uses — so `Map<string, Row>` and
 *    `(row) => row.observation_id` are code, not copy.
 *
 * A ONE-WORD string is an identifier, a React key or a class, not prose — with
 * the deliberate exception of one sitting in a `label` position, which is the
 * channel a one-word column header and eyebrow reach the screen through
 * (`components/ui/data-table.tsx` renders `label` in `type-micro` **sans**, so
 * it is a word the operator reads and not a machine id in mono).
 *
 * ## The sanctioned uses, and why each stands
 *
 *  - **"observation id"** names the machine id itself, which the glossary's own
 *    reason line sanctions and `app/queues/[reviewItemId]/page.tsx` says in
 *    prose.
 *  - **A machine identifier** — `observation_id`, `observations` — never trips
 *    the rule wherever it appears, because a banned word touching `_`, `-`,
 *    `/` or a dotted path is not the English noun.
 *  - **"resolution pipeline"** is the resolver's pipeline, not a verdict; it is
 *    the wording the same walk passed as on-glossary.
 *  - **"resolution latency"** is a gauge's name from the design itself
 *    (`contracts/admin-observability.md`, SPEC.md's dashboard list).
 *
 * "judgment" is scanned beside the glossary's "judgement": one word, two
 * spellings, and the American one would otherwise be a free pass.
 */
describe("the glossary's pinned nouns in every string the app renders", () => {
  const base = path.join(
    repoRoot,
    "tests",
    ".probes",
    `copy-glossary-${process.pid}-${randomUUID()}`,
  );
  const OFF_GLOSSARY = "src/app/off/page.tsx";
  const ON_GLOSSARY = "src/app/on/page.tsx";

  beforeAll(() => {
    mkdirSync(path.join(base, "src", "app", "off"), { recursive: true });
    mkdirSync(path.join(base, "src", "app", "on"), { recursive: true });
    writeFileSync(
      path.join(base, OFF_GLOSSARY),
      [
        "export function Off() {",
        '  return <p>An edit here is recorded as an observation at the admin tier.</p>;',
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(base, ON_GLOSSARY),
      [
        "export function On() {",
        '  return <p>An edit here is recorded as a claim at the admin tier.</p>;',
        "}",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("flags the sentence the walk read off the override surface", () => {
    // Verbatim from the record page as the walk found it (the ticket's
    // transcription), which is the string this rule exists for.
    expect(
      glossaryViolationsIn(
        "const note =\n" +
          "  `${config.table} is resolver-owned: its values change through the ` +\n" +
          "    `resolution pipeline, never by a direct edit. An edit here is ` +\n" +
          "    `recorded as an admin override — an observation at the admin tier, ` +\n" +
          "    `applied through the pipeline and logged — and the pipeline then ` +\n" +
          "    `leaves that field alone.`;",
      ),
    ).toEqual([
      '2: observation — say claim: "${config.table} is resolver-owned: its v…"',
    ]);
  });

  it("clears the fix, and the other spellings of the same pin", () => {
    for (const clean of [
      // The fix: the same sentence, on glossary.
      'const note = "recorded as an admin override — a claim at the admin tier";',
      // The id named as an id — the glossary's own sanctioned exception, said
      // in prose by the review-item page.
      'const line = "The resolver appends an observation id to `evidence` each time this item folds";',
      // Machine identifiers, wherever they sit: a column, a table, a path.
      'const columns = "observation_id, observed_at";',
      'const table = "observations";',
      '<a href="/claims?bucket=resolution-latency">latency</a>',
      // The resolver's own process and the design's own gauge name.
      'const note = "its values change through the resolution pipeline, never by a direct edit";',
      'const LATENCY_LABEL = "Resolution latency";',
      // Code is not copy, whatever it is named.
      "const observation = observed.get(claim.observation_id);",
      "function isLive(observation: ObservationRow): boolean {",
      "const byId = new Map<string, ObservationRow>(rows);",
      // A doc comment may name the defect while documenting it.
      " * a settle-only verdict writes no observation, and the log says so",
      "// the observation the verdict wrote",
    ]) {
      expect(glossaryViolationsIn(clean), clean).toEqual([]);
    }
  });

  it("flags a banned synonym for either pinned noun, in prose or in a label", () => {
    // Just the verdict, without the quoted text each hit ends with.
    const said = (text: string) =>
      glossaryViolationsIn(text).map((hit) => hit.replace(/: "[\s\S]*$/, ""));
    // The claim row of the glossary…
    expect(said('const x = "the resolver filed an assertion against this field";')).toEqual([
      "1: assertion — say claim",
    ]);
    expect(said('const x = "every datapoint in this window is stale";')).toEqual([
      "1: datapoint — say claim",
    ]);
    // …and the verdict row, whose banned words are ordinary English and so
    // are the ones a writer reaches for without noticing.
    expect(said('const x = "the resolution stands until a new claim arrives";')).toEqual([
      "1: resolution — say verdict",
    ]);
    expect(said('const x = "this item is awaiting approval";')).toEqual([
      "1: approval — say verdict",
    ]);
    expect(said('const x = "a moderator judgement closed this item";')).toEqual([
      "1: judgement — say verdict",
    ]);
    expect(said('const x = "the admin judgment closed this item";')).toEqual([
      "1: judgment — say verdict",
    ]);
    expect(said('const x = "each source casts one vote per field";')).toEqual([
      "1: vote — say verdict",
    ]);
    // A one-word string is a key or an identifier — except in the `label`
    // channel, which renders on screen.
    expect(said('{ key: "observation", label: "observation id" }')).toEqual([]);
    expect(said('{ key: "observation", label: "observation" }')).toEqual([
      "1: observation — say claim",
    ]);
    expect(said('<VerdictLine label="observation">')).toEqual(["1: observation — say claim"]);
  });

  it("reads every file of a tree, not the page the bug happened to name", () => {
    // A fixture tree carrying one off-glossary page and one on-glossary page:
    // the walk sees both, the rule separates them. This is the RED state of
    // the assertion that follows, kept so it can never go vacuous.
    expect(sourceFiles(base)).toEqual([OFF_GLOSSARY, ON_GLOSSARY]);
    expect(glossaryOffenders(base)).toEqual([
      `${OFF_GLOSSARY} 2: observation — say claim: "An edit here is recorded as an observati…"`,
    ]);
  });

  /**
   * QA (admin-window/BUG-0100): the rule's blind spot, pinned as it stands.
   *
   * A run of rendered text is only read when it holds two English words —
   * `words = /[A-Za-z]\s+[A-Za-z]/` — because a one-word STRING LITERAL is
   * usually a React key or a column key, not copy. That reasoning does not
   * carry to the two shapes below, and both are shapes this app already
   * writes:
   *
   *  - a **JSX text node** is rendered by definition and is never a key.
   *    `src/` ships four of them today (`>source<` twice, `>skipped<`,
   *    `>current<`, `>contender<`), so a fifth reading `>Observations<` — a
   *    column heading, an eyebrow — would pass this rule silently;
   *  - a **template literal whose only English word follows the
   *    interpolation** — `` `${n} observations` `` — is the app's own idiom
   *    for a counted noun (`micro-label.tsx` documents `` `${stats.queue}
   *    open` ``; `cycle-health.tsx` and `latency.tsx` build subtitles that
   *    way). One word after `${…}` leaves no letter-space-letter in the raw
   *    text, so the run is dropped before the glossary is consulted.
   *    `` `${n} resolutions pending` `` IS caught, which is the same string
   *    with one more word.
   *
   * No string under `src/` reaches either blind spot today — the rule is
   * green on the real corpus, which is why this is a pin and not a bug. It
   * fails on purpose so the day someone widens the rule, the XPASS sends
   * them here instead of leaving the gap uncharted.
   */
  it.fails("does not yet read a one-word run of rendered text (QA residual)", () => {
    const jsxHeading = "export function H() { return <h2>Observations</h2>; }";
    const countedNoun = "const sub = `${count} observations`;";
    expect(glossaryViolationsIn(jsxHeading)).not.toEqual([]);
    expect(glossaryViolationsIn(countedNoun)).not.toEqual([]);
  });

  it("leaves no string under src/ calling a claim an observation or a verdict a resolution", () => {
    const files = sourceFiles();
    // Non-vacuous: the surface the walk found the defect on, and a tree that
    // is plainly the real one rather than an empty walk.
    expect(files).toContain("src/app/records/[table]/[id]/page.tsx");
    expect(files.length).toBeGreaterThan(50);
    expect(glossaryOffenders()).toEqual([]);
  });
});

/** The pinned noun each banned synonym must give way to (LOOK_AND_FEEL Voice). */
const PINNED_NOUNS: ReadonlyArray<{ say: string; never: readonly string[] }> = [
  {
    say: "claim",
    never: ["observation", "observations", "assertion", "assertions", "datapoint", "datapoints"],
  },
  {
    say: "verdict",
    never: [
      "resolution",
      "resolutions",
      "approval",
      "approvals",
      "judgement",
      "judgements",
      "judgment",
      "judgments",
      "vote",
      "votes",
    ],
  },
];

/** The uses the glossary and the design sanction, removed before the scan. */
const SANCTIONED = [/\bobservation ids?\b/gi, /\bresolution pipelines?\b/gi, /\bresolution latency\b/gi];

/** A string or template literal, matched whole so its body can be read. */
const LITERAL = /`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
/** A JSX text node: the run between a closing `>` and the next `<`. */
const JSX_TEXT = />([^<>]+)</g;
/** An HTML entity, which is a character of prose written the app's way. */
const ENTITY = /&(?:[a-zA-Z]+|#\d+);/g;
/** Every character prose is made of — anything else means the run is code. */
const PROSE_CHARS = /^[A-Za-z0-9 \t\r\n,.:!?'’“”—–…%-]+$/;
/** A character that makes a word part of an identifier or a slug. */
const SLUG_CHAR = /[A-Za-z0-9_/-]/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

/** One run of rendered text, with the line it starts on. */
interface ProseSpan {
  line: number;
  text: string;
  /** True when the string is a `label`, which renders even at one word. */
  labelled: boolean;
}

/** True when `word` stands in `prose` as an English word, not inside an id. */
function standsAlone(prose: string, word: string): boolean {
  for (const match of prose.matchAll(new RegExp(`\\b${word}\\b`, "gi"))) {
    const start = match.index;
    const end = start + word.length;
    const before = prose[start - 1] ?? " ";
    const after = prose[end] ?? " ";
    // `verdicts.observation_id`, `resolution-latency`, `/observations/x`.
    if (SLUG_CHAR.test(before) || (before === "." && IDENTIFIER_CHAR.test(prose[start - 2] ?? " "))) {
      continue;
    }
    // ...but a sentence-ending "." is prose, not a dotted path.
    if (SLUG_CHAR.test(after) || (after === "." && IDENTIFIER_CHAR.test(prose[end + 1] ?? " "))) {
      continue;
    }
    return true;
  }
  return false;
}

/** Comment lines emptied, line numbers kept — the same cut `codeLines` makes. */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const comment =
        trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
      return comment ? "" : line;
    })
    .join("\n");
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

/** Every run of rendered text in a source file's code. */
function proseSpans(source: string): ProseSpan[] {
  const spans: ProseSpan[] = [];
  const outsideLiterals = source.split("");
  let previous: (ProseSpan & { end: number }) | null = null;
  for (const match of source.matchAll(LITERAL)) {
    const start = match.index;
    const end = start + match[0].length;
    // Blanked so the JSX-text pass cannot read an attribute value as a text
    // node — newlines kept, so every line number stays where it was.
    for (let i = start; i < end; i += 1) {
      if (outsideLiterals[i] !== "\n") outsideLiterals[i] = " ";
    }
    const body = match[0].slice(1, -1);
    if (previous !== null && /^[\s+]*$/.test(source.slice(previous.end, start))) {
      previous.text += body;
      previous.end = end;
      continue;
    }
    previous = {
      line: lineOf(source, start),
      text: body,
      labelled: /\blabel\s*[:=]\s*$/.test(source.slice(Math.max(0, start - 40), start)),
      end,
    };
    spans.push(previous);
  }
  for (const match of outsideLiterals.join("").matchAll(JSX_TEXT)) {
    const body = match[1];
    if (!PROSE_CHARS.test(body.replace(ENTITY, ""))) continue;
    spans.push({ line: lineOf(source, match.index + 1), text: body, labelled: false });
  }
  return spans;
}

/**
 * Every place a source file's rendered text uses a banned synonym for a pinned
 * noun, as `line: word — say noun: "the text"`, so a failure names the site
 * and the word to write instead.
 */
function glossaryViolationsIn(text: string): string[] {
  const source = withoutComments(text);
  const hits: string[] = [];
  for (const span of proseSpans(source)) {
    const words = /[A-Za-z]\s+[A-Za-z]/.test(span.text);
    if (!span.labelled && !words) continue;
    let prose = span.text.replace(/\$\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
    for (const sanctioned of SANCTIONED) prose = prose.replace(sanctioned, " ");
    for (const { say, never } of PINNED_NOUNS) {
      for (const word of never) {
        if (!standsAlone(prose, word)) continue;
        const quoted = span.text.replace(/\s+/g, " ").trim();
        const shown = quoted.length > 40 ? `${quoted.slice(0, 40)}…` : quoted;
        hits.push(`${span.line}: ${word} — say ${say}: "${shown}"`);
      }
    }
  }
  return hits;
}

/** Every glossary site in a tree, as `file line: …`, so a failure names it. */
function glossaryOffenders(base?: string): string[] {
  return sourceFiles(base).flatMap((file) =>
    glossaryViolationsIn(sourceText(file, base)).map((hit) => `${file} ${hit}`),
  );
}
