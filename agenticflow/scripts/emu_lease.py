#!/usr/bin/env python3
"""Machine-wide emulator lease — one emulator across ALL factories.

2026-08-11: two factories each ran an emulator and the machine ran out of
memory mid-run. Factories are independent by design, but they share this
machine's RAM, so the running-emulator count is MACHINE state: leases live
in ~/.agenticflow/ (override: AGENTICFLOW_HOME), never in a repo.

Rules:
- `slots` (default 1) emulators may run at once, machine-wide.
- A lease EXPIRES ttl_minutes (default 30) after acquire. An expired
  lease's emulator is fair game: the next acquirer kills the recorded pid
  and takes the slot — camping is not a strategy. Plan walks to fit,
  batch measurements, release early.
- The launch hook (artifact_gate) refuses emulator boots by a project
  holding no live lease. Physical devices are not governed here — only
  emulator processes cost RAM.

Machine config (optional): ~/.agenticflow/emulator.conf, flat `key: value`
lines — `slots`, `ttl_minutes`. Per-machine deliberately: a bigger machine
raises slots for every factory at once.

Usage:
  emu_lease.py acquire --role qa --ticket BUG-0001 [--ttl MIN]
                       [--wait [--timeout-minutes MIN]]
  emu_lease.py register --serial emulator-5554 --pid 12345
  emu_lease.py release [--kill]
  emu_lease.py status
Exit codes: 0 = granted/ok, 1 = denied (holder printed), 2 = usage error.

Acquire LAST: everything that needs no device (building the APK, scripting
the walk, planning measurements) happens BEFORE the lease, so held minutes
are walk minutes. Denied means someone's turn is ahead of yours — `--wait`
is the normal move, not a failure.
"""
import argparse
import json
import os
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_ticket as lib


def home():
    path = os.path.expanduser(
        os.environ.get("AGENTICFLOW_HOME", "~/.agenticflow"))
    os.makedirs(path, exist_ok=True)
    return path


def conf():
    cfg = {"slots": 1, "ttl_minutes": 30}
    path = os.path.join(home(), "emulator.conf")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.split("#")[0].strip()
            if ":" in line:
                key, _, raw = line.partition(":")
                if key.strip() in cfg:
                    try:
                        cfg[key.strip()] = int(raw.strip())
                    except ValueError:
                        pass
    return cfg


def slot_paths():
    return [os.path.join(home(), "emulator.lease.%d" % i)
            for i in range(conf()["slots"])]


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def expired(lease):
    ttl = float(lease.get("ttl_minutes") or conf()["ttl_minutes"])
    return time.time() - float(lease.get("acquired_epoch") or 0) > ttl * 60


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, TypeError, ValueError):
        return False


def describe(lease):
    age = (time.time() - float(lease.get("acquired_epoch") or 0)) / 60
    return "%s (%s %s) held %.0f min of %s" % (
        lease.get("project"), lease.get("role"), lease.get("ticket"),
        age, lease.get("ttl_minutes"))


def my_slot():
    for path in slot_paths():
        lease = load(path)
        if lease and os.path.abspath(lease.get("project") or "") \
                == os.path.abspath(lib.PRODUCT):
            return path, lease
    return None, None


def _try_acquire(a):
    """One acquisition attempt. True = granted (or already held)."""
    path, lease = my_slot()
    if lease and not expired(lease):
        print("already held: %s" % describe(lease))
        return True
    body = {"project": os.path.abspath(lib.PRODUCT), "role": a.role,
            "ticket": a.ticket, "acquired_epoch": time.time(),
            "acquired_at": lib.now_iso(),
            "ttl_minutes": a.ttl or conf()["ttl_minutes"]}
    for path in slot_paths():
        cur = load(path)
        if cur is not None and not expired(cur):
            continue
        if cur is not None:
            # expired: the recorded emulator is fair game — kill ONLY the
            # pid the lease itself recorded, never anything discovered
            pid = cur.get("emulator_pid")
            if pid and alive(pid):
                try:
                    os.kill(int(pid), signal.SIGTERM)
                    sys.stderr.write("stole expired lease: killed emulator "
                                     "pid %s of %s\n" % (pid, describe(cur)))
                except OSError:
                    pass
            try:
                os.unlink(path)
            except OSError:
                pass
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            continue  # raced another factory — try the next slot
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(body, f, indent=1)
        print("lease granted: slot %s, ttl %s min — boot, then `register "
              "--serial <s> --pid <pid>`; kill your emulator and `release` "
              "when done" % (os.path.basename(path), body["ttl_minutes"]))
        return True
    return False


