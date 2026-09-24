import { spawn } from "node:child_process";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:8087";
let server;
async function healthy() {
  try {
    return (await fetch(base + "/health")).ok;
  } catch {
    return false;
  }
}
try {
  if (!(await healthy())) {
    server = spawn("./scripts/go.sh", ["run", "./cmd/server"], {
      stdio: "inherit",
      env: { ...process.env, ADDR: new URL(base).host },
      detached: true,
    });
    const deadline = Date.now() + 30000;
    while (!(await healthy())) {
      if (Date.now() > deadline)
        throw Error("Backend startup timed out. Start npm run db first.");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const runner = spawn(
    "node_modules/.bin/tsx",
    ["--test", "tests/integration/client.test.ts"],
    { stdio: "inherit", env: process.env },
  );
  const code = await new Promise((resolve) => runner.on("exit", resolve));
  process.exitCode = code ?? 1;
} finally {
  if (server?.pid)
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
}
