/**
 * The staging-target guard (campaign admin-window, admin-window/TASK-0003).
 *
 * PURE by design: it is handed credential VALUES, the names they came from,
 * the text of `agenticflow/docs/SERVICES.md`, and the NAME OF ITS CALLER. It
 * reads no environment, opens no file and makes no request. `setup.ts` does
 * all three and is the only place the `STAGING_*` names are read — this split
 * is what lets the offline suite prove the refusal path
 * (`tests/offline/live-guard.test.ts`) without whatever `.env` happens to
 * exist on the machine deciding the answer.
 *
 * **Why the caller names itself** (admin-window/TASK-0036). This guard has two
 * callers now — the live suite's setup file and the walk-sandbox reset tool
 * (`tests/walk/reset-sandbox.mts`) — and they read DIFFERENT env names for the
 * same two credentials. Refusal text that hard-coded the first caller told a
 * walker who mistyped a name that the LIVE SUITE was refusing, from a program
 * that is not the live suite; worse, the missing-name branch went on to state
 * that the caller does not read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`,
 * which is exactly and only what the reset tool reads. So the caller passes
 * its own name, every refusal begins with it, and no refusal asserts anything
 * about which names a caller does or does not consult beyond the two it was
 * handed.
 *
 * What it enforces, from the acceptance doc's ground rules ("Staging only …
 * an unset name is a refusal, never a fallback") and SPEC F2:
 *
 *  1. Both names must carry a value. A missing one is a loud refusal that
 *     spells the name — never a fallback to some other name, never a default
 *     URL. (Which names those are is the caller's choice: the live suite hands
 *     over the `STAGING_*` pair, the reset tool the `SUPABASE_*` pair it was
 *     launched with. This module only ever sees the two it is given.)
 *  2. The host the URL points at must be the staging target a HUMAN declared
 *     in `agenticflow/docs/SERVICES.md`. No declaration is a refusal too:
 *     that is what makes "production is never a target" structural rather
 *     than a promise nobody can check.
 *
 * Refusal messages name NAMES, hosts and the declared target — never the
 * value of a key, and never the value of a name that failed to parse.
 */

/** The doc a human declares the staging target in, relative to the repo root. */
export const SERVICES_DOC_PATH = "agenticflow/docs/SERVICES.md";

/** The section of that doc this guard reads — the CLI name, per its template. */
export const SERVICES_SECTION = "supabase";

/** The bullet inside that section that carries the target. */
export const TARGET_FIELD = "staging target agents may touch";

/**
 * The two forms a declaration may take, spelled into every refusal.
 *
 * `SERVICES.md`'s generic entry template invites a "project/env name or id",
 * which for other CLIs is right; for a Supabase project only a ref or a host
 * can be checked against a URL, so the refusals say so rather than leaving a
 * human to guess why their friendly name was rejected.
 */
const DECLARATION_FORMS = "project ref or the full host";

/** Every refusal this module raises. Loud, and never a fallback. */
export class LiveGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveGuardError";
  }
}

/** The env names a caller read the values out of. Names, never values. */
export interface CredentialNames {
  url: string;
  key: string;
}

export interface StagingTarget {
  /** The value of the staging URL name, validated as a URL. */
  url: string;
  /** The value of the staging service-role name. Never logged. */
  key: string;
  /** The host that URL points at — the thing the declaration must match. */
  host: string;
  /** The project ref: the first label of the host. */
  ref: string;
  /** The target string as `SERVICES.md` declares it. */
  declared: string;
}