def cmd_acquire(a):
    """--wait blocks (in this one call) until a slot frees: waiting your
    turn is the normal move — the wait is bounded by the holder's TTL, and
    an expired lease is stolen by the next attempt automatically."""
    deadline = time.time() + a.timeout_minutes * 60
    told = False
    while True:
        if _try_acquire(a):
            return
        if not a.wait or time.time() >= deadline:
            holders = "; ".join(describe(l)
                                for l in map(load, slot_paths()) if l)
            sys.stderr.write(
                "DENIED: every emulator slot is leased — %s.\nThis machine "
                "runs %d emulator(s) across ALL factories (it ran out of "
                "RAM with two, 2026-08-11). `acquire --wait` blocks until "
                "your turn — the wait is bounded by the holder's TTL.\n"
                % (holders or "?", conf()["slots"]))
            sys.exit(1)
        if not told:
            holders = "; ".join(describe(l)
                                for l in map(load, slot_paths()) if l)
            sys.stderr.write("waiting for a slot (%s)...\n" % holders)
            told = True
        time.sleep(5)


def cmd_register(a):
    path, lease = my_slot()
    if not lease:
        sys.exit("ERROR: no lease held by this project — acquire first")
    lease["serial"], lease["emulator_pid"] = a.serial, a.pid
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(lease, f, indent=1)
    os.replace(tmp, path)
    print("registered %s (pid %s) on %s" % (a.serial, a.pid,
                                            os.path.basename(path)))


def cmd_release(a):
    path, lease = my_slot()
    if not lease:
        print("no lease held by this project — nothing to release")
        return
    pid = lease.get("emulator_pid")
    if a.kill and pid and alive(pid):
        try:
            os.kill(int(pid), signal.SIGTERM)
        except OSError:
            pass
    elif pid and alive(pid):
        sys.stderr.write("WARNING: emulator pid %s still running — kill it "
                         "(you own it) or pass --kill\n" % pid)
    os.unlink(path)
    print("released")


def cmd_status(a):
    cfg = conf()
    print("slots: %d, default ttl: %d min" % (cfg["slots"],
                                              cfg["ttl_minutes"]))
    for path in slot_paths():
        lease = load(path)
        if not lease:
            print("%s: free" % os.path.basename(path))
        else:
            print("%s: %s%s" % (os.path.basename(path), describe(lease),
                                " [EXPIRED]" if expired(lease) else ""))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("acquire")
    sp.add_argument("--role", required=True)
    sp.add_argument("--ticket", default="-")
    sp.add_argument("--ttl", type=int, default=None)
    sp.add_argument("--wait", action="store_true",
                    help="block until a slot frees (the normal move when "
                         "denied — bounded by the holder's TTL)")
    sp.add_argument("--timeout-minutes", type=int, default=45,
                    help="give up waiting after this long (default 45: one "
                         "full turn ahead of you plus slack)")
    sp.set_defaults(fn=cmd_acquire)
    sp = sub.add_parser("register")
    sp.add_argument("--serial", required=True)
    sp.add_argument("--pid", type=int, required=True)
    sp.set_defaults(fn=cmd_register)
    sp = sub.add_parser("release")
    sp.add_argument("--kill", action="store_true")
    sp.set_defaults(fn=cmd_release)
    sp = sub.add_parser("status")
    sp.set_defaults(fn=cmd_status)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
