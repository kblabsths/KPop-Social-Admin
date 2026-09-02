#!/usr/bin/env python3
"""Delete bulk working files from an evidence directory — the ONLY
sanctioned deleter for evidence cleanup.

The defs order "delete bulk working files before handoff", but with no
tool every agent improvised raw `rm` with globs and `cd` prefixes — a
shape the permission system rightly asks the human about, every time
(2026-08-11: the human approved a routine .raw/log cleanup by hand and
asked why). This is the allowlisted, provably-bounded form: it deletes
ONLY files inside agenticflow/tracker/evidence/<TICKET-or-MX>/, refuses
absolute or `..` patterns, never removes a directory, deletes a symlink
as a link (never what it points at), and prints what it did and what
remains.

Usage:
  evidence_clean.py TICKET-or-MX PATTERN [PATTERN ...]
  evidence_clean.py BUG-0107 '*.raw' 'emu.log' 'qa/*.png'
  evidence_clean.py M4 'verifier/*.webm'
Exit codes: 0 = done (a pattern matching nothing is fine), 2 = refusal.
"""
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib

OWNER_RE = re.compile(r"^(?:(?:FEAT|TASK|BUG|DEBT|DEP)-\d{4}|M\d+)$")


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: evidence_clean.py TICKET-or-MX PATTERN [PATTERN ...]")
    owner, patterns = sys.argv[1], sys.argv[2:]
    if not OWNER_RE.match(owner):
        sys.exit("ERROR: %r is not a ticket ID or milestone name" % owner)
    root = os.path.realpath(os.path.join(lib.ROOT, "tracker", "evidence",
                                         owner))
    if not os.path.isdir(root):
        print("nothing to clean: %s does not exist" % root)
        return
    for pat in patterns:
        if os.path.isabs(pat) or ".." in pat.split("/"):
            sys.exit("ERROR: pattern %r — absolute paths and .. are refused; "
                     "patterns are relative to the evidence dir" % pat)
    freed, deleted = 0, []
    for pat in patterns:
        for m in sorted(glob.glob(os.path.join(root, pat))):
            np = os.path.normpath(m)
            if not np.startswith(root + os.sep):
                continue  # a hostile glob cannot leave the evidence dir
            if os.path.islink(np):
                deleted.append(np)  # the link goes; its target is untouched
                os.remove(np)
            elif os.path.isfile(np):
                try:
                    freed += os.path.getsize(np)
                except OSError:
                    pass
                deleted.append(np)
                os.remove(np)
            # directories are never removed — name files, not trees
    print("deleted %d file(s), freed %.1f MB" % (len(deleted),
                                                 freed / 1e6))
    for d in deleted:
        print("  - %s" % os.path.relpath(d, root))
    kept = []
    for dirpath, _dirs, names in os.walk(root):
        for n in sorted(names):
            kept.append(os.path.relpath(os.path.join(dirpath, n), root))
    print("remaining: %s" % (", ".join(kept) if kept else "(empty)"))


if __name__ == "__main__":
    main()
