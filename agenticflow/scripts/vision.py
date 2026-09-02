#!/usr/bin/env python3
"""Vision campaigns (v0.3-E): a vision is born for a goal, satisfied, and
closed — a CAMPAIGN, not an immortal product manifesto. Each campaign is a
self-contained folder under agenticflow/visions/<slug>/ holding its docs
(VISION, SPEC, ROADMAP, LOOK_AND_FEEL, PERSONAS) and its whole tracker
(tickets from 0001, archive, milestones, digests, evidence). Repo truth —
STACK, DECISIONS, dep lists, run.yaml — stays global in agenticflow/docs.

The ACTIVE campaign is selected by symlinks: agenticflow/docs/vision and the
vision-scoped tracker subdirs point into the campaign's folder. Scripts and
agents read only the stable paths (agenticflow/tracker/tickets/...,
agenticflow/docs/vision/VISION.md); switching campaigns repoints storage,
never interfaces — which is also what makes ticket ids fresh per campaign
(next_id scans through the links and sees one campaign's tickets).

Returning to old work is a NEW campaign: brownfield intake documents the
app that exists, and the closed campaign's folder is readable history.
Continuity lives in the code, STACK, and DECISIONS — not in resumable
vision state (Ben's ruling, 2026-07-16).

Every campaign runs on its own branch, `run/<slug>` — created and checked
out by `new`, never main: main is human territory, and the only way work
reaches it is `merge` AFTER the human verified the running app. A
vision-satisfied stop leaves the campaign OPEN for exactly that window —
the human walks the app, files patch notes if needed, then says finish;
`merge` is what stamps the campaign CLOSED. On a red post-merge suite or a
merge conflict, main is rolled back to exactly where it was and the
failure is reported — the problem exists only on the run branch.

Usage:
  vision.py new <slug>          create a campaign + its run/<slug> branch, activate both
  vision.py switch <slug>       activate an existing campaign (+ its branch)
  vision.py merge [--into BR]   human-verified finish: merge run/<slug> into
                                main (or BR), full suite on the merged tree,
                                CLOSED on green, full rollback on red/conflict
  vision.py amend --strike "<exact text>" [--note "..."]
                                HUMAN-ONLY: strike scope out of the frozen
                                vision mid-run. Removals cannot cause drift —
                                nothing new gets built — so they get a
                                scalpel; ADDITIONS keep the full /ship revise
                                ceremony. Appends a dated Amendments entry
                                (struck text preserved) and files an inbox
                                note so the strategist reconciles affected
                                tickets through the normal routing machinery.
  vision.py close --note "..."  stamp the active campaign CLOSED without merging
  vision.py list                campaigns with state and ticket counts
  vision.py status              active slug (exit 1 if none)

new/switch/merge refuse while a run is in flight (tracker/RUNNING) —
switching storage under a live dispatcher corrupts the run.
"""
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

VISIONS = os.path.join(lib.ROOT, "visions")
RUNNING = os.path.join(lib.ROOT, "tracker", "RUNNING")
TRACKER_DIRS = ["tickets", "archive", "notes", "receipts", "inbox",
                "digests", "milestones", "evidence"]


def link_map(slug):
    """(link path, relative target) for everything that selects a campaign."""
    pairs = [(os.path.join(lib.ROOT, "docs", "vision"),
              os.path.join("..", "visions", slug, "docs"))]
    for d in TRACKER_DIRS:
        pairs.append((os.path.join(lib.ROOT, "tracker", d),
                      os.path.join("..", "visions", slug, "tracker", d)))
    return pairs


def active_slug():
    link = os.path.join(lib.ROOT, "docs", "vision")
    if os.path.islink(link):
        parts = os.readlink(link).split(os.sep)
        if "visions" in parts:
            return parts[parts.index("visions") + 1]
    return None


def activate(slug):
    for link, target in link_map(slug):
        os.makedirs(os.path.dirname(link), exist_ok=True)
        if os.path.islink(link):
            os.remove(link)
        elif os.path.isdir(link):
            # a real dir sits where the link goes: adopt it only if empty
            # (fresh-install skeleton). Anything else is pre-campaign state —
            # migrating it is a deliberate one-off, never done implicitly.
            if os.listdir(link):
                sys.exit("ERROR: %s is a real, non-empty directory — this "
                         "repo predates vision campaigns. Migrate by hand "
                         "first (move its contents into "
                         "agenticflow/visions/<slug>/), then retry."
                         % os.path.relpath(link, lib.PRODUCT))
            os.rmdir(link)
        os.symlink(target, link)


def require_idle(verb):
    if os.path.exists(RUNNING):
        # `new` with nothing actually in flight IS the /ship intake: Phase 0
        # creates RUNNING before Phase 1 can create the campaign, so this
        # refusal fired at every campaign open and was lifted by hand
        # (2026-08-28). With no active campaign — or a CLOSED one — there is
        # no storage a live dispatcher could lose. switch/merge stay strict.
        if verb == "new":
            slug = active_slug()
            if not slug or os.path.exists(os.path.join(VISIONS, slug,
                                                       "CLOSED")):
                return
        sys.exit("ERROR: a run is in flight (tracker/RUNNING exists) — "
                 "%s would switch storage under a live dispatcher. Stop the "
                 "run first." % verb)


