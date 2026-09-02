/**
 * Harness for the http project: start the built app, assert against THAT
 * server, stop it.
 *
 * Extracted from the suite (admin-window/BUG-0002) so the guards below are
 * importable and directly testable rather than private to one test file —
 * admin-window/TASK-0005 extends the suite to every route on top of this.
 *
 * Three independent locks stand between this harness and the failure it was
 * written for (certifying a server it did not start):
 *   1. `portIsFree()` pre-flight — refuses before spawning if anything holds
 *      the port. Deterministic; the realistic lane-collision case.
 *   2. child-exit detection in `waitForReady()` — covers the race window,
 *      because a `next start` that loses the bind exits (measured below).
 *   3. `assertChildOwnsPort()` — the OS says which pid holds the socket.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { HTTP_TEST_PORT } from "../suite-globs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const nextBin = path.join(repoRoot, "node_modules", ".bin", "next");
export const host = "127.0.0.1";
export const base = `http://${host}:${HTTP_TEST_PORT}`;

/**
 * Environment for the app under test.
 *
 * Every Supabase name is stripped: these routes must answer without a
 * database, and dropping the names is what proves it rather than asserts it.
 * AUTH_SECRET is a throwaway literal for signing nothing — the suite never
 * signs in, and no real credential is ever read here.
 */
export function serverEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.includes("SUPABASE")) delete env[key];
  }
  env.AUTH_SECRET = "http-suite-placeholder-not-a-credential";
  env.AUTH_URL = base;
  env.AUTH_TRUST_HOST = "true";
  env.PORT = String(HTTP_TEST_PORT);
  return env;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Can this process bind HTTP_TEST_PORT right now?
 *
 * Binding is the only honest question to ask before spawning. A GET that
 * answers 200 proves *someone* is listening, never that it is our server —
 * and when the stranger is an orphaned `next start` of this same app, no
 * amount of response inspection can tell the two apart (admin-window/BUG-0002).
 */
export function portIsFree(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(HTTP_TEST_PORT, host, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Wait for the port our child held to come back — but only while it is ours
 * to wait for.
 *
 * Measured 2026-09-02: with the pre-flight check disabled, a refusal against
 * a foreign listener took 15,164ms instead of 1ms, all of it this wait
 * spinning on a port a stranger holds and will never release. Bailing as soon
 * as the holder is outside our process tree keeps the error path fast.
 */
async function waitForOurPortRelease(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const ours = child.pid === undefined ? new Set<number>() : processTree(child.pid);
  for (;;) {
    if (await portIsFree()) return;
    const holders = listeningPids();
    if (holders !== undefined && holders.some((pid) => !ours.has(pid))) return;
    if (Date.now() >= deadline) return;
    await sleep(100);
  }
}

/**
 * Pids the OS says hold a LISTEN socket on HTTP_TEST_PORT.
 *
 * `undefined` means the question could not be asked (no `lsof` on this
 * machine) — distinct from `[]`, which means it was asked and nobody is
 * listening.
 */
export function listeningPids(): number[] | undefined {
  try {
    const stdout = execFileSync(
      "lsof",
      ["-nP", `-iTCP@${host}:${HTTP_TEST_PORT}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return stdout
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number };
    // lsof exits non-zero with no output when nothing matches: an answer.
    if (err.code !== "ENOENT" && typeof err.status === "number") return [];
    return undefined;
  }
}

/** `root` plus every process descended from it, as `ps` sees them. */
export function processTree(root: number): Set<number> {
  const tree = new Set<number>([root]);
  let pairs: Array<[number, number]>;
  try {
    pairs = execFileSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length === 2)
      .map((parts) => [Number(parts[0]), Number(parts[1])] as [number, number])
      .filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid));
  } catch {
    return tree;
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of pairs) {
      if (!tree.has(pid) && tree.has(ppid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  return tree;
}

/**
 * Second lock: the process answering must be the one we spawned.
 *
 * Measured 2026-09-02 on Next 16.2.2: `next start` binds in the spawned pid
 * itself, and a second `next start` on a held port exits 1 with EADDRINUSE.
 * So the pre-flight bind plus the child-exit check in `waitForReady` already
 * close the race window on their own; this check makes the guarantee stop
 * depending on that measured Next behaviour surviving an upgrade.
 */
export function assertChildOwnsPort(child: ChildProcess, log: string[]): void {
  const holders = listeningPids();
  if (holders === undefined) return; // no lsof: pre-flight + liveness stand alone
  if (child.pid === undefined) {
    throw new Error("the spawned server has no pid; refusing to certify it");
  }
  const ours = processTree(child.pid);
  if (!holders.some((pid) => ours.has(pid))) {
    throw new Error(
      `port ${HTTP_TEST_PORT} is held by pid(s) ${holders.join(", ") || "(none)"}, ` +
        `none of them the server this suite started (pid ${child.pid}); ` +
        `refusing to certify a server it did not start\n${log.join("")}`,
    );
  }
}

export async function waitForReady(child: ChildProcess, log: string[]): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `next start exited before becoming ready (code=${child.exitCode}, signal=${child.signalCode})\n${log.join("")}`,
      );
    }
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server never became ready on ${base}\n${log.join("")}`);
}

export async function startServer(): Promise<{ child: ChildProcess; log: string[] }> {
  if (!(await portIsFree())) {
    throw new Error(
      `port ${HTTP_TEST_PORT} is already held by another process, so this suite ` +
        `would be asserting against a server it did not start. Stop whatever is ` +
        `listening on ${base} — another lane's \`npm run test:http\`, or an orphaned ` +
        `\`next start\` — and re-run.`,
    );
  }
  const log: string[] = [];
  const child = spawn(nextBin, ["start", "--hostname", host, "--port", String(HTTP_TEST_PORT)], {
    cwd: repoRoot,
    env: serverEnv(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => log.push(chunk.toString()));
  try {
    await waitForReady(child, log);
    assertChildOwnsPort(child, log);
  } catch (error) {
    await stopServer(child);
    throw error;
  }
  return { child, log };
}

export async function stopServer(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  // Detached spawn puts `next start` and its workers in their own process
  // group; the negative pid takes the whole group down with it.
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const timer = setTimeout(() => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }, 10_000);
  await exited;
  clearTimeout(timer);
  // Do not hand the port back to the next test until the OS has released it,
  // or back-to-back starts collide with the previous test's own server.
  await waitForOurPortRelease(child, 15_000);
}
