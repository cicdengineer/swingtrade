import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/lib/dhan.ts", "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});

const calls = [];
let rateLimited = false;
const trade = (id) => ({ exchangeTradeId: id, orderId: id, exchangeTime: "2026-06-30 10:00:00", securityId: "1", tradingSymbol: "TEST", transactionType: "BUY", tradedQuantity: 1, tradedPrice: 10 });
const sandbox = {
  exports: {},
  require: (name) => name === "server-only" ? {} : requireModule(name),
  process: { cwd: () => process.cwd(), env: { DHAN_CLIENT_ID: "test", DHAN_ACCESS_TOKEN: "test" } },
  fetch: async (url) => {
    const page = Number(String(url).split("/").at(-1));
    calls.push({ page, at: Date.now() });
    if (page === 1 && !rateLimited) {
      rateLimited = true;
      return new Response(JSON.stringify({ errorCode: "DH-904" }), { status: 429 });
    }
    return new Response(JSON.stringify(page === 0 ? [trade("a")] : page === 1 ? [trade("b")] : []));
  },
  Response,
  Date,
  setTimeout,
  console,
};

function requireModule(name) {
  if (name === "node:fs/promises") return {};
  if (name === "node:path") return { join: (...parts) => parts.join("/") };
  throw new Error(`Unexpected import: ${name}`);
}

vm.runInNewContext(outputText, sandbox, { filename: "dhan.ts" });
const { getTradeHistory } = sandbox.exports;
const [first, concurrent] = await Promise.all([
  getTradeHistory("2026-06-30", "2026-07-29"),
  getTradeHistory("2026-06-30", "2026-07-29"),
]);
assert.deepEqual(Array.from(first, (row) => row.exchangeTradeId), ["a", "b"]);
assert.deepEqual(Array.from(concurrent, (row) => row.exchangeTradeId), ["a", "b"]);
assert.deepEqual(calls.map((call) => call.page), [0, 1, 1, 2]);
assert.ok(calls[1].at - calls[0].at >= 280, "trade pages should be paced");
assert.ok(calls[2].at - calls[1].at >= 950, "HTTP 429 should back off before retrying");
await getTradeHistory("2026-06-30", "2026-07-29");
assert.equal(calls.length, 4, "completed history should be cached");
console.log("Dhan trade history pacing, retry, and cache tests passed.");
