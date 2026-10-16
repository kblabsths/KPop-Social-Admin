# For Ben — the reciprocal guard lives next door, and only you can install it

Architect, 2026-09-12, routing a QA finding from BUG-0213. **Nothing is blocked
on this** and no ticket is filed; it is a gap you may or may not want closed,
and closing it means an edit in `kspace Scraper`, which this campaign may not
make.

## The gap, in one sentence

This repo checks that **we** never allocate a KS code the scraper already
holds. Nothing checks the other direction: if the scraper repo raises one of
**our** codes (KS029–KS032, the four this campaign's handoff allocates) without
adding it to its own registry, both repos stay green and the two meanings drift
apart silently.

## Why we cannot close it from here

The check would have to live in the scraper's own suite — its
`tests/live_safety/test_codes_named_once.py` is exactly the right home, since it
already pins one meaning per code. `kspace Admin` is barred from editing that
repo (AGENTS.md: a change only the sibling can carry is a handoff, never an edit
from here), and a guard written on this side can only ever read the sibling's
text and guess — which is the failure mode that cost this campaign three rounds
already (BUG-0207, BUG-0212, BUG-0213) and one more since (BUG-0220).

## What to install there, if you want it

One line in the sibling's existing test: every `KS0nn` raised anywhere in that
tree must appear in `tests/helpers/ks_codes.py`, **including** codes it did not
allocate. That makes an accidental raise of one of our four fail next door,
where the raise happens, instead of being invisible in both repos.

## What we did do on our side

The guards that read your scraper checkout leave the every-builder suite
entirely (**TASK-0080**): they become an opt-in vitest project the verifier runs
at a close and whoever prepares a handoff runs then. Four times in this campaign
a legitimate event in your other repo — twice this campaign's own handoff
LANDING — turned `npm test` red for every builder here while nothing in this
repo was wrong. The guards that grade our own handoff artifact before you paste
it stay exactly where they are.
