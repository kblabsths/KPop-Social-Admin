import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HTTP_TEST_PORT } from "../suite-globs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const nextBin = path.join(repoRoot, "node_modules", ".bin", "next");
const host = "127.0.0.1";
const base = `http://${host}:${HTTP_TEST_PORT}`;

/**
 * Environment for the app under test.
 *
 * Every Supabase name is stripped: these routes must answer without a
 * database, and dropping the names is what proves it rather than asserts it.
 * AUTH_SECRET is a throwaway literal for signing nothing — the suite never
 * signs in, and no real credential is ever read here.
 */
function serverEnv(): NodeJS.ProcessEnv {
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

async function waitForReady(child: ChildProcess, log: string[]): Promise<void> {
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

async function startServer(): Promise<{ child: ChildProcess; log: string[] }> {
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
  } catch (error) {
    await stopServer(child);
    throw error;
  }
  return { child, log };
}

async function stopServer(child: ChildProcess): Promise<void> {
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
}

describe("the built app over http", () => {
  it("serves health and sends an unauthenticated visitor to the login page", async () => {
    const { child } = await startServer();
    try {
      const health = await fetch(`${base}/api/health`);
      expect(health.status).toBe(200);

      const root = await fetch(`${base}/`, { redirect: "manual" });
      expect(root.status).toBeGreaterThanOrEqual(300);
      expect(root.status).toBeLessThan(400);

      const location = root.headers.get("location");
      expect(location).not.toBeNull();
      expect(new URL(location as string, base).pathname).toBe("/login");
    } finally {
      await stopServer(child);
    }
  });
  /**
   * The suite must assert against the app IT started, never against whatever
   * happens to hold the port. Two lanes running `npm run test:http` at once,
   * or an orphaned server from a crashed run, both put a foreign listener on
   * HTTP_TEST_PORT — and a green earned from a stranger is not a green.
   */
  it("refuses to certify a server it did not start when the port is already held", async () => {
    const foreign = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === "/") {
        res.writeHead(307, { location: "/login" });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      foreign.listen(HTTP_TEST_PORT, host, () => resolve()),
    );

    try {
      let started: { child: ChildProcess } | undefined;
      try {
        started = await startServer();
      } catch {
        // Correct behaviour: the harness refused loudly.
        return;
      }
      await stopServer(started.child);
      throw new Error(
        `startServer() reported ready while a foreign listener held port ${HTTP_TEST_PORT}; ` +
          "every assertion in this suite would have been answered by that listener",
      );
    } finally {
      foreign.closeAllConnections();
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });
});
