# Digest 2026-09-10

## Key items
- **Where the app stands vs the vision.** M2 (the verdict slice) is SHIPPED and tagged `m2`: every §7 surface built, `/claims` rebuilt to read one database-ordered window plus head counts, all 128 M2 + patch tickets closed, CI green. MID-FLIGHT: M3 "completeness of the read slice" is planned (FEAT-0014 concurrent chunked reads → FEAT-0015 paging on Claims and Browse → FEAT-0016 windowed-figure honesty); the architect is decomposing it now. INTENTIONALLY ABSENT from the current build: paging past row 50 on Claims and Browse (M3, FEAT-0015 — the window line now says "the rest are not shown" instead of promising a remedy); search (a vision addition, needs `/ship revise`); the live §7 proof of the verdict slice (waits on the two verdict migrations below).
- **Strategist verdict: M2 shipped clean but the vision is NOT yet satisfied.** VISION's satisfaction sentence needs "both handoffs complete and reviewed"; both are authored, neither is reviewed or installed by you. Your overruling of "there is no M3" (paging) is recorded as vision-traced, not new scope.
- **You ruled BUG-0138 → Answer A + A2 and installed `observed_at` on staging.** `/claims` warm went 2.9–3.8 s → ~2.4 s. Only a quarter better: the tab gauge's sequential chunked read is now the whole cost and is FEAT-0014, first in M3 (target ≤1.4 s).
- **The applied migration is UNTRACKED in the scraper repo:** `kspace Scraper/supabase/migrations/20260910000001_a_pending_claim_carries_its_instant.sql`. The schema-owning repo has no git record of what staging now runs. Commit it.
- **Two scraper handoffs still uninstalled on staging:** `for-human/M2-handoff-verdicts.md` and `for-human/M2-handoff-settle-review-item.md` (2026-09-08). They gate the live proof of the verdict slice. Forward-only: apply each once (do not CLI-push after an SQL-editor apply).
- **Designer re-look of `/claims` after A2 filed four P2 bugs, all fixed today** (BUG-0160 unnamed domain narrowing, BUG-0161 no exit from a dead-end domain, BUG-0162 "reach the rest" promise, BUG-0163 gauge window line): removing the domain chip row while `?domain=` stayed a real narrowing made the narrowing invisible. Lesson recorded: a facet without a control needs its own vocabulary.
- **Blank-source-name chain closed as a class:** BUG-0158/0159 done; the last two sites are one patch TASK-0060 instead of a sixth per-site bug (strategist ruling).
- **Power outage 2026-09-10 ~05:22Z killed the session.** Recovery cost ~15 min, no lost work. Findings: no watchdog LaunchAgent exists for THIS repo (the three installed watch other projects); a ticket left in `qa` by a dead lane is never re-offered by dispatch (BUG-0158, respawned by hand). Suggestions given in chat; the machinery gap goes to the curator at run end.
- Eight archived tickets carry `milestone: null`; `set-milestone` refuses archived tickets, so they are tabled in the M2 retro (M2 closed 101, patch lane 27) rather than edited.
- **Ben's items (not blocking the run):** delete stale `for-human/TASK-0031.md`; `.env.example` still modified locally; the judgment file's three data items (Ziggo Dome triple venue rows, resolver no-decision for 108 unlinkable performers, two scraper-side unblocks) — see `for-human/M2-usersim-judgment.md`.

### Still waiting (unchanged)
- `.env.example` modified in the working tree — yours; say if it should land on the run branch (since 2026-09-04).

## Verify it yourself
- [ ] open `http://localhost:8771/claims` — loads in ~2.4 s warm; bucket table has 3 columns (bucket, claims, oldest); source chips list every registered source with real zeros; no domain chip row (BUG-0138)
- [ ] `http://localhost:8771/claims?domain=events` — window line reads "849 claims in the events domain in all; the 50 longest-waiting are below — the rest are not shown."; a "narrowing · clear filters" row sits in the filter bar (BUG-0160, BUG-0161, BUG-0162)
- [ ] `http://localhost:8771/claims?domain=zzz` — five zero buckets, card "No claims in the zzz domain" naming the clear-filters chip; that chip's href is `/claims` (BUG-0161)
- [ ] same URL, gauge section — its window line says "Claims observed in the zzz domain since …" and its card blames the domain, not the database (BUG-0163)
- [ ] `grep -rnE '^export (async )?function readPendingClaims' src` — exactly one hit, in `src/lib/gauges/pending-claims.ts` (DEBT-0015)
- [ ] staging: `pending_claims` returns `observed_at`, count still 877 (BUG-0138 handoff)
- [ ] `git tag -l m2` and `python3 agenticflow/scripts/ci_check.py` → green (M2 close)

## Everything else
- attention UI: http://127.0.0.1:8770/ (walk instance for Ben: http://localhost:8771, Google login)
- rail telemetry: 1 session death (power outage) → 1 stale claim released at session start, 1 `qa`-state ticket respawned by hand; 0 breaker trips; 0 compactions; blocked: BUG-0138 unblocked after 28 h on Ben's A/B; budget: 2 of `max_milestones` shipped, M3 planned
- spawn economy since the last digest (spawn_log out-tokens): builder 130 returns / 127,252; qa-adversary 122 / 101,757; architect 12 / 8,974; designer 6 / 5,274; strategist 3 / 1,539; verifier 1 / 1,452; user-sim 2 / 1,078. Whole-run by role is in the M2 retro (builder + QA = 91% of cost at ~1:1).
- counts today: closed 11 BUG + 3 DEBT; opened 4 BUG (designer re-look) + 1 BUG (QA) + 3 FEAT + 2 TASK + 1 BUG + 1 DEBT (strategist, M3 + patch); bounces 0; M2 whole: 128 closed, 86% first-attempt, 16 QA reopens, 0 `no_change` closures
- evidence: `/claims` 2.36 / 2.46 / 2.57 s warm post-install (QA, BUG-0138 receipt; re-measure with `agenticflow/tracker/evidence/BUG-0138/read-depth.mjs`); staging `pending_claims` 877 rows, `domain=events` 849, `awaiting_link` 108, `awaiting_row` 769 (BUG-0160/0163 receipts); factory incidents of the day in this session's scratch notes, to be folded into the run-end digest
