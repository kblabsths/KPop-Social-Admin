/**
 * What a claim's value SAYS, for a person reading a table of them.
 *
 * `observations.value` is jsonb, so the column hands over text like
 *
 *   [{"ids":{"musicbrainz":"c11b6e14-…"},"ref":"K8vZ917qJ_0","name":"BE:FIRST"}]
 *
 * which the evidence table rendered verbatim, in mono, inside a cell competing
 * with six others. Ben, 2026-10-21: *"if possible, parse value better. Like for
 * […] I just want to know that the name."*
 *
 * **Nothing is discarded.** This decides what the cell SHOWS; the caller keeps
 * the raw text on the element's `title`, so the full value is one hover away
 * and the markup still carries it. That is the line this module walks: a
 * machine value renders verbatim (LOOK_AND_FEEL Voice bar 5) and a verbatim
 * rendering nobody can read is not serving the rule it obeys. The compromise
 * is that the SHORT form is a reading and the raw form is still there.
 *
 * **It never guesses.** Anything this module cannot confidently shorten comes
 * back `null`, and the caller renders the value exactly as the database handed
 * it over. A value that is already a plain string is returned unchanged rather
 * than round-tripped through a parser that might reformat it.
 */

/** The key a performer-shaped object carries its readable name under. */
const NAME_KEYS = ["name", "title", "label"] as const;

/** Is this a JSON object (and not an array, and not null)? */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The readable name one element carries, or `null` where it carries none. */
function nameOf(element: unknown): string | null {
  if (typeof element === "string") return element.trim() === "" ? null : element;
  if (typeof element === "number" || typeof element === "boolean") {
    return String(element);
  }
  if (!isObject(element)) return null;
  for (const key of NAME_KEYS) {
    const candidate = element[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return null;
}

/**
 * The names a claim's value carries, as one readable string — or `null` when
 * the value is not name-shaped and should render verbatim.
 *
 * `null` is returned, never a dash and never an empty string: absence is the
 * app's one `isAbsent`/`orDash` decision and this module does not make a
 * second one.
 */
export function claimedNames(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  // Not JSON at all — the commonest case, and the one that must not change:
  // a title, a date, a venue name is already what a person wants to read.
  if (!(text.startsWith("[") || text.startsWith("{"))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // jsonb that will not parse as JSON is a fact about the row, not something
    // to repair here: it renders verbatim and the operator sees exactly what
    // the database holds.
    return null;
  }

  if (Array.isArray(parsed)) {
    const names = parsed.map(nameOf);
    // ALL or NOTHING. A partial reading — three performers named and the
    // fourth silently dropped — would be a shorter cell that lies about the
    // claim, which is worse than a long one that does not.
    if (names.length === 0 || names.some((name) => name === null)) return null;
    return names.join(", ");
  }

  return nameOf(parsed);
}
