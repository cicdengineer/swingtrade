import fs from "node:fs";
import path from "node:path";

const dbFile = path.join(process.cwd(), ".data", "seasonality-edge-db.json");
const backupFile = `${dbFile}.pre-date-shift-${Date.now()}.bak`;

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

function shiftDate(value) {
  if (typeof value !== "string" || !dateOnly.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));

const weekendBefore = new Set();
for (const row of db.daily_prices ?? []) {
  const day = new Date(`${row.trade_date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) weekendBefore.add(row.trade_date);
}

fs.copyFileSync(dbFile, backupFile);

let dailyRows = 0;
for (const row of db.daily_prices ?? []) {
  row.trade_date = shiftDate(row.trade_date);
  row.id = `${row.security_id}-${row.trade_date}`;
  dailyRows += 1;
}

for (const instrument of db.instruments ?? []) {
  instrument.data_start_date = shiftDate(instrument.data_start_date);
  instrument.data_end_date = shiftDate(instrument.data_end_date);
}

for (const job of db.data_download_jobs ?? []) {
  job.data_through_date = shiftDate(job.data_through_date);
}

for (const issue of db.data_quality_issues ?? []) {
  issue.trade_date = shiftDate(issue.trade_date);
  if (issue.security_id && issue.trade_date && issue.issue_code) {
    issue.id = `${issue.security_id}-${issue.trade_date}-${issue.issue_code}`;
  }
}

db.updated_at = new Date().toISOString();
fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

const weekendAfter = new Set();
for (const row of db.daily_prices ?? []) {
  const day = new Date(`${row.trade_date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) weekendAfter.add(row.trade_date);
}

console.log(JSON.stringify({
  backupFile,
  dailyRowsShifted: dailyRows,
  weekendDatesBefore: weekendBefore.size,
  weekendDatesAfter: weekendAfter.size,
  latestDate: (db.daily_prices ?? []).map((row) => row.trade_date).sort().at(-1),
}, null, 2));
