import { describe, expect, it } from "vitest";
import { sourceFiles, sourceText } from "../source-tree";

/**
 * The React client boundary, asserted against the source tree — campaign
 * admin-window/BUG-0094.
 *
 * **The defect this exists for.** A server component that imports a VALUE out
 * of a `"use client"` module compiles, lints, type-checks and renders green in
 * every offline test, and then answers **500** in a production build. Next
 * replaces a client module in the server graph with a proxy whose exports are
 * client references; touching one on the server throws (`Attempted to call
 * hintSide() from the server`). It has happened once already in this campaign:
 * admin-window/BUG-0086's first cut had `RecordFields` — a synchronous SERVER
 * component — calling `hintSide` out of `EditableCell.tsx`, and
 * `src/components/edit-cell-layout.ts` exists today for no other reason than
 * to hold that helper OUTSIDE the client module. QA restored the violation on
 * 2026-09-08 and measured the whole factory staying green over it: the offline
 * suite (93 passed) renders with `renderToStaticMarkup`, which has no client
 * boundary to violate; the http suite (16 passed) reaches the record page but
 * not `RecordFields`, because with no database the page renders its refusal
 * first; lint and `tsc` see an ordinary function export. Only loading the page
 * saw it. This file is the check that sees it instead.
 *
 * **The rule.** A module is a CLIENT module when its first statement is the
 * `"use client"` directive, and a SERVER module otherwise. A server module may
 * import a client module's **components** — that is the entire point of the
 * boundary, and `layout.tsx` -> `Shell`, `record-fields.tsx` -> `FieldEditor`
 * are the two the app is built on. It may **not** import anything else that
 * survives to runtime: a helper, a constant, a namespace. A TYPE import is
 * erased before the boundary exists and is always fine.
 *
 * **Why the rule is asserted on directiveless modules too.** A module with no
 * directive that happens to be used only from client code is still classified
 * SERVER here, and a value import from a client module still reddens it. That
 * is deliberate: nothing marks such a module as client-only, so one new import
 * from a page pulls it into the server graph, and the fix is the cheap one the
 * campaign already took — hoist the value into a directiveless module both
 * sides import (`edit-cell-layout.ts`).
 *
 * **The escape hatch this rule does NOT give.** Nothing here is a list of
 * exempt files. A value that both sides need moves out of the client module;
 * it does not get named here.
 */

/* ── reading a module ─────────────────────────────────────────────────────── */

/**
 * `text` with comments removed and string literals kept intact.
 *
 * A single pass with the string states tracked, rather than a line-prefix
 * filter, for two reasons this rule turns on: `//` inside a string must not
 * start a comment (a specifier could be lost), and a doc comment that quotes
 * an import — this file's own header does — must not read as one.
 * Specifiers themselves are the one thing a scan of imports cannot blank, so
 * strings survive and statement matching is anchored at line starts instead.
 */
