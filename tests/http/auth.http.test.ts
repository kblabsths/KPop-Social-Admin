import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { HTTP_TEST_PORT } from "../suite-globs";
import {
  assertChildOwnsPort,
  base,
  host,
  startServer,
  stopServer,
} from "./server-harness";

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

  /**
   * Lock 1 (the pre-flight bind) refuses before we ever spawn, which means it
   * masks lock 3 on every ordinary run. This exercises lock 3 on its own: a
   * live child that is demonstrably NOT the process holding the port must be
   * rejected. Keeps the OS-ownership path from rotting into dead code.
   */
  it("refuses a listener that is outside the process tree of the child it spawned", async () => {
    const foreign = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) =>
      foreign.listen(HTTP_TEST_PORT, host, () => resolve()),
    );
    // Alive, ours, and binds nothing — a stand-in for a `next start` that
    // survived losing the port.
    const decoy: ChildProcess = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { detached: true, stdio: "ignore" },
    );

    try {
      expect(() => assertChildOwnsPort(decoy, [])).toThrowError(
        /refusing to certify a server it did not start/,
      );
    } finally {
      if (decoy.pid !== undefined) {
        try {
          process.kill(-decoy.pid, "SIGKILL");
        } catch {
          decoy.kill("SIGKILL");
        }
      }
      foreign.closeAllConnections();
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });
});