function present(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Is this a template placeholder rather than a declaration?
 *
 * `SERVICES.md` ships an entry template whose fields read
 * `<project/env name or id>`. A copied-but-unfilled template is NOT a
 * declaration; treating it as one would let the guard pass on a value no
 * human ever chose.
 */
function isPlaceholder(value: string): boolean {
  return value.startsWith("<") && value.endsWith(">");
}

/**
 * Strip the decoration a human may reasonably write around the target:
 * surrounding backticks or quotes, a trailing sentence period, a URL scheme
 * and any path. What is left is compared as a host or a project ref.
 */
function normalizeDeclared(value: string): string {
  let text = value.trim().toLowerCase();
  // Punctuation and quoting come off in ONE pass per side: stripping them
  // in sequence left ``ref`.`` (a backtick then a sentence period) with its
  // backtick still attached.
  text = text.replace(/^[`'"\s]+/, "");
  text = text.replace(/[`'"\s.,;]+$/, "");
  text = text.replace(/^https?:\/\//, "");
  text = text.replace(/\/.*$/, "");
  return text.trim();
}

/**
 * The staging target declared in `SERVICES.md`, or `null` when the doc
 * declares none.
 *
 * Only a real top-level `## supabase` heading counts, and only CODE-FREE
 * lines are read at all. The doc's own entry template is example text, not a
 * declaration, and this parser has to be able to say so structurally rather
 * than by luck: both ways Markdown marks a line as code are skipped —
 *
 *  - a fenced block (``` or ~~~), whose contents are ignored wholesale;
 *  - indentation of four or more columns, which is an indented code block.
 *
 * That is the whole reason this is parsed rather than grepped: a filled-in
 * EXAMPLE in the doc must never be readable as a human's declaration.
 */
export function declaredStagingTarget(
  servicesMarkdown: string | null,
): string | null {
  if (servicesMarkdown === null) return null;

  const lines = servicesMarkdown.split(/\r?\n/);
  // A field line is a real list item: up to three leading spaces. Four or
  // more makes it an indented code block, i.e. example text.
  const fieldPattern = new RegExp(
    `^ {0,3}-\\s*${TARGET_FIELD}\\s*:\\s*(.+?)\\s*$`,
    "i",
  );
  let inSection = false;
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMark = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMark) {
      const mark = fenceMark[1][0];
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      inSection = heading[1].trim().toLowerCase() === SERVICES_SECTION;
      continue;
    }
    if (!inSection) continue;

    const field = fieldPattern.exec(line);
    if (!field) continue;

    const value = field[1].trim();
    if (!present(value) || isPlaceholder(value)) return null;
    return value;
  }

  return null;
}

/**
 * The domain a bare project ref is resolved against.
 *
 * `SERVICES.md`'s `## supabase` section declares a Supabase project, whose
 * URL is `https://<ref>.supabase.co`. Anything else — a self-hosted instance,
 * a custom domain — has to be declared as a FULL host, which still matches by
 * equality below.
 */
const SUPABASE_HOST_SUFFIX = "supabase.co";

/** Does the URL's host name the same project the human declared? */
export function hostMatchesDeclaration(
  host: string,
  declared: string,
): boolean {
  const wanted = normalizeDeclared(declared);
  if (wanted.length === 0) return false;
  const actualHost = host.trim().toLowerCase();
  // The declaration may be the full host (`abc.supabase.co`) or the project
  // ref alone (`abc`). Equality either way — never a substring test, which
  // would let `abc` match `abc-production`.
  if (wanted === actualHost) return true;
  // A bare ref is only a ref of the Supabase domain. Matching it against the
  // host's first label alone would have accepted `abc.somewhere-else.tld` on
  // a declaration of `abc` — a different project entirely, sharing a label.
  if (wanted.includes(".")) return false;
  return actualHost === `${wanted}.${SUPABASE_HOST_SUFFIX}`;
}

/**
 * Resolve the live suite's target, or refuse.
 *
 * Order matters: the missing-name refusal comes first, because that is the
 * state the repo is in until a human puts both names in `.env`, and its
 * message is the one that has to be useful.
 */
export function resolveStagingTarget(input: {
  url: string | undefined | null;
  key: string | undefined | null;
  names: CredentialNames;
  services: string | null;
  /**
   * How the refusals refer to whoever is asking — `"the live suite"`,
   * `"the walk-sandbox reset tool"`. Every message below begins with it, so a
   * refusal a human reads names the program that produced it.
   */
  caller: string;
}): StagingTarget {
  const { names, caller } = input;

  const missing: string[] = [];
  if (!present(input.url)) missing.push(names.url);
  if (!present(input.key)) missing.push(names.key);
  if (missing.length > 0) {
    // Names the names it was handed, and says nothing about names it was
    // NOT handed: which other name a caller might have read is the caller's
    // business, and asserting it here was false for the second caller.
    throw new LiveGuardError(
      `${caller} refuses: ${missing.join(" and ")} ` +
        `${missing.length === 1 ? "is" : "are"} not set. ` +
        `An unset name is a refusal, never a fallback — no other name is ` +
        `read in its place, and there is no default target.`,
    );
  }

  const url = (input.url as string).trim();
  const key = (input.key as string).trim();

  let host: string;
  try {
    const parsed = new URL(url);
    host = parsed.host.toLowerCase();
    if (host.length === 0) throw new Error("no host");
  } catch {
    // The value is never echoed: a malformed URL is still someone's secret.
    throw new LiveGuardError(
      `${caller} refuses: ${names.url} is not a URL with a host.`,
    );
  }

  const declared = declaredStagingTarget(input.services);
  if (declared === null) {
    throw new LiveGuardError(
      `${caller} refuses: no staging target is declared in ` +
        `${SERVICES_DOC_PATH} (a top-level "## ${SERVICES_SECTION}" section, ` +
        `outside any code block, with "- ${TARGET_FIELD}: <ref>" — the ` +
        `${DECLARATION_FORMS}). Until a human declares one, ` +
        `${names.url} is unverifiable and nothing here will run — that is ` +
        `how "production is never a target" stays structural.`,
    );
  }

  if (!hostMatchesDeclaration(host, declared)) {
    throw new LiveGuardError(
      `${caller} refuses: ${names.url} points at host "${host}", which ` +
        `is not the staging target declared in ${SERVICES_DOC_PATH} ` +
        `("${declared}"). A declaration is the ${DECLARATION_FORMS} — a ` +
        `human-readable project name is not something this guard can check.`,
    );
  }

  return { url, key, host, ref: host.split(".")[0], declared };
}
