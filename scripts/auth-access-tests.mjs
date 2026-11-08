// Run against the production build with: node scripts/auth-access-tests.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";

const sandbox = await mkdtemp(path.join(tmpdir(), "jobpothe-auth-"));
await mkdir(path.join(sandbox, ".data"));
const stamp = new Date().toISOString();
await writeFile(path.join(sandbox, ".data", "users.json"), JSON.stringify([
  { id: "viewer", email: "viewer@example.test", name: "Viewer", firstLogin: stamp, lastLogin: stamp, fullAccess: false },
]));
const require = createRequire(import.meta.url);
const { encode } = require("next-auth/jwt");
const origin = "http://127.0.0.1:32971";
const secret = randomBytes(32).toString("hex");
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", process.cwd(), "-H", "127.0.0.1", "-p", "32971"], {
  cwd: sandbox,
  env: { ...process.env, DATABASE_URL: "", NEXTAUTH_SECRET: secret, NEXTAUTH_URL: origin, GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret", DHAN_ACCESS_TOKEN: "", DHAN_CLIENT_ID: "", DATA_REFRESH_SECRET: "" },
  stdio: "inherit",
});

async function cookie(isAdmin) {
  const jwt = await encode({ secret, token: { sub: isAdmin ? "owner" : "viewer", isAdmin } });
  return `next-auth.session-token=${jwt}`;
}
function request(path, method = "GET", cookie = "", body) {
  return fetch(origin + path, { method, body, headers: { cookie, "content-type": "application/json" } });
}

try {
  const viewer = await cookie(false);
  const owner = await cookie(true);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("Test server exited before startup");
    if (await request("/api/auth/providers").then(r => r.ok).catch(() => false)) break;
    await delay(200);
  }
  assert.deepEqual(Object.keys(await (await request("/api/auth/providers")).json()), ["google"]);
  assert.equal((await request("/api/portfolio")).status, 401);
  assert.equal((await request("/api/health", "GET", "jobpothe-auth=active")).status, 401);
  assert.equal((await (await request("/api/portfolio", "GET", viewer)).json()).error, "Dhan credentials are not configured.");
  const adminUsers = "/api/admin/users";
  const refresh = "/api/portfolio?refresh=1";
  const change = allow => JSON.stringify({ id: "viewer", fullAccess: allow });
  const sessionAccess = async () => (await (await request("/api/auth/session", "GET", viewer)).json()).fullAccess;
  assert.equal((await request(adminUsers)).status, 401);
  assert.equal((await request(adminUsers, "GET", viewer)).status, 403);
  assert.equal((await request(adminUsers, "PATCH", viewer, change(true))).status, 403);
  assert.equal((await (await request(adminUsers, "GET", owner)).json()).users[0].email, "viewer@example.test");
  assert.equal(await sessionAccess(), false);
  assert.equal((await request(refresh, "GET", viewer)).status, 403);
  assert.equal((await request(adminUsers, "PATCH", owner, change(true))).status, 200);
  assert.equal(await sessionAccess(), true);
  assert.equal((await (await request(refresh, "GET", viewer)).json()).error, "Dhan credentials are not configured.");
  assert.equal((await request(adminUsers, "GET", viewer)).status, 403);
  assert.equal((await request("/api/portfolio", "PUT", viewer, "{}")).status, 403);
  assert.equal((await request(adminUsers, "PATCH", owner, change(false))).status, 200);
  assert.equal(await sessionAccess(), false);
  assert.equal((await request(refresh, "GET", viewer)).status, 403);
  assert.equal((await request("/api/screener/preview")).status, 401);
  const preview = await request("/api/screener/preview", "GET", viewer);
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.ok(previewBody.data.results.length <= 1);
  assert.equal(Object.keys(previewBody.membership).length, previewBody.data.results.length);
  assert.equal((await request("/api/health", "GET", viewer)).status, 200);
  for (const [path, method] of [
    ["/api/portfolio", "PUT"], ["/api/trade-management/settings", "PUT"],
    ["/api/trade-management/trades", "POST"], ["/api/trade-management/trades/test", "PATCH"],
    ["/api/trade-management/trades/test", "DELETE"], ["/api/trade-management/trades/test/events", "POST"],
    ["/api/data/refresh-universe", "POST"], ["/api/data/failures", "POST"],
    ["/api/seasonality/rebuild", "POST"], ["/api/seasonal-stocks/rebuild", "POST"],
  ]) assert.equal((await request(path, method, viewer)).status, 403, path);
  assert.equal((await request("/api/analysis", "POST", viewer, '{"refresh":true}')).status, 403);
  assert.equal((await request("/api/cron/daily-refresh", "GET", owner)).status, 401);
  // Invalid JSON reaches the owner's write handler without changing any data.
  assert.equal((await request("/api/portfolio", "PUT", owner, "{")).status, 400);
  console.log("Google provider and anonymous, viewer, owner, and cron access checks passed.");
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const closed = once(server, "exit");
    server.kill();
    await closed;
  }
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5 });
}
