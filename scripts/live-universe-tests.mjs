import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/lib/dhanLiveUniverse.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
let now = 100_000, reads = 0, fail = false;
let prices = [{ security_id: "1" }, { security_id: "2" }, { security_id: "1" }, { security_id: "" }];
const subscriptions = [];
vm.runInNewContext(js, {
  module, exports: module.exports, Date: { now: () => now },
  require(name) {
    if (name === "server-only") return {};
    if (name === "./dhanLiveFeed") return { dhanLiveFeed: { subscribe: ids => subscriptions.push(Array.from(ids)) } };
    if (name === "./localDatabase") return { readDatabase: async () => { reads++; if (fail) throw new Error("DB unavailable"); return { daily_prices: prices }; } };
    throw new Error(name);
  },
});
const { ensureDhanLiveUniverse } = module.exports;
await Promise.all([ensureDhanLiveUniverse(), ensureDhanLiveUniverse()]);
assert.equal(reads, 1, "concurrent requests share the universe load");
assert.deepEqual(subscriptions, [["1", "2"]], "subscribe all stored stocks, deduplicating IDs");
await ensureDhanLiveUniverse();
assert.equal(reads, 1, "browser reconnects do not repeatedly load history");
now += 60_000;
prices.push({ security_id: "3" });
await ensureDhanLiveUniverse();
assert.deepEqual(subscriptions.at(-1), ["1", "2", "3"], "new stored stocks join the feed");
now += 60_000;
fail = true;
await assert.rejects(ensureDhanLiveUniverse(), /DB unavailable/);
fail = false;
await ensureDhanLiveUniverse();
assert.equal(reads, 4, "failed loads can retry immediately");
console.log("Live universe tests passed.");
