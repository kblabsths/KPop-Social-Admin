# Ben, 2026-09-16: rulings on the user-sim judgments 2, 6 and 8

Filed by the dispatcher from Ben's words in session ("2 lets just do a number 6 sure lets keep the summary line 8 lets live with it"), answering `for-human/M3-usersim-judgment.md`. Not for the current (closed) run: route at the next intake / patch run.

## 2 — staleness gets a number (Ben: "lets just do a number")
The app may state staleness against a threshold. The number itself is Ben's and NOT yet given; the dispatcher proposed one for him to confirm or replace: the resolver is designed to run every 15 minutes (`kspace Scraper/contracts/resolver.md`), so "no cycle finished in the last 1 hour" (four missed runs) reads as stale, stated in words on the dashboard and the cycle panel ("last cycle N ago — older than the 1-hour bar"), never a colour alone. Whatever the number, it lives in ONE place (a named constant with the ruling cited) and every surface reads it. Feature-level → FEAT/TASK at the next campaign or an external ticket; DECISIONS gets the number when Ben confirms it.

## 6 — narrowed /sources keeps the summary line (Ben: "sure lets keep the summary line")
When /sources is narrowed to one source, the summary line ("<source> | N claims | N days with a claim") stays above the day table instead of being replaced by it. Small, one surface → patch ticket or external ticket.

## 8 — the two data facts stay (Ben: "lets live with it")
The test-harness NOTE paragraph on /sources and the two 2027-dated resolver fixtures on /browse stay as they are on staging. No ticket; record as accepted.

**Update, 2026-09-16 (Ben): the number is CONFIRMED as proposed** — stale = no cycle finished in the last 1 hour (four missed 15-minute runs), stated in words, one named constant. Ben: "let's go with your proposal and if I need to change it later i will."