export function withoutComments(text: string): string {
  let out = "";
  let index = 0;
  type State = "code" | "line" | "block" | "'" | '"' | "`";
  let state: State = "code";
  while (index < text.length) {
    const two = text.slice(index, index + 2);
    const char = text[index];
    if (state === "code") {
      if (two === "//") {
        state = "line";
        index += 2;
        continue;
      }
      if (two === "/*") {
        state = "block";
        index += 2;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") state = char;
      out += char;
      index += 1;
      continue;
    }
    if (state === "line") {
      if (char === "\n") {
        state = "code";
        out += char;
      }
      index += 1;
      continue;
    }
    if (state === "block") {
      if (two === "*/") {
        state = "code";
        index += 2;
        continue;
      }
      // Newlines are kept so line-anchored matching below stays aligned.
      if (char === "\n") out += char;
      index += 1;
      continue;
    }
    // Inside a string literal: a backslash escapes whatever follows it.
    if (char === "\\") {
      out += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === state) state = "code";
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Is this module's FIRST statement the client directive?
 *
 * "First" is what the bundler requires and therefore what this asks: leading
 * comments and blank lines are skipped, anything else is not the directive.
 * A `"use client"` sitting further down the file is a string expression and
 * marks nothing — which is why this is not a `grep`, and why the four files
 * under `src/` that merely MENTION the directive in prose stay server modules.
 */
export function isClientModule(text: string): boolean {
  return /^\s*["']use client["']\s*;?/.test(withoutComments(text));
}

/* ── the imports of a module ──────────────────────────────────────────────── */

/** One binding an import or re-export statement brings into a module. */
export interface Binding {
  /** The specifier as written: `@/components/EditableCell`, `./client`. */
  readonly source: string;
  /**
   * The name as the SOURCE module exports it — `default` for a default import,
   * `*` for a namespace or a star re-export. The exported name is what decides
   * whether the thing is a component, so a local rename cannot launder it.
   */
  readonly imported: string;
  /** The local name, which is all a default import gives us to judge by. */
  readonly local: string;
  /** `import type` / `{ type X }` / `export type` — erased, never a runtime binding. */
  readonly typeOnly: boolean;
}

const SPACE = String.raw`[\s]`;
const CLAUSE = [
  String.raw`\*(?:${SPACE}+as${SPACE}+\w+)?`,
  String.raw`\{[^}]*\}`,
  String.raw`\w+${SPACE}*,${SPACE}*(?:\{[^}]*\}|\*${SPACE}+as${SPACE}+\w+)`,
  String.raw`\w+`,
].join("|");

/**
 * Every `import ... from "x"` and `export ... from "x"` in a module.
 *
 * A re-export is read exactly like an import, because it is one for this
 * rule's purposes: a server barrel that re-exports a client module's helper
 * hands that helper to every server module importing the barrel, and the
 * boundary is crossed in the barrel.
 *
 * Anchored at a line start (`^` under `m`), so an import quoted inside a
 * string literal — the one thing `withoutComments` deliberately leaves
 * standing — is not read as a statement.
 */
export function bindingsOf(text: string): Binding[] {
  const statement = new RegExp(
    String.raw`^[ \t]*(?:import|export)${SPACE}+((?:type${SPACE}+)?(?:${CLAUSE}))${SPACE}*from${SPACE}*(['"])([^'"]+)\2`,
    "gm",
  );
  const bindings: Binding[] = [];
  for (const match of withoutComments(text).matchAll(statement)) {
    const source = match[3];
    let clause = match[1].trim();
    const statementTypeOnly = /^type\s/.test(clause);
    if (statementTypeOnly) clause = clause.replace(/^type\s+/, "").trim();

    const braced = /\{([^}]*)\}/.exec(clause);
    const beforeBrace = clause.replace(/\{[^}]*\}/, "").replace(/,\s*$/, "").trim();

    // `* as ns` / `*` — a namespace binding names no export, so this scan
    // cannot say what is behind it. Unverifiable by construction is a
    // violation here for the same reason it is in `db/layering.test.ts`: the
    // rule exists to make the boundary readable off the source.
    const star = /^\*(?:\s+as\s+(\w+))?$/.exec(beforeBrace);
    if (star !== null) {
      bindings.push({
        source,
        imported: "*",
        local: star[1] ?? "*",
        typeOnly: statementTypeOnly,
      });
    } else if (beforeBrace.length > 0) {
      bindings.push({
        source,
        imported: "default",
        local: beforeBrace,
        typeOnly: statementTypeOnly,
      });
    }

    if (braced === null) continue;
    for (const raw of braced[1].split(",")) {
      const specifier = raw.trim();
      if (specifier.length === 0) continue;
      const inlineType = /^type\s+/.test(specifier);
      const named = specifier.replace(/^type\s+/, "").trim();
      const renamed = /^(\S+)\s+as\s+(\S+)$/.exec(named);
      bindings.push({
        source,
        imported: renamed === null ? named : renamed[1],
        local: renamed === null ? named : renamed[2],
        typeOnly: statementTypeOnly || inlineType,
      });
    }
  }
  return bindings;
}

/* ── resolving a specifier to a file of this repo ─────────────────────────── */

const EXTENSIONS = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

/**
 * The repo-relative file a specifier names, or `null` for a package.
 *
 * Only `@/*` (the repo's tsconfig alias for `src/*`) and relative paths can
 * name a module of this tree; everything else is `node_modules` and has no
 * client boundary of ours to cross.
 */
export function resolveSpecifier(
  source: string,
  fromFile: string,
  exists: (file: string) => boolean,
): string | null {
  let base: string;
  if (source.startsWith("@/")) base = `src/${source.slice(2)}`;
  else if (source.startsWith("./") || source.startsWith("../")) {
    const segments = fromFile.split("/").slice(0, -1);
    for (const segment of source.split("/")) {
      if (segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    base = segments.join("/");
  } else return null;
  // A `.js` specifier for a `.ts` module is the ESM spelling TypeScript
  // expects; try the source extensions under the stripped name too.
  const candidates = base.endsWith(".js") ? [base, base.slice(0, -3)] : [base];
  for (const candidate of candidates) {
    for (const extension of EXTENSIONS) {
      if (exists(candidate + extension)) return candidate + extension;
    }
  }
  return null;
}

/* ── is the imported export a component? ──────────────────────────────────── */

/**
 * A name React itself would accept as a component in JSX: capitalised, with
 * lower-case letters in it and no underscore. `Shell` and `FieldEditor` pass;
 * `hintSide`, `RESTING_AFFORDANCE` and `EM_DASH` do not — and a lowercase name
 * cannot be a component at all, because `<hintSide />` is an HTML tag.
 */
export function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);
}

/**
 * Does the client module DECLARE `name` as a function?
 *
 * The name test alone is a one-rename bypass — `export const HintSide = …`
 * would read as a component while behaving exactly like `hintSide` did — so
 * the export's own declaration is read as well. A `const` whose right-hand
 * side is not a function, and an export whose declaration this scan cannot
 * find at all, both count as NOT a component: an export that cannot be shown
 * to be a component is precisely what may not cross the boundary.
 */
export function declaresComponent(text: string, name: string): boolean {
  const code = withoutComments(text);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const asFunction = new RegExp(
    String.raw`\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+${escaped}\s*[(<]`,
  );
  if (asFunction.test(code)) return true;

  const asBinding = new RegExp(
    String.raw`\b(?:export\s+)?(?:const|let|var)\s+${escaped}\b[^=;]*=\s*([\s\S]{0,40})`,
  );
  const bound = asBinding.exec(code);
  if (bound !== null) {
    return /^(?:\(|<|function\b|async\b|(?:React\.)?(?:memo|forwardRef)\s*\()/.test(
      bound[1].trim(),
    );
  }

  // One hop through a local rename: `export { hintSide as HintSide }`. The
  // ORIGINAL name has to be a component name too, or the rename is exactly the
  // laundering this hop exists to see through.
  const renamed = new RegExp(String.raw`export\s*\{[^}]*?(\w+)\s+as\s+${escaped}\b`).exec(code);
  if (renamed !== null && renamed[1] !== name) {
    return isComponentName(renamed[1]) && declaresComponent(code, renamed[1]);
  }

  return false;
}

/* ── the rule ─────────────────────────────────────────────────────────────── */

export interface Violation {
  /** The server module that crosses the boundary. */
  readonly file: string;
  /** The `"use client"` module it crosses into. */
  readonly clientModule: string;
  /** The export it takes, as the client module names it. */
  readonly symbol: string;
  /** One line naming both files and the symbol — what replaces a 500 digest. */
  readonly message: string;
}

/**
 * Every place a server module imports a non-component value from a client
 * module.
 *
 * `read` is injected so the rule can be proved against fixture modules that
 * exist only as strings. Writing probe files under `src/` would be the other
 * way, and it is the one this suite has already been bitten by
 * (admin-window/BUG-0029): other offline files walk that same tree in parallel
 * workers.
 */
export function clientBoundaryViolations(
  files: readonly string[],
  read: (file: string) => string,
): Violation[] {
  const known = new Set(files);
  const client = new Map<string, boolean>();
  const isClient = (file: string): boolean => {
    let answer = client.get(file);
    if (answer === undefined) {
      answer = isClientModule(read(file));
      client.set(file, answer);
    }
    return answer;
  };

  const violations: Violation[] = [];
  for (const file of files) {
    if (isClient(file)) continue;
    for (const binding of bindingsOf(read(file))) {
      if (binding.typeOnly) continue;
      const target = resolveSpecifier(binding.source, file, (candidate) =>
        known.has(candidate),
      );
      if (target === null || !isClient(target)) continue;

      const name = binding.imported === "default" ? binding.local : binding.imported;
      if (binding.imported !== "*" && isComponentName(name) && declaresComponent(read(target), name)) {
        continue;
      }
      const what =
        binding.imported === "*"
          ? `the whole namespace (\`* as ${binding.local}\`)`
          : `\`${name}\``;
      violations.push({
        file,
        clientModule: target,
        symbol: name,
        message:
          `${file} is a server module and imports ${what} from the "use client" ` +
          `module ${target}. Only a component may cross that boundary: a value ` +
          `imported from a client module is a client reference on the server, and ` +
          `touching it answers 500 at runtime while every offline test stays green ` +
          `(admin-window/BUG-0094). Move the value into a module with no ` +
          `"use client" directive and import it from both sides, the way ` +
          `src/components/edit-cell-layout.ts already does.`,
      });
    }
  }
  return violations;
}

/** The rule over the real tree. */
function violationsInRepo(): Violation[] {
  return clientBoundaryViolations(sourceFiles(), (file) => sourceText(file));
}

/* ── the tree ─────────────────────────────────────────────────────────────── */

describe("the client boundary under src/", () => {
  it("has client modules and server modules for the rule to be about", () => {
    // Non-vacuity, first half: a classifier that answered "client" for nothing
    // (or for everything) would make the rule below pass without asserting
    // anything at all.
    const files = sourceFiles();
    const clients = files.filter((file) => isClientModule(sourceText(file)));
    expect(clients.length).toBeGreaterThan(1);
    expect(clients).toContain("src/components/EditableCell.tsx");
    expect(clients.length).toBeLessThan(files.length);
    // And a module that only MENTIONS the directive in prose is not one.
    expect(clients).not.toContain("src/components/edit-cell-layout.ts");
  });

  it("really resolves server imports of client components", () => {
    // Non-vacuity, second half — and the sharpest of the two. If specifier
    // resolution silently returned null the rule would report nothing forever,
    // and this suite would be green because it never reached the boundary.
    // These two imports ARE the boundary this app is built on, so the analyzer
    // must see them and must call them legal.
    const files = sourceFiles();
    const known = new Set(files);
    const crossings = files.flatMap((file) => {
      if (isClientModule(sourceText(file))) return [];
      return bindingsOf(sourceText(file))
        .filter((binding) => !binding.typeOnly)
        .map((binding) => ({
          file,
          binding,
          target: resolveSpecifier(binding.source, file, (candidate) =>
            known.has(candidate),
          ),
        }))
        .filter(({ target }) => target !== null && isClientModule(sourceText(target)));
    });
    const seen = crossings.map(({ file, binding, target }) => `${file} ${binding.imported} ${target}`);
    expect(seen).toContain(
      "src/app/layout.tsx Shell src/components/shell/shell.tsx",
    );
    expect(seen).toContain(
      "src/components/records/record-fields.tsx FieldEditor src/components/records/field-editor.tsx",
    );
  });

  it("never imports a non-component value from a client module", () => {
    expect(violationsInRepo().map((violation) => violation.message)).toEqual([]);
  });
});

/* ── the guard, proved on fixtures ────────────────────────────────────────── */

/**
 * The rule against modules that exist only as text — one it MUST flag and one
 * it must NOT, for every shape (LESSONS 3). Nothing here touches the source
 * tree, so nothing here can race the walks running beside it.
 */
describe("the client-boundary guard itself", () => {
  const CLIENT = "src/fixture/cell.tsx";
  const SERVER = "src/fixture/fields.tsx";

  /** The client module of the fixtures: exactly the shape `EditableCell.tsx` has. */
  const clientModule =
    '"use client";\n' +
    'import { useState } from "react";\n' +
    "export type HintSide = \"left\" | \"right\";\n" +
    "export const RESTING_AFFORDANCE = \"underline\";\n" +
    "export function hintSideFromClientModule(multiline: boolean): HintSide {\n" +
    '  return multiline ? "left" : "right";\n' +
    "}\n" +
    "export function EditableCell({ value }: { value: string }) {\n" +
    "  const [held] = useState(value);\n" +
    "  return <span>{held}</span>;\n" +
    "}\n";

  function violations(server: string, client = clientModule): Violation[] {
    const files: Record<string, string> = { [CLIENT]: client, [SERVER]: server };
    return clientBoundaryViolations(Object.keys(files), (file) => files[file]);
  }

  it("flags QA's exact violation, naming the file, the client module and the symbol", () => {
    // The sabotage of admin-window/BUG-0094, spelled as QA spelled it.
    const found = violations(
      'import { hintSideFromClientModule } from "./cell";\n' +
        "export function RecordFields() {\n" +
        "  return <span>{hintSideFromClientModule(true)}</span>;\n" +
        "}\n",
    );
    expect(found).toHaveLength(1);
    expect(found[0].file).toBe(SERVER);
    expect(found[0].clientModule).toBe(CLIENT);
    expect(found[0].symbol).toBe("hintSideFromClientModule");
    // Criterion 2: the failure names both ends. A `500 digest` in a server log
    // is what this check exists to replace.
    expect(found[0].message).toContain(SERVER);
    expect(found[0].message).toContain(CLIENT);
    expect(found[0].message).toContain("hintSideFromClientModule");
  });

  it("does not flag a server component that renders a client component", () => {
    // The legal crossing, and the one the app is built on. A guard that
    // reddened here would be unusable and would be turned off.
    expect(
      violations(
        'import { EditableCell } from "./cell";\n' +
          "export function RecordFields() {\n" +
          "  return <EditableCell value=\"x\" />;\n" +
          "}\n",
      ),
    ).toEqual([]);
  });

  it("does not flag a type-only import, in either spelling", () => {
    // Types are erased before a client reference exists — `submit.ts` takes
    // `SaveOutcome` out of `EditableCell.tsx` exactly this way today.
    expect(
      violations('import type { HintSide } from "./cell";\nexport type A = HintSide;\n'),
    ).toEqual([]);
    expect(
      violations('import { type HintSide } from "./cell";\nexport type A = HintSide;\n'),
    ).toEqual([]);
    expect(
      violations(
        'import { EditableCell, type HintSide } from "./cell";\n' +
          "export type A = HintSide;\n" +
          "export const C = EditableCell;\n",
      ),
    ).toEqual([]);
  });

  it("flags a value taken from a client module in every import spelling", () => {
    for (const server of [
      // a named import
      'import { hintSideFromClientModule } from "./cell";\n',
      // renamed on the way in, so the importing file never spells it
      'import { hintSideFromClientModule as side } from "./cell";\n',
      // a SCREAMING_CASE constant, which no JSX tag could be
      'import { RESTING_AFFORDANCE } from "./cell";\n',
      // beside a legal component import, so the good one cannot mask the bad
      'import { EditableCell, hintSideFromClientModule } from "./cell";\n',
      // a namespace, which names no export this scan can judge
      'import * as cell from "./cell";\n',
      // through the repo alias rather than a relative path
      'import { hintSideFromClientModule } from "@/fixture/cell";\n',
      // the TypeScript ESM spelling of the same relative module
      'import { hintSideFromClientModule } from "./cell.js";\n',
      // broken over lines, as a formatter writes a long list
      "import {\n  EditableCell,\n  hintSideFromClientModule,\n} from \"./cell\";\n",
      // a re-export: the barrel crosses the boundary on its importers' behalf
      'export { hintSideFromClientModule } from "./cell";\n',
      // a star re-export, which hands on everything including the helper
      'export * from "./cell";\n',
    ]) {
      const found = violations(server);
      expect(found.length, server).toBeGreaterThan(0);
      expect(found[0].clientModule, server).toBe(CLIENT);
    }
  });

  it("is not fooled by a capitalised helper", () => {
    // The one-rename bypass a name-shape test alone would wave through: the
    // export's own declaration decides, not its capitalisation.
    const client =
      '"use client";\n' +
      "export const HintSide = \"left\";\n" +
      "export function Cell() {\n  return <span />;\n}\n";
    const found = violations('import { HintSide } from "./cell";\n', client);
    expect(found).toHaveLength(1);
    expect(found[0].symbol).toBe("HintSide");
    // …and a rename INSIDE the client module is followed one hop.
    const laundered =
      '"use client";\n' +
      "function hintSide() {\n  return 1;\n}\n" +
      "export { hintSide as HintSide };\n";
    expect(violations('import { HintSide } from "./cell";\n', laundered)).toHaveLength(1);
  });

  // PIN, admin-window/BUG-0094 (reopened): `it.fails` while the hole is open —
  // the day the guard closes it this XPASSes and goes red, which is the
  // signal to delete `.fails` here rather than to re-file the bug.
  it.fails("a capitalised ARROW helper does not launder past the guard either", () => {
    // admin-window/BUG-0094, reopened by QA 2026-09-08. `declaresComponent`
    // accepts any right-hand side that opens with `(`, so an ordinary helper
    // written as an arrow function and given a component's name is read as a
    // component and waved through — the very bypass the test above claims to
    // close, one spelling further on. MEASURED on this tree, production build
    // on 127.0.0.1:8823 against staging: adding
    // `export const HintSideFor = (row: number, rows: number): HintSide => …`
    // to src/components/EditableCell.tsx and calling it from
    // `RecordFields` (src/components/records/record-fields.tsx, a server
    // component) left this file at 13 passed, the whole offline suite at 2589
    // passed, `npm run lint` at 0 and `tsc --noEmit` clean — while
    // GET /records/walk_sandbox/00000000-0000-4000-8000-000000000001 answered
    // **500** (`Attempted to call HintSideFor() from the server`, digest
    // 2955157816). Reverting the two files and rebuilding answered 200.
    const client =
      '"use client";\n' +
      "export const HintSide = (row: number, rows: number) =>\n" +
      '  rows > 1 && row === rows - 1 ? "above" : "below";\n' +
      "export function Cell() {\n  return <span />;\n}\n";
    const found = violations('import { HintSide } from "./cell";\n', client);
    expect(found).toHaveLength(1);
    expect(found[0].symbol).toBe("HintSide");
  });

  it("judges a default import by the name it is given", () => {
    const client = '"use client";\nexport default function Cell() {\n  return <span />;\n}\n';
    expect(violations('import Cell from "./cell";\n', client)).toEqual([]);
    const helper = '"use client";\nexport default function hintSide() {\n  return 1;\n}\n';
    expect(violations('import hintSide from "./cell";\n', helper)).toHaveLength(1);
  });

  it("says nothing about imports that do not cross the boundary", () => {
    // A package, a side-effect import, and a value from a module with no
    // directive: none of these is this rule's business, and a guard that
    // reported them would be reporting noise instead of defects.
    const files: Record<string, string> = {
      "src/fixture/layout.ts": "export function hintSide() {\n  return 1;\n}\n",
      [SERVER]:
        'import { useMemo } from "react";\n' +
        'import "./styles.css";\n' +
        'import { hintSide } from "./layout";\n' +
        "export const side = hintSide();\n",
    };
    expect(
      clientBoundaryViolations(Object.keys(files), (file) => files[file]),
    ).toEqual([]);
  });

  it("says nothing about a CLIENT module importing a client value", () => {
    // `field-editor.tsx` -> `EditableCell.tsx` is client-to-client: both sides
    // are in the client graph and no reference is created at all.
    const files: Record<string, string> = {
      [CLIENT]: clientModule,
      "src/fixture/editor.tsx":
        '"use client";\nimport { hintSideFromClientModule } from "./cell";\n' +
        "export function Editor() {\n  return <span>{hintSideFromClientModule(true)}</span>;\n}\n",
    };
    expect(
      clientBoundaryViolations(Object.keys(files), (file) => files[file]),
    ).toEqual([]);
  });

  it("reads the directive only where a bundler reads it", () => {
    // Leading comments and blank lines are skipped; anything else means the
    // string is an expression and marks nothing. Both fixtures matter: the
    // first is how every client module in this repo actually opens, and the
    // second is what stops this rule going blind on a file that merely talks
    // about the directive — four modules under `src/` do.
    expect(isClientModule('"use client";\nexport function A() {}\n')).toBe(true);
    expect(isClientModule("'use client';\n")).toBe(true);
    expect(isClientModule('/** Doc.\n * "use client" is discussed here.\n */\n"use client";\n')).toBe(
      true,
    );
    expect(isClientModule('// leading line comment\n\n"use client";\n')).toBe(true);
    expect(isClientModule('/** Doc mentioning "use client". */\nexport const a = 1;\n')).toBe(false);
    expect(isClientModule('import { a } from "b";\n"use client";\n')).toBe(false);
    expect(isClientModule("export const useClient = 1;\n")).toBe(false);
  });

  it("does not read an import out of a comment or a string", () => {
    // This file's own header quotes an import, and so do several modules under
    // src/. A scan that read those would report files that import nothing.
    expect(bindingsOf('// import { hintSide } from "./cell";\n')).toEqual([]);
    expect(bindingsOf('/*\nimport { hintSide } from "./cell";\n*/\n')).toEqual([]);
    expect(
      bindingsOf('const example = \'import { hintSide } from "./cell";\';\n'),
    ).toEqual([]);
    // …and still sees the real one on the next line.
    expect(
      bindingsOf(
        '// import { hintSide } from "./cell";\nimport { EditableCell } from "./cell";\n',
      ).map((binding) => binding.imported),
    ).toEqual(["EditableCell"]);
  });
});
