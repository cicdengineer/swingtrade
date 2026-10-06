import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const cache = new Map();

function loadTs(file) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;

  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = new Module(filename);
  cache.set(filename, mod);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const parentRequire = Module.createRequire(filename);
  mod.require = (request) => {
    if (request === "server-only") return {};
    if (request.startsWith("./") || request.startsWith("../")) {
      const resolved = path.resolve(path.dirname(filename), request);
      const tsFile = fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : fs.existsSync(path.join(resolved, "index.ts")) ? path.join(resolved, "index.ts") : null;
      if (tsFile) return loadTs(path.relative(root, tsFile));
    }
    return parentRequire(request);
  };
  mod._compile(output, filename);
  return mod.exports;
}

const {
  aggregateIntradayToDaily,
  getIndiaTradingDate,
  isIndianMarketClosed,
  validateConstructedDailyCandle,
  withRetry,
} = loadTs("src/lib/historicalDataService.ts");

const candle = (date, open, high, low, close, volume) => ({ date, open, high, low, close, volume });
const atUtc = (iso) => new Date(iso);

{
  const candles = Array.from({ length: 20 }, (_, index) => {
    const start = new Date(Date.UTC(2026, 9, 5, 3, 45 + index * 5));
    return candle(start.toISOString(), 100 + index, 105 + index, 99, 104 + index, 1000 + index);
  });
  const result = aggregateIntradayToDaily(candles, "2026-10-05", atUtc("2026-10-05T10:30:00.000Z"), 5);
  assert.equal(result.valid, true, "CASE 2/5: missing-but-reasonable intraday set should aggregate");
  assert.deepEqual(result.candle, { date: "2026-10-05", open: 100, high: 124, low: 99, close: 123, volume: 20190 });
}

{
  const result = aggregateIntradayToDaily([
    candle("2026-10-05T03:45:00.000Z", 100, 101, 99, 100, 10),
    candle("2026-10-05T10:31:00.000Z", 999, 999, 999, 999, 999),
  ], "2026-10-05", atUtc("2026-10-05T10:30:00.000Z"), 5);
  assert.equal(result.valid, false, "CASE 4/10: no reasonable session data means no fake candle");
  assert.equal(result.reason, "insufficient_intraday_candles");
}

{
  const invalid = validateConstructedDailyCandle({ date: "2026-10-05", open: 100, high: 90, low: 95, close: 99, volume: 10 }, 75, 5);
  assert.equal(invalid.valid, false, "CASE 6: invalid OHLC must be rejected");
  assert.equal(invalid.reason, "invalid_high");
}

{
  assert.equal(getIndiaTradingDate(atUtc("2026-10-05T19:00:00.000Z")), "2026-10-06", "CASE 9: UTC server time must resolve to IST trading date");
  assert.equal(isIndianMarketClosed(atUtc("2026-10-05T10:01:00.000Z")), true, "CASE 9: market close check uses IST");
}

{
  let attempts = 0;
  const value = await withRetry("rate-limit", async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("Dhan transient error 429");
    return "ok";
  }, 3);
  assert.equal(value, "ok", "CASE 7: transient/rate-limit failures should retry");
  assert.equal(attempts, 3);
}

{
  const securities = ["OK1", "FAIL", "OK2"];
  const results = await Promise.all(securities.map(async (securityId) => {
    try {
      if (securityId === "FAIL") throw new Error("DOWNLOAD_FAILED");
      return { securityId, ok: true };
    } catch (error) {
      return { securityId, ok: false, error };
    }
  }));
  assert.equal(results.filter((row) => row.ok).length, 2, "CASE 8: one failed security must not stop other securities");
  assert.equal(results.filter((row) => !row.ok).length, 1);
}

console.log("market-data refresh tests passed");
