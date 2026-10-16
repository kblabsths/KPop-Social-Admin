# Ben, 2026-09-15: page windows — YES, with a size reservation

Filed by the dispatcher verbatim from Ben's words in session (answers `for-human/M3-paging-shape-for-ben.md`).

> "Okay for this yes, but I don't think it needs an entire campaign to do"

Ruling: adopt page windows (rows 1–50 / 51–100 …, size adjustable 20/50/100) on /claims and /browse, page + size in the URL, replacing append-on-press. BUG-0221 folds into it.

Reservation: Ben expects this to be smaller than the strategist's 6–10-ticket estimate. Strategist: plan it as the smallest milestone that keeps the verifier walk (paging is where M3's two worst bugs hid — BUG-0216 and BUG-0226 — and only the production-build walk saw the second), and show Ben the ticket list before the first build tick. If it truly fits the patch lane, say so with the trade (no verifier, no user-sim) and let Ben pick.