def git(*args):
    return subprocess.run(["git", "-C", lib.PRODUCT] + list(args),
                          capture_output=True, text=True, timeout=300)


def current_branch():
    return git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()


def branch_exists(name):
    return git("rev-parse", "-q", "--verify",
               "refs/heads/" + name).returncode == 0


def cmd_new(slug):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug):
        sys.exit("ERROR: slug must be lowercase letters/digits/hyphens")
    require_idle("new")
    home = os.path.join(VISIONS, slug)
    if os.path.exists(home):
        sys.exit("ERROR: campaign %s already exists (vision.py switch %s?)"
                 % (slug, slug))
    branch = "run/" + slug
    if branch_exists(branch):
        sys.exit("ERROR: branch %s already exists" % branch)
    start = current_branch()
    r = git("checkout", "-b", branch)
    if r.returncode != 0:
        sys.exit("ERROR: could not create %s: %s" % (branch, r.stderr.strip()))
    os.makedirs(os.path.join(home, "docs"))
    for d in TRACKER_DIRS:
        os.makedirs(os.path.join(home, "tracker", d))
    activate(slug)
    warn = ("\nWARNING: branched from %s, another campaign's run branch — "
            "its unmerged work rides along; usually you want to start from "
            "main." % start) if start.startswith("run/") else ""
    print("campaign %s created and active on branch %s (from %s) — the run "
          "happens here, never on main; `vision.py merge` lands it after "
          "the human verifies%s" % (slug, branch, start, warn))


def cmd_switch(slug):
    require_idle("switch")
    if not os.path.isdir(os.path.join(VISIONS, slug)):
        sys.exit("ERROR: no campaign %s (vision.py list)" % slug)
    cur = active_slug()
    if cur and cur != slug:
        vpath = os.path.join(lib.ROOT, "docs", "vision", "VISION.md")
        if os.path.exists(vpath) and not os.path.exists(vpath + ".frozen"):
            sys.exit("ERROR: the active campaign (%s) is mid-revision "
                     "(VISION.md unfrozen) — finish or refreeze before "
                     "switching" % cur)
    branch = "run/" + slug
    note = ""
    if branch_exists(branch):
        r = git("checkout", branch)
        if r.returncode != 0:
            sys.exit("ERROR: cannot check out %s: %s"
                     % (branch, r.stderr.strip()))
    else:
        note = " (no %s branch — campaign predates run branches or was " \
               "merged; staying on %s)" % (branch, current_branch())
    activate(slug)
    print("campaign %s active%s%s"
          % (slug, " (was %s)" % cur if cur else "", note))


def cmd_merge(into):
    require_idle("merge")
    slug = active_slug()
    if not slug:
        sys.exit("ERROR: no active campaign")
    branch = "run/" + slug
    if not branch_exists(branch):
        sys.exit("ERROR: no %s branch to merge" % branch)
    if not into:
        into = next((b for b in ("main", "master") if branch_exists(b)), None)
        if not into:
            sys.exit("ERROR: neither main nor master exists — say --into")
    dirty = [ln for ln in git("status", "--porcelain").stdout.splitlines()
             if ln.strip()]
    if dirty:
        sys.exit("ERROR: working tree not clean (%d path(s)) — commit or "
                 "stash before merging" % len(dirty))
    r = git("checkout", into)
    if r.returncode != 0:
        sys.exit("ERROR: cannot check out %s: %s" % (into, r.stderr.strip()))
    before = git("rev-parse", "HEAD").stdout.strip()

    def bail(why, detail):
        git("merge", "--abort")
        git("reset", "--hard", before)
        git("checkout", branch)
        sys.exit("MERGE FAILED (%s) — %s was rolled back to %s and you are "
                 "back on %s; fix via a patch run there, then merge again.\n%s"
                 % (why, into, before[:8], branch, detail.strip()[-1500:]))

    r = git("merge", "--no-ff", "--no-edit",
            "-m", "ship %s: merge human-verified campaign" % slug, branch)
    if r.returncode != 0:
        bail("merge conflict — another campaign landed first?",
             r.stderr + r.stdout)
    # THE integration check: each run branch was verified alone; the merged
    # tree is the first place their combination exists. Full suite, here.
    cmd = lib.load_run_config()["ci_command"]
    if cmd:
        p = subprocess.run(cmd, shell=True, cwd=lib.PRODUCT,
                           capture_output=True, text=True, timeout=1800)
        if p.returncode != 0:
            bail("full suite RED on the merged tree", p.stdout + p.stderr)
        suite = "suite green on merged tree"
    else:
        suite = "no ci_command configured — merged unverified"
    sha = git("rev-parse", "--short", "HEAD").stdout.strip()
    with open(os.path.join(VISIONS, slug, "CLOSED"), "w", encoding="utf-8") as f:
        f.write("%s merged to %s as %s (%s)\n"
                % (lib.now_iso(), into, sha, suite))
    print("campaign %s merged to %s as %s and CLOSED (%s). You are on %s; "
          "the %s branch remains as history." % (slug, into, sha, suite,
                                                 into, branch))


