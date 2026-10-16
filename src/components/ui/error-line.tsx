import { Fragment, type ReactNode } from "react";

import { accountRuns, type AccountSegment } from "@/lib/account/authored";
import { EM_DASH, isAbsent } from "@/lib/format";

/**
 * ONE run of an account, in the face its AUTHOR decides — campaign
 * admin-window/BUG-0196.
 *
 * "Mono carries every value the database produced … Sans carries every word
 * the app wrote. That split *is* the typographic idea: the operator can always
 * see which words are the machine's" (LOOK_AND_FEEL → Typography). The face is
 * read off the carried fact and NOTHING else: no sentence is compared to a
 * list of this app's own phrases, so rewording any clause moves no face.
 *
 * `dir="ltr"` isolates a run this app did NOT author (ARCHITECTURE.md §7,
 * admin-window/BUG-0175) — foreign text reaches the operator inside its own
 * bidi-isolated box rather than reordering the line around it. A sentence this
 * app wrote needs no isolation from itself.
 */
function Run({ words, author }: AccountSegment): ReactNode {
  return author === "the machine" ? (
    <span className="type-data" dir="ltr">
      {words}
    </span>
  ) : (
    <span className="type-body">{words}</span>
  );
}

/**
 * A failed read's ACCOUNT, drawn: the object the read was making, then the
 * account's runs, each in its author's face — campaign admin-window/BUG-0196.
 *
 * **Written once, drawn by both renderers.** `ErrorLine` below (data-surface
 * state 4, on every page) and the paging refusal's broken arm
 * (`src/components/ui/paging.tsx`) are the two places a failed read reaches an
 * operator, and BOTH draw the split out of this one component off the one
 * run-splitting derivation in the leaf (`accountRuns`). A second hand-written
 * walk in the second renderer is two copies of one rule; this rule has already
 * been fixed once in this family, and the copies drift (LESSONS 5).
 *
 * The layout is unchanged from what both lines already drew: the object is a
 * machine identifier and stays mono and isolated in every arm, ONE em dash
 * separates it from the account, and a line with nothing to name gets the
 * account alone rather than a dangling em dash — asked of the app's one
 * definition of absence (`isAbsent`, `lib/format`), never a guard of its own.
 * The em dash rides the FIRST run, so it is drawn once and lands in the same
 * face the run beside it does, exactly as the paging line has drawn it since
 * admin-window/BUG-0175.
 *
 * The runs are laid out as flex items by the caller, which is why
 * `accountRuns` merges consecutive same-authored segments: the gap between two
 * spans is drawn by the layout rather than being a character, so an account
 * the database wrote across two fields must arrive in ONE span. A
 * single-authored account — a real PostgREST refusal, and every paging arm but
 * the failed read's — is therefore exactly one span carrying exactly the flat
 * account, which is what keeps those lines byte-identical.
 */
export function AuthoredAccount({
  object,
  account,
}: {
  /** The object the failed read was reading, or `null` where there is none. */
  object: string | null;
  /** The account's segments, in order, as the author decided them. */
  account: readonly AccountSegment[];
}): ReactNode {
  const runs = accountRuns(account);
  const named = object !== null && !isAbsent(object);
  const [first, ...rest] = runs;
  const led = first !== undefined && named;
  const drawn: { key: string; node: ReactNode }[] = [];

  if (led && first.author === "the machine") {
    // One foreign run: the identifier and the words the machine wrote.
    drawn.push({
      key: "named-machine",
      node: (
        <span className="type-data" dir="ltr">
          {`${object} ${EM_DASH} ${first.words}`}
        </span>
      ),
    });
  } else {
    if (named) {
      drawn.push({
        key: "object",
        node: (
          <span className="type-data" dir="ltr">
            {object}
          </span>
        ),
      });
    }
    if (first !== undefined) {
      drawn.push({
        key: "lead",
        node: <Run words={led ? `${EM_DASH} ${first.words}` : first.words} author={first.author} />,
      });
    }
  }
  for (const [index, run] of rest.entries()) {
    drawn.push({ key: `run-${index}`, node: <Run words={run.words} author={run.author} /> });
  }

  return (
    <>
      {drawn.map((part, index) => (
        <Fragment key={part.key}>
          {/*
           * ONE space between two drawn parts, as a text node of its own.
           *
           * The line is a flex container, so what the operator SEES between
           * two spans is the container's gap and not a character — but the
           * account is still one sentence, and a reader that concatenates the
           * text nodes (a screen reader announcing this `role="alert"`, a live
           * oracle reading the card back, `cheerio.text()`) must not be handed
           * `read faileda 314-character markup document …`. CSS does not
           * render a whitespace-only anonymous flex item (CSS Flexbox §4), so
           * this changes the text and nothing about the layout.
           */}
          {index === 0 ? null : " "}
          {part.node}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Data-surface state 4 of 4. One red line: which read failed and what failed —
 * the database's words in mono because the machine said them, this app's own
 * clauses about the parts it refused to quote in sans because it wrote them —
 * then the retry in the app's voice. No apology, no generic message, nothing
 * swallowed.
 *
 * `reading` is REQUIRED because a page can make several reads — Browse makes
 * four, each reported separately on purpose — and a line saying only
 * "TypeError: fetch failed" names none of them, so an operator cannot tell
 * which one refused (LOOK_AND_FEEL state 4 and Voice bar 3,
 * admin-window/BUG-0016). It was optional until admin-window/TASK-0030, which
 * is how BUG-0016 shipped: a rule review has to catch is a rule the compiler
 * should be catching. `DbResult`'s error arm carries the string, so every
 * caller already holds it (`lib/db/result.ts`).
 *
 * Carries `data-state="error"`. A live oracle grades an error as a FAILURE and
 * must not be able to mistake it for the gray not-provisioned card: both name
 * the object the query used, so "the markup contains `pending_claims`" was
 * satisfied by either one and four live assertions passed on a broken page
 * (ARCHITECTURE §10, admin-window/TASK-0032).
 */
export function ErrorLine({
  reading,
  failed,
  authored,
  retry,
}: {
  /** The object the failed read was reading, spelled as the query spelled it. */
  reading: string;
  /** The failure verbatim — the function's own refusal. */
  failed: string;
  /**
   * The account's runs and WHO WROTE THEM, as `lib/db/result.ts` decided them
   * where the clauses are authored (campaign admin-window/BUG-0196).
   *
   * OPTIONAL, and its ABSENCE means what this line rendered before the fact
   * existed: the whole of `failed` is the machine's, drawn wholly in the mono
   * `data` step. So a caller that holds only the string — a gauge state built
   * from a `DbResult` arm this app composed itself, a test, any call site not
   * yet carrying the fact — renders exactly what it rendered before.
   *
   * Where it IS carried, `failed` is the JOIN of it (`accountText`), so the
   * two can never describe different accounts.
   */
  authored?: readonly AccountSegment[];
  /** What to do about it, in the app's voice. */
  retry: string;
}) {
  return (
    <p
      data-state="error"
      className="flex flex-wrap items-baseline gap-2 text-broken"
      role="alert"
    >
      <AuthoredAccount
        object={reading}
        account={authored ?? [{ words: failed, author: "the machine" }]}
      />
      <span className="type-body">{retry}</span>
    </p>
  );
}
