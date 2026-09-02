#!/usr/bin/env python3
"""Read the account's Claude usage limits the way the CLI's /usage does.

Two HTTP 429 outages on 2026-08-28 killed 13 lanes mid-work (~1M dead
tokens plus rebuilds): a 429 is account-wide and simultaneous, so only
pacing BEFORE it helps. dispatch.py calls this every tick and offers no new
lanes while the 5-hour window is at/above run.yaml `usage_ceiling_5h`.

The OAuth access token is read from the macOS keychain entry the CLI keeps
and is NEVER printed — output is one JSON object. Exit 0 with numbers; exit
2 when no reading is available (the JSON says `unknown: true`, and the
caller decides — a throttle is a cost optimisation, not a safety gate, so
an unreadable keychain must not idle a run).

Usage: usage.py [--ceiling PERCENT]
"""
import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://api.anthropic.com/api/oauth/usage"
KEYCHAIN_SERVICE = "Claude Code-credentials"


def _token():
    try:
        raw = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, timeout=10).stdout.strip()
        return (json.loads(raw).get("claudeAiOauth") or {}).get("accessToken")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def _read(token):
    req = urllib.request.Request(ENDPOINT, headers={
        "Authorization": "Bearer " + token,
        "anthropic-beta": "oauth-2025-04-20",
        "Accept": "application/json", "User-Agent": "agenticflow-usage"})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def _window(body, key):
    raw = body.get(key)
    if not isinstance(raw, dict):
        return {"percent": None, "resets_at": None}
    return {"percent": raw.get("utilization"), "resets_at": raw.get("resets_at")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ceiling", type=float, default=80.0)
    args = ap.parse_args()
    token = _token()
    if not token:
        print(json.dumps({"unknown": True, "throttle": False,
                          "reason": "no credential readable from the keychain"}))
        return 2
    try:
        body = _read(token)
    except (urllib.error.URLError, OSError, ValueError) as error:
        print(json.dumps({"unknown": True, "throttle": False,
                          "reason": "usage endpoint unavailable: %s"
                                    % type(error).__name__}))
        return 2
    five, week = _window(body, "five_hour"), _window(body, "seven_day")
    percent = five["percent"]
    if not isinstance(percent, (int, float)):
        print(json.dumps({"unknown": True, "throttle": False,
                          "reason": "endpoint answered without a five_hour "
                                    "utilization"}))
        return 2
    throttle = percent >= args.ceiling
    reason = ("five_hour %.0f%% >= ceiling %.0f%%" % (percent, args.ceiling)
              if throttle else "five_hour %.0f%%" % percent)
    print(json.dumps({"five_hour": five, "seven_day": week,
                      "throttle": throttle, "reason": reason}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