def cmd_amend(strike, note):
    slug = active_slug()
    if not slug:
        sys.exit("ERROR: no active campaign")
    vpath = os.path.join(lib.ROOT, "docs", "vision", "VISION.md")
    if not os.path.exists(vpath):
        sys.exit("ERROR: no VISION.md in the active campaign")
    text = open(vpath, encoding="utf-8").read()
    if strike not in text:
        sys.exit("ERROR: that exact text does not appear in VISION.md — "
                 "paste it verbatim (whitespace and line breaks included)")
    stamp = lib.now_iso()[:10]
    text = text.replace(
        strike, "~~%s~~ *(struck %s — see Amendments)*" % (strike, stamp), 1)
    if "## Amendments (human)" not in text:
        text = text.rstrip() + (
            "\n\n## Amendments (human)\n\nThe one legal mutation of a frozen "
            "vision: the human striking or\nnarrowing scope mid-run. "
            "Additions still require `/ship revise`.\n")
    text = text.rstrip() + "\n- %s STRUCK: \"%s\"%s\n" % (
        stamp, " ".join(strike.split()), (" — " + note) if note else "")
    with open(vpath, "w", encoding="utf-8") as f:
        f.write(text)
    # reconciliation rides the existing inbox machinery — the strategist
    # routes this like any human note; no new dispatcher states
    inbox = os.path.join(lib.ROOT, "tracker", "inbox")
    os.makedirs(inbox, exist_ok=True)
    fname = "%s-vision-amendment.md" % stamp
    n = 2
    while os.path.exists(os.path.join(inbox, fname)):
        fname = "%s-vision-amendment-%d.md" % (stamp, n)
        n += 1
    with open(os.path.join(inbox, fname), "w", encoding="utf-8") as f:
        f.write("# Vision amendment (human): scope struck\n\n"
                "The human struck this from the frozen VISION (%s):\n\n"
                "> %s\n\n%s"
                "Reconcile the board against the amendment: cut (wont_fix) "
                "or amend tickets whose work exists to serve the struck "
                "scope, citing this amendment. Nothing new is licensed by "
                "a strike — this only removes.\n"
                % (stamp, " ".join(strike.split()),
                   ("Note: %s\n\n" % note) if note else ""))
    print("VISION amended (struck, preserved under Amendments); "
          "reconciliation note filed: tracker/inbox/%s" % fname)


def cmd_close(note):
    slug = active_slug()
    if not slug:
        sys.exit("ERROR: no active campaign")
    marker = os.path.join(VISIONS, slug, "CLOSED")
    with open(marker, "w", encoding="utf-8") as f:
        f.write("%s %s\n" % (lib.now_iso(), note))
    print("campaign %s CLOSED: %s" % (slug, note))


def cmd_list():
    active = active_slug()
    if not os.path.isdir(VISIONS):
        print("(no campaigns)")
        return
    for slug in sorted(os.listdir(VISIONS)):
        home = os.path.join(VISIONS, slug)
        if not os.path.isdir(home):
            continue
        count = lambda d: len([n for n in
                               os.listdir(os.path.join(home, "tracker", d))
                               if n.endswith(".md")]) \
            if os.path.isdir(os.path.join(home, "tracker", d)) else 0
        state = "CLOSED" if os.path.exists(os.path.join(home, "CLOSED")) \
            else ("ACTIVE" if slug == active else "open")
        print("%-8s %s  (%d open ticket(s), %d archived)"
              % (state, slug, count("tickets"), count("archive")))


def cmd_status():
    slug = active_slug()
    if not slug:
        sys.exit("no active campaign")
    closed = os.path.exists(os.path.join(VISIONS, slug, "CLOSED"))
    print("%s%s" % (slug, " (CLOSED)" if closed else ""))


def main():
    args = sys.argv[1:]
    if args[:1] == ["new"] and len(args) == 2:
        cmd_new(args[1])
    elif args[:1] == ["switch"] and len(args) == 2:
        cmd_switch(args[1])
    elif args[:1] == ["merge"]:
        cmd_merge(args[args.index("--into") + 1] if "--into" in args else None)
    elif args[:1] == ["amend"] and "--strike" in args:
        cmd_amend(args[args.index("--strike") + 1],
                  args[args.index("--note") + 1] if "--note" in args else "")
    elif args[:1] == ["close"] and "--note" in args:
        cmd_close(args[args.index("--note") + 1])
    elif args == ["list"]:
        cmd_list()
    elif args == ["status"]:
        cmd_status()
    else:
        sys.exit(__doc__.split("Usage:")[1].strip())


if __name__ == "__main__":
    main()
