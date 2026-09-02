# AgenticFlow — Design v0.4

**Goal:** Give the system an idea. One short, bounded co-design session locks the
vision; from there it autonomously produces a working app — specifying, planning,
building, adversarially testing, and then proposing and shipping new milestones on
its own — until a stop condition is reached.

**Substrate:** Claude Code (`.claude/` directory: custom agents, a `/ship` skill, hooks).
Chosen because it supplies the engine (orchestration, tools, permissions, subagents,
worktrees) for free, and ports later to a standalone Claude Agent SDK app if outgrown.

---

## 1. Core principles

1. **Full autonomy, adversarial quality.** No human gates. The known failure mode of
   gated pipelines — agents satisfice and outsource verification to the human reviewer —
   is countered by *internal opposed incentives*, not by trust:
   - The builder never grades its own work.
   - A QA agent's definition of success is *finding problems*.
   - "Done" is machine-observed (hooks run the tests / launch the app), never asserted.
2. **The tracker is the source of truth.** All coordination happens through ticket
   files in the repo, not through agent conversation or memory. Any agent can crash,
   be restarted, or be multiplied — the queue state is always sufficient to continue.
3. **Stateless workers.** Every worker role is defined as "pull eligible work from the
   tracker, do it, write the result back." This makes parallelism a config number,
   not a redesign (see §6).
4. **Bounded drift.** `VISION.md` is co-designed with the human once at intake
   (§2a), then immutable. Every milestone, feature, and priority call must trace to
   it. This is what keeps a fully-autonomous product from wandering.
5. **Bounded run.** Explicit stop conditions: milestone budget, token/time budget,
   or vision satisfied. Autonomy never means "runs forever."
6. **Context economy.** No agent ever loads the whole tracker, full histories, or
   past conversations. The dispatcher hands each agent a minimal **work packet**
   (§3a). Closed work is archived out of view and compressed into summaries.
   Token burn is a first-class design constraint, not an afterthought.

## 2. The team

| Agent | Personality in one line | Tools (enforced) |
|---|---|---|
| **Visionary** | Product founder. Turns the idea into a north star, not a feature list. | read, write docs/tickets only |
| **Architect** | Tech lead. Decomposes milestones into tickets with contracts and acceptance criteria. | read, write tickets/plans only — **no code edits** |
| **Builder** (×N) | Senior engineer. Pulls a ticket, implements it, proves it locally, hands off. | full dev tools |
| **QA Adversary** | Professional pessimist. Paid per bug found. Trusts nothing marked "built". | read + run/test tools — **no source edits** (may add tests) |
| **Verifier** | End-user simulator. Launches the real app and exercises the spec end-to-end. | read + run tools only |
| **Strategist** | Product manager. Reviews shipped milestone against VISION, plans the next one. | read, write tickets/roadmap only |
| **Toolsmith** | Supply-chain skeptic. Vets every new dependency or external tool before anyone may install it. | read + web research; **sole writer** of the dependency allowlist |

The **Dispatcher** is not a personality and holds no accumulating context. It is two
layers:

1. **A deterministic core (scripts, zero tokens).** Frontmatter is machine-readable
   on purpose: plain scripts regenerate `INDEX.md`, run the watchdog sweep, enforce
   transition rules, maintain parent↔children links, and compute the *eligible set*
   (deps done, priority order, disjoint touch scopes). No LLM reads anything for any
   of this.
2. **A stateless scheduler tick (small, bounded LLM step).** Each tick is a fresh
   invocation that reads only `INDEX.md` (one line per open ticket) and the current
   milestone file, then decides what to spawn from the pre-computed eligible set.
   It never reads ticket bodies, notes, archives, or prior conversations — per-tick
   token cost is O(open tickets), flat no matter how old the project gets. Because
   the tracker is the source of truth (principle 2), a fresh tick loses nothing.

Tool restrictions are enforced by the agent definitions (and hooks), not by prompt
politeness: QA *cannot* quietly fix a bug or weaken a test; the Architect *cannot*
start coding.

## 2a. Intake: co-designing the vision

