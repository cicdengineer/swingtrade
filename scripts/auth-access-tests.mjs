// Run against the production build with: node scripts/auth-access-tests.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { encode } = require("next-auth/jwt");
const origin = "http://127.0.0.1:32971";
const secret = randomBytes(32).toString("hex");
const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "32971"], {
  env: { ...process.env, NEXTAUTH_SECRET: secret, NEXTAUTH_URL: origin, GOOGLE_CLIENT_ID: "test-client",
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
  server.kill();
}
