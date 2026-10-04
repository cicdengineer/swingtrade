import fs from "node:fs";
import path from "node:path";

const cacheDir = path.join(process.cwd(), ".data", "dhan");
const backupDir = path.join(process.cwd(), ".data", `dhan-cache-pre-date-shift-${Date.now()}`);
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

function shiftDate(value) {
  if (typeof value !== "string" || !dateOnly.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

if (!fs.existsSync(cacheDir)) {
  console.log(JSON.stringify({ repairedFiles: 0, reason: "cache directory does not exist" }, null, 2));
  process.exit(0);
}

fs.mkdirSync(backupDir, { recursive: true });
let repairedFiles = 0;
let repairedRows = 0;

for (const entry of fs.readdirSync(cacheDir)) {
  if (!/^daily-.+\.json$/.test(entry)) continue;
  const file = path.join(cacheDir, entry);
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(rows) || !rows.every((row) => row && typeof row.date === "string")) continue;
  const weekendRows = rows.filter((row) => {
    const day = new Date(`${row.date}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
  }).length;
  if (weekendRows < 10) continue;
  fs.copyFileSync(file, path.join(backupDir, entry));
  for (const row of rows) {
    row.date = shiftDate(row.date);
    repairedRows += 1;
  }
  fs.writeFileSync(file, JSON.stringify(rows));
  repairedFiles += 1;
}

console.log(JSON.stringify({ backupDir, repairedFiles, repairedRows }, null, 2));
