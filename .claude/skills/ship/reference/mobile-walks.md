# Mobile walk targets (emulator etiquette)

Read this ONLY when STACK.md names a mobile target (native, Expo, emulator
walks). Web-only apps: none of this applies — close the file.

## Emulator hygiene

- **Lease before boot.** One emulator runs on this machine across ALL
  factories (two took it down, 2026-08-11): `python3
  agenticflow/scripts/emu_lease.py acquire --role <you> --ticket <ID>`,
  boot, `register --serial <s> --pid <pid>`, and when done kill your
  emulator and `release`. Unleased boots are hook-refused; an expired
  lease (default 30 min) makes your emulator fair game for the next agent.
  Acquire LAST (prep everything device-free first — held minutes are walk
  minutes); denied → `acquire --wait` blocks until your turn, and waiting
  is the normal move, not a failure.
- Need your own device? Clone the base AVD under a name ending `_walk` —
  never boot the base itself (lock contention with other agents). Clone
  WITHOUT saved state: `rsync -a --exclude snapshots/ --exclude '*.lock'`
  is the shape; copying 9GB of snapshots just to delete them is not.
- **Your clone is litter: delete it (the `.avd` dir AND its `.ini`) before
  you report.** A walk that leaves its AVD behind costs the human gigabytes
  per ticket (2026-07-29: seven orphaned clones, ~25GB). The base AVD is
  never yours to delete.
- Sandbox app instances bind an ALTERNATE port, never the production port,
  and the report says which (the 9-hour port-squat lesson).

(v0.4-I will grow this file: adb walk cookbook — screencap / input /
uiautomator mapped onto the walk phases — and an emulator-ensure script.)
