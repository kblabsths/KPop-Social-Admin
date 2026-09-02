#!/usr/bin/env python3
"""Browser gate (PreToolUse on Bash): agents never launch the human's real
browser headless.

macOS treats Chrome as single-instance: an agent's headless `Google Chrome
--dump-dom` probe occupies that instance, so clicking Chrome in the Dock
"activates" a windowless process and nothing appears — the human loses their
browser while the probe lives (observed 2026-07-17, a QA render loop).
The vetted path renders identically without the hijack: playwright's
BUNDLED Chromium from agenticflow/.venv-tools (DEP-0006). This was
def-prose in designer.md only; the first non-designer role that needed a
page render reached for the real browser — so now it is mechanism.
"""
import json
import re
import sys

REAL_BROWSER_HEADLESS = re.compile(
    r"(Google.?Chrome|Chrome\.app|Microsoft.?Edge|Brave.?Browser)[^\n|;&]*--headless"
    r"|--headless[^\n|;&]*(Google.?Chrome|Chrome\.app|Microsoft.?Edge|Brave.?Browser)",
    re.I)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    cmd = str((payload.get("tool_input") or {}).get("command") or "")
    if REAL_BROWSER_HEADLESS.search(cmd):
        sys.stderr.write(
            "BROWSER GATE: headless launches of the human's real browser are "
            "blocked — the OS treats it as single-instance, so your probe "
            "silently takes their browser away from them. Render with the "
            "vetted bundled Chromium instead:\n"
            "  agenticflow/.venv-tools/bin/python -c 'from playwright.sync_api "
            "import sync_playwright; ...' (p.chromium.launch(); see "
            "designer.md for the pattern).\n")
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
