import { describe, expect, it } from "vitest";
import { sourceFiles, sourceText } from "../source-tree";

/**
 * The patterns Voice bar 3 now forbids, asserted over the whole source tree.
 *
 * **Why a test and not just a rule.** Ben, 2026-10-23: *"this keeps happening
 * again and again across the website… I know we can provide better guidelines
 * to get the results I want."* The guideline existed and was the CAUSE — bar 3
 * asked for "what failed, then what to do" and used the sentence he objected
 * to as its exemplar — so a prose rule is demonstrably not enough on its own.
 * This is the half that does not depend on whoever writes the next string
 * having read the doc.
 *
 * It flags the one class a scanner can honestly recognise: **telling the
 * operator to do the thing they are already doing.** That is mechanical —
 * a small set of phrases — where "says the obvious" in general is a judgment
 * no regex has. It is deliberately narrow rather than clever: a guard that
 * cries wolf gets suppressed, and a suppressed guard is worse than none.
 */

/** Phrases that tell the operator to repeat what they just did. */
const RETRY_PHRASES: readonly string[] = [
  "then close it again",
  "then save it",
  "then try again",
  "then link it",
  "then press",
  "and close it again",
  "wait for it to answer",
  "please try again",
];

/** A line that is plainly code or a comment about the rule, not UI copy. */
function isProse(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("*") || trimmed.startsWith("//")) return false;
  return /["'`]/.test(trimmed);
}

describe("UI copy does not tell the operator what they are already doing", () => {
  it("flags the retry clause and clears a plain request", () => {
    // Non-vacuous in both directions: the scanner really sees the phrasing
    // that shipped, and really passes the sentence that replaced it.
    expect(
      RETRY_PHRASES.some((p) =>
        "A won’t-fix needs a note — say why the condition stands, then close it again.".includes(p),
      ),
    ).toBe(true);
    expect(
      RETRY_PHRASES.some((p) => "Please include the evidence for your decision.".includes(p)),
    ).toBe(false);
  });

  it("leaves no retry clause anywhere under src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = sourceText(file);
      for (const [index, line] of text.split("\n").entries()) {
        if (!isProse(line)) continue;
        for (const phrase of RETRY_PHRASES) {
          if (line.toLowerCase().includes(phrase)) {
            offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