A one-liner is too vague to match the human's intent — but unbounded questioning is
its own failure mode (agents inventing "design choices" out of thin air, forever).
Intake is therefore **strawman-driven and bounded**:

1. Human gives the idea — a line or a paragraph.
2. Visionary immediately writes a **strawman `VISION.md` draft**. Reacting to a
   concrete draft is faster and surfaces misalignment better than abstract Q&A.
3. Visionary may ask questions only if they pass the **fork test**: different
   answers must lead to materially different products. No fork → no question.
4. Human marks up the draft; converge in **≤3 rounds**, then VISION.md freezes.

**Altitude rule:** VISION.md is capped at one page and describes only *what the
product is* — who it's for, what it does, what success looks like, explicit
non-goals. Implementation vocabulary (stacks, schemas, file names, endpoints) is
banned at this altitude; that lives in SPEC.md and below, owned by agents.

## 2b. Visions are campaigns (v0.3-E — decided 2026-07-16)

A vision is born for a goal, satisfied, and **closed** — a campaign, not an
immortal product manifesto. One repo hosts many big ideas over time
(mostly independent — Ben's framing); each gets its own self-contained
campaign under `agenticflow/visions/<slug>/`: its docs (VISION, SPEC,
ROADMAP, LOOK_AND_FEEL, PERSONAS) and its whole tracker — ticket ids start
at 0001 per campaign, archive, milestones, digests, evidence. Repo truth
stays global in `agenticflow/docs/`: STACK, DECISIONS, the dep lists —
they bind the codebase, not a goal.

The ACTIVE campaign is selected by symlinks (`agenticflow/docs/vision`,
the vision-scoped `tracker/` subdirs); every script and agent reads only
the stable paths, so switching campaigns (`vision.py switch` — refused
mid-run) repoints storage, never interfaces. Usually a campaign is one
milestone; the strategist plans M2+ inside it only when the boundary retro
finds the vision genuinely unsatisfied. Returning to old work later is a
NEW campaign: brownfield intake documents the app that exists, the closed
campaign's folder is readable history, and continuity lives where it
belongs — in the code, STACK, and DECISIONS. Historical gaps from before
this model are fixed as one-offs, never as standing retrofit rules.

**Every campaign runs on its own branch** (`run/<slug>`, created by
`vision.py new`) — main is human territory. A vision-satisfied stop opens
the human's verification window (walk the app, file patch notes); their
sign-off triggers `vision.py merge`: `--no-ff` into main, the FULL suite on
the merged tree (run branches are verified alone; the merged tree is the
first place their combination exists), CLOSED on green, and a complete
rollback of main on red or conflict — the failure then belongs to the run
branch, where a patch run fixes it. Concurrent runs (v0.3-G) are one run
per git worktree, each its own branch/campaign/tracker — run-state files
are per-checkout already, and only `merge` ever brings them together.

## 3. The tracker

`agenticflow/tracker/tickets/<ID>.md` — one file per work item, git-versioned, human-readable.

```markdown
---
id: FEAT-0012          # FEAT / TASK / BUG / DEBT / DEP
type: feature
status: open           # open → claimed → built → qa → done   (+ blocked, wont_fix, reopened, disputed)
milestone: M1
priority: P1           # P0 blocker … P3 nice-to-have
opened_by: visionary
parent: null           # tickets form a shallow tree: FEAT → TASK (→ one more split, max)
children: []           # maintained mechanically by the index script — tree queryable both ways
assignee: null         # claimed by a builder instance; the claim IS the lock
claimed_at: null       # claims are leases — stale claims get swept (see rules below)
depends_on: []         # ticket IDs; dispatcher won't schedule until deps are done
touch_scope: []        # declares where the work lands (stall probes, self-scan, QA blast radius) — a map, not a lock (§6)
discovered_from: null  # provenance: the ticket whose work surfaced this one (QA files BUGs with it)
resolution: null       # set at close: fixed (default) / no_change / obsolete / already_done —
                       # a no-op closure is never dressed up as work
---

## Description
## Acceptance criteria      <- machine-checkable wherever possible ("`npm test x` exits 0")
## Interface contract       <- (tasks only) what this exposes, so parallel builders can rely on it
## History                  <- append-only log: every status change, by whom, why
```

**Granularity:** work is executed only at leaf tickets, each scoped to roughly one
focused agent session and independently testable — as small as possible without the
tree getting deep (FEAT → TASK, at most one further split). Parents aggregate child
status automatically and are never worked directly. Minimum granularity is what keeps
work packets — and token spend — small.

**Transition rules (hook-enforced, not honor-system):**
- Builder may move `claimed → built`, never `→ done`.
- Only QA moves `built → qa → done` (or `→ reopened` with a BUG ticket linked).
- `qa → done` additionally requires a green **evidence receipt**
  (`agenticflow/scripts/receipt.py`): a script re-runs the acceptance-criteria commands
  itself and records the exit codes and a content hash of the touch scope; the
  transition refuses without a green receipt matching the current code. The
  receipt proves the claimed checks passed on this exact tree — nothing more;
  goal-match stays QA judgment (criteria are the floor, not the ceiling).
- `done` at milestone level additionally requires the Verifier's end-to-end pass
  and a green test-suite exit code observed by a hook.
- Every transition appends to History with agent + timestamp + one-line reason.

**Anti-rot watchdog (tickets must not get stuck):** every dispatcher tick runs a
deterministic sweep — no agent judgment involved:
- Stalled claim (claimed 30+ min with **zero file changes in its worktree**) →
  flagged for immediate release. Observed artifact delta is the liveness signal,
  never an agent's self-report.
- Stale claim (`claimed_at` old, no activity) → claim released, ticket requeued.
  The blunt-timer backstop behind the stall flag above.
- `blocked` longer than a threshold → re-check the blocker; if it's gone, reopen;
  if it's human-shaped, surface it in the daily digest.
- Unassigned P0/P1 while any worker is idle → flagged loudly on the status board.
- Circuit breaker: per-ticket counters persisted in frontmatter (attempts,
  empty-diff exits, consecutive identical failure signatures). Past threshold the
  ticket leaves the builder queue and routes to the Architect — a fresh agent on
  identical inputs mostly repeats the approach, so the fix is changing the inputs
  (rewrite/split), never another same-shaped retry. The breaker stops spend and
  routes; it does not pretend a retry is a strategy.
- Red suite: `agenticflow/scripts/ci_check.py` (each tick, self-skips when the app tree is
  unchanged) auto-files a single P0 repair BUG whose packet is the failure log +
  diff since last green. Progress is measured by the failure signature moving;
  no-progress strikes or an oscillating signature block the BUG into the digest —
  the cap is on futility, never on fixes.
Stuck-in-limbo states are a known failure mode of tracker-based systems; the sweep
makes them impossible to *silently* sustain.

**Lifecycle markers (run-level liveness, readable from outside):**
- `agenticflow/tracker/HEARTBEAT` — rewritten by every dispatch tick; the menu-bar monitor
  (bgmon) alarms when it goes stale while a run is in flight. Detects a wedged
  session the in-process sweep can't see (the sweep only runs if ticks run).
- `agenticflow/tracker/CLOSING` — done-intent marker: touched the moment a stop is decided,
  deleted (with `RUNNING`) when the close completes. A session that dies mid-close
  leaves it behind, and the next session finishes the close instead of resuming —
  a decided stop can no longer be lost to a crash.

## 3a. Context economy — keeping the tracker readable forever

The tracker will outgrow any context window; agents therefore never read it whole.
- **Work packets:** the dispatcher assembles each agent's input — its ticket, direct
  dependencies, the relevant interface contracts, pointers to files it may touch.
  Nothing else. An agent's token cost is bounded by its ticket, not by project age.
- **`agenticflow/tracker/INDEX.md`:** one line per *open* ticket, regenerated by the dispatcher
  each tick. This status board is the only global view anyone (agent or human) reads.
- **Short ticket bodies:** verbose investigation logs go to `agenticflow/tracker/notes/<ID>.md`,
  read only on demand; the ticket keeps conclusions.
- **Ticket compaction:** small scope bounds *most* tickets, but some legitimately
  churn (a bug that takes five attempts) and their history outgrows usefulness.
  When a script notices a ticket file past a size threshold, it schedules a
  compaction step: the history is rewritten into a short summary — current state,
  what has been tried, and **dead ends with the reason they failed** (preserved
  explicitly; they are what prevents repeating work) — and the raw log moves to
  `agenticflow/tracker/notes/<ID>.md`. From then on agents read: original description +
  acceptance criteria (always verbatim, never compacted) + the compacted summary +
  entries after the compaction marker. The raw log is never deleted, so a stuck
  agent can still dig on demand. Two guards are mechanical, not prompt-level:
  the script refuses a summary missing the State/Tried/DEAD-ENDS shape, and any
  ticket ID cited in the raw history but dropped from the summary is re-appended
  automatically (cross-references other tickets rely on never dangle). A ticket
  hitting its **second** compaction is a
  smell — it is flagged to the Architect as a split-or-escalate candidate.
- **Milestone compression:** when a milestone closes, its tickets move to
  `agenticflow/tracker/archive/` and the milestone file gets a written retro/summary. History
  stays greppable in git; it just stops occupying anyone's context.

## 4. Artifacts

```
AgenticFlow/                     <- this repo is the factory template; copy per idea
  .claude/
    agents/    visionary.md architect.md builder.md qa-adversary.md verifier.md strategist.md
    skills/    ship/SKILL.md     <- the dispatcher playbook
    hooks/                       <- definition-of-done gates, transition validation
  docs/
    VISION.md                    <- immutable north star (co-designed at intake, ≤1 page)
    SPEC.md                      <- living spec, strategist may extend, never contradict VISION
    STACK.md                     <- tech stack, chosen once by Architect at M1 (see §8.4)
    ROADMAP.md                   <- milestones: shipped / current / proposed
    DECISIONS.md                 <- append-only architecture decision log
    ALLOWED_DEPS.md              <- dependency allowlist; Toolsmith is sole writer (§7)
  agenticflow/tracker/
    INDEX.md                     <- status board: one line per open ticket (regenerated)
    tickets/                     <- the queue (open work)
    notes/                       <- per-ticket verbose logs, read on demand
    archive/                     <- closed tickets, out of everyone's context
    milestones/M1.md             <- milestone definition + exit criteria + retro
  app/                           <- the product being built
```

**Change-view discipline:** every document change lands as a git commit with a
one-line summary. The human reviews *diffs* (`git diff`, daily digest), and is never
asked to re-read a whole document to find what moved.

**The attention UI** (`agenticflow/scripts/ui.py`, started by `/ship` Phase 0, survives the
run): a localhost-only page that is a *window onto the tracker*, never a medium
agents work through — it reads the same files agents write and adds zero
context to any packet (the paperclip lesson). Tabs: Now (agents in flight from
`spawn_log.tsv` spawned/returned pairs, plus best-effort live token telemetry
tailed from Claude Code session transcripts — display-only, never read back by
the factory), Tickets, My tickets, Docs (markdown rendered via mistune with
`escape=True, plugins=['table']` — DEP-0008's trust condition, so quoted
web-sourced HTML displays inert). Its one write path is filing a note into
`agenticflow/tracker/inbox/` — the identical artifact to the human writing the file by
hand; the strategist stamps routed tickets `discovered_from: inbox:<filename>`
so the human can watch their note become tickets and read the close. No
approve/force/comment buttons, deliberately: anything that changes factory
state beyond filing stays in the terminal, on the record. `spawn_log.tsv`
itself is written mechanically by a Pre+PostToolUse hook on the Agent tool
(`agent_ledger.py`, gated on `agenticflow/tracker/RUNNING`) — the first real run proved
orchestrator discipline writes zero lines. The Now tab also shows a
per-/ship-invocation agent history (boundaries recorded by `ship_marker.py`
in `ship_invocations.tsv`).

**The patch lane** (2026-07-11, from the first steered run): inbox notes
route to `milestone: patch` BUG/TASK tickets by default — never to a new
milestone (a six-line UX note once became a four-hour milestone endgame).
Patch close is deliberately light: suite green, one designer spot-check of
the touched screens, one user-sim walk — no sweeps, no verifier, no retro.
A note the strategist judges milestone-sized stops for the human's decision;
only the human converts a note into a milestone. **User-sims** are cast from
`agenticflow/docs/vision/PERSONAS.md` — 3–5 personas the designer derives from the frozen
vision at intake (who each person IS, zero product knowledge) — and walk in
both close cadences; the designer judges their first-person reports against
the bars before anything becomes a ticket.

## 5. The loop

```
idea
 └─ Visionary ⇄ human (§2a, ≤3 rounds)
                     → VISION.md frozen; SPEC.md, ROADMAP.md, M1 defined, FEAT tickets filed
     └─ Architect    → FEAT tickets decomposed into TASK tickets w/ contracts + criteria
         └─ ██ BUILD/QA phase — a queue, not a sequence ██
             Dispatcher continuously:
               • assigns open TASK/BUG tickets to Builder(s)
               • sends every `built` ticket to QA Adversary
               • QA files BUG tickets → they enter the same queue immediately
             …until: all milestone tickets done AND QA runs dry (K consecutive
             clean attack rounds find nothing new)
         └─ Verifier  → launches the app, walks SPEC end-to-end; failures = P0 BUGs, loop back
     └─ Strategist    → retro vs VISION → defines M(n+1), files its FEAT tickets
 └─ repeat from Architect … until stop condition (milestone/token budget, or
    Strategist argues VISION is satisfied — argument recorded in ROADMAP.md)
```

Note build/QA is a **pipeline, not a barrier**: QA attacks ticket A while the builder
is on ticket B; bug tickets are picked up as they appear. This is the main downtime
killer even in the serial (one-builder) configuration.

Each day (or each dispatcher session) ends with a **daily digest** — visibility for
the human, never a gate. Fixed structure, most important first, so it is skimmable:

1. **Key items** — decisions made, milestone movement, anything blocked on or
   addressed to the human. If you read nothing else, read this.
2. **Verification checklist** — concrete steps the human can run to check the day's
   claims themselves (commands to run, flows to click through), each mapped to the
   ticket it verifies.
3. **Everything else** — rail telemetry, counts, and notes worth recording.

**Human feedback channel:** the human may drop freeform notes into `agenticflow/tracker/inbox/`
at any time (typically after walking the digest checklist). No schema required. On
the next tick each note is routed: bug-shaped → a BUG ticket is filed; feature-shaped
→ Strategist triages it against VISION (human-sourced input gets priority triage, not
automatic acceptance); question-shaped → answered in the next digest. The agents do
the ticketing; the human just writes.

## 5a. Verification cadence — dev by default, release on invocation (decided 2026-07-20)

Runs are always **dev cadence**; there is no tier flag to set and none an
agent could ever promote. Dev cadence relaxes DEPTH, never honesty: QA closes
built tickets in **batches** (one spawn per sibling group — per-ticket
criteria checks, one integrated attack, per-ticket closes), bounce re-checks
are **fix-scoped** (fresh instance, but the diff sets the scope), and a
milestone endgame is the **walk trio, single pass** (designer → user-sim →
verifier) with one **early walk** when the milestone's first FEAT lands — no
whole-app sweeps, no clean-round loop. The integrity machinery is identical
at every depth: receipts, QA-only closes, no self-grading.

The 2026-07-18 retro is the evidence: across three runs the walks found every
load-bearing bug while repeated code sweeps re-certified what already held,
and mid-vision milestones never ship to users anyway — certifying each one to
release grade was ~40% of the bill.

**Release is an event, not a property of a run**: `/ship release` (human-only)
runs the hardening pass at the moment the result actually faces users —
changelog since the last `release-*` tag, whole-app smoke, deep QA attack +
structure pass on the changed surfaces with `qa_dry_rounds` clean rounds,
walk trio, human sign-off, release tag. Certify what changed; smoke what
didn't (the staging-day model).

Cold-start economics ride the same decision: a bounced ticket returns to the
builder that built it (SendMessage continuation — the context is already
paid for; fresh spawn is the fallback), while QA and the walks stay
fresh-instance by design (a reviewer who remembers the last map anchors on
it).

## 6. Parallelization (branch-per-ticket, v0.3-A — decided 2026-07-16)

Workers are stateless and the tracker is the ownership lock (claiming a
ticket = owning it); ISOLATION is git, not scope locks. The 2026-07-15 run
proved scope-mutex scheduling over-serializes (empty scopes = whole-repo
locks; a small app's tickets all share the same files anyway):

- **One worktree + branch per assigned ticket** (`agenticflow/.worktrees/<ID>`,
  branch `ticket/<ID>`), created and cleaned by dispatch.py. The builder
  works only there; the primary checkout stays clean.
- **The builder resolves, the dispatcher lands.** The builder's handoff is:
  commit on the branch → rebase onto the run branch, resolving conflicts
  itself → re-run the targeted criteria → `built`. dispatch.py then merges
  the branch onto the run branch mechanically next tick; a branch that no
  longer merges cleanly (another ticket landed first) bounces back to
  `reopened` for a builder to re-rebase — conflicts are always agent work.
- **QA and the receipt run only after the land**, on the run branch: a bad
  conflict resolution cannot close a ticket. QA failures fix FORWARD (the
  merged code stays; the ticket reopens on a fresh branch) — the run branch
  is not deployable mid-run anyway; the run-end gate is.
- **`touch_scope` survives as a declaration** — stall probes, self-scan
  blast radius, QA's map of where to attack — but no longer schedules.
- **N QA probes** attacking different features simultaneously; the
  dispatcher spends its concurrency budget on the deepest queue.

Parallelism is `builders` in run.yaml, now a true knob: N builders means N
concurrent lanes, full stop.

## 7. Stop conditions & safety rails

- `agenticflow/run.yaml` (per-run config): max milestones, max wall-clock, optional token budget.
  run.yaml is the HUMAN's control surface: while a run is live no agent may
  edit it (ticket_gate enforces; Ben's 2026-07-29 ruling). A run that wants a
  knob changed — more builders, a different threshold — pushes a proposal
  (notify.py attention event: key, value, why) and continues at current
  settings; the human applies it by editing the file, which each tick re-reads.
- Kill switch: deleting `agenticflow/tracker/RUNNING` halts the dispatcher at the next loop tick.
- Escalation file: if truly blocked (missing credential, irreversible decision),
  agents file a `BLOCKED` ticket assigned to `human` and *continue with other work* —
  blocking on a human is allowed for a ticket, never for the pipeline.
- Optional human checkpoints (later): a hook that pauses at milestone boundaries
  when `agenticflow/run.yaml: gated=true`. Off by default, per design philosophy.
- **Supply-chain gate:** no agent may install, clone, or `curl | sh` anything not
  listed in `agenticflow/docs/ALLOWED_DEPS.md`. Wanting a new dependency = filing a DEP ticket;
  the **Toolsmith** vets it (registry legitimacy, maintenance and adoption signals,
  security advisories, typosquat check, and "is this actually needed or is stdlib
  fine") and is the only role allowed to edit the allowlist. A hook denies
  non-allowlisted installs outright. This targets a real attack class — agents are
  demonstrably prone to recommending obscure or malicious packages with
  AI-attractive names. Two mechanical layers on top: `agenticflow/docs/BLOCKED_DEPS.md`
  (human-only, checked first, survives a compromised vetting) and a
  **near-name check** — a requested name within typo distance of a different
  vetted name is blocked as a suspected typosquat *without* the usual
  file-a-DEP advice (squats are built to survive vetting; the funnel into the
  toolsmith is the attack path). If both halves of a near-pair ever appear on
  the allowlist, installs of either jam until the human resolves it;
  deliberate pairs need a human-added `[near-ok]` marker, which the ticket
  gate refuses to let any agent write.
- **Force mode (human pushback):** the human may reopen any cut or `wont_fix`
  ticket with `force: true`. A forced ticket must get a genuine attempt with a real
  budget, ending either in a fix or an *evidence-based* infeasibility report — what
  was tried, exactly where and why it fails. Two forced attempts with consistent
  evidence → status `disputed`: work pauses on that ticket until the human supplies
  new information or accepts the evidence. This balances "agent gives up too
  easily" against "human is wrong" — the currency for both sides is evidence, not
  assertion.
- **Testing the rails:** bounded run, bounded drift, and the watchdog are the
  hardest parts to verify. First live runs instrument them deliberately: every
  Strategist-proposed feature carries a `vision_trace` line, and daily digests
  include rail telemetry (watchdog sweeps triggered, budget consumption curve,
  cut-vs-added feature counts) — so we *observe* the rails holding rather than
  assume it.

## 7a. Portability — the kit and the brownfield doctrine

The factory is packaged for other projects as a **template repo** (the kit),
produced by `agenticflow/scripts/export_kit.sh`: the `.claude/` machinery, `agenticflow/scripts/`,
this document, a `agenticflow/run.yaml` template, an empty tracker skeleton, and seed
allow/block lists — never tracker state, product docs, or the product itself.
Flow is strictly one-way (AgenticFlow → kit → project; copies, never
symlinks) and **release-versioned**: the kit carries a `VERSION` (source of
truth: `agenticflow/scripts/kit/VERSION`), each release is a kit-repo tag, and
installs record what they got in `agenticflow/.kit-manifest.tsv` (file + hash
+ version) — which is what lets `install.sh --upgrade` replace unmodified
factory files while refusing, loudly, to clobber locally-patched ones.
**Layout contract (0.2+):** everything the factory owns lives in one
`agenticflow/` folder at the target repo root; the sole exception is
`.claude/` (agents/hooks/skills/settings), which Claude Code only reads at
the repo root, and the manifest marks those files as kit-owned. In code the
split is `lib.ROOT` (the factory home, `agenticflow/`) vs `lib.PRODUCT` (the
enclosing repo, where `product_dir`, touch scopes, git, and `ci_command`
resolve). This repo itself uses the same layout — the reference install.
Everything project-shaped
is a `agenticflow/run.yaml` key (`product_dir`, `ui_port`, `ci_command`), the hooks
resolve through `$CLAUDE_PROJECT_DIR`, and the scripts through their own
location — the only deliberately non-portable piece is the watchdog
LaunchAgent, which is per-project by hand. On an **existing codebase** the
intake inverts: the factory documents what exists rather than deciding it
(vision scoped to the new work with non-goals naming what must not be
touched; STACK.md read from the code; ALLOWED_DEPS seeded grandfathered from
the shipping manifest; LOOK_AND_FEEL derived from a walk of the real app),
and existing code outside a ticket's touch scope is read-only.

## 8. Resolved questions

1. **Granularity:** as small as independently testable, executed only at leaves of a
   shallow ticket tree (§3). Small leaves are also the context-economy lever.
2. **QA-dry threshold:** K = 2 consecutive clean attack rounds — since
   2026-07-20 applied only in `/ship release` passes (§5a); dev milestones
   close on the walk trio.
3. **Strategist may cut** (never modify VISION); cuts recorded in DECISIONS.md.
   Human counterweight = force mode (§7).
4. **Stack:** chosen **once per project** by the Architect at M1 planning, biased
   toward boring, well-trodden technology, recorded in `agenticflow/docs/STACK.md`; every ticket
   conforms. Stack preferences never live in agent personalities.

## 9. Next steps

1. ~~Design~~ (iterating — see git log for revisions)
2. **Build (this week).** Scaffold `.claude/` — the seven agent personalities +
   `/ship` skill + hooks + tracker skeleton.
3. First live run on a small test idea; observe failure modes (especially the
   rails, §7); iterate.
4. Deep research on existing systems (Devin, OpenHands, MetaGPT, ChatDev, …) →
   a comparison report for human evaluation the following week. *Deliberately
   after design to avoid anchoring; if something out there already does all of
   this, the report will say so.*
5. Parallelism (§6) is on: branch-per-ticket landed 2026-07-16 (v0.3-A).
