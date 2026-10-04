import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  DailyPriceRecord,
  DataDownloadJobRecord,
  DataQualityIssueRecord,
  DownloadFailureRecord,
  InstrumentRecord,
  ManagedTradeRecord,
  SeasonalExclusionRecord,
  SeasonalObservationRecord,
  SeasonalityBuildRecord,
  SeasonalStatisticsRecord,
  TradeEventRecord,
  TradeTrancheRecord,
  TradingSettingsRecord,
  UniverseMemberRecord,
} from "./types";

export type SeasonalityDatabase = {
  schema_version: 1;
  created_at: string;
  updated_at: string;
  instruments: InstrumentRecord[];
  universe_members: UniverseMemberRecord[];
  daily_prices: DailyPriceRecord[];
  data_download_jobs: DataDownloadJobRecord[];
  data_quality_issues: DataQualityIssueRecord[];
  download_failures: DownloadFailureRecord[];
  seasonal_observations: SeasonalObservationRecord[];
  seasonal_statistics: SeasonalStatisticsRecord[];
  seasonal_exclusions: SeasonalExclusionRecord[];
  seasonality_builds: SeasonalityBuildRecord[];
  trading_settings: TradingSettingsRecord[];
  managed_trades: ManagedTradeRecord[];
  trade_tranches: TradeTrancheRecord[];
  trade_events: TradeEventRecord[];
};

const dbFile = path.join(process.cwd(), ".data", "seasonality-edge-db.json");
let writeQueue: Promise<void> = Promise.resolve();
const replacementCharacter = "\uFFFD";

const emptyDb = (): SeasonalityDatabase => {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    created_at: now,
    updated_at: now,
    instruments: [],
    universe_members: [],
    daily_prices: [],
    data_download_jobs: [],
    data_quality_issues: [],
    download_failures: [],
    seasonal_observations: [],
    seasonal_statistics: [],
    seasonal_exclusions: [],
    seasonality_builds: [],
    trading_settings: [],
    managed_trades: [],
    trade_tranches: [],
    trade_events: [],
  };
};

async function ensureDb(): Promise<SeasonalityDatabase> {
  try {
    const raw = await fs.readFile(dbFile, "utf8");
    try {
      return { ...emptyDb(), ...JSON.parse(raw) };
    } catch (error) {
      if (!(error instanceof SyntaxError) || !raw.includes(replacementCharacter)) throw error;

      const repaired = raw.replaceAll(replacementCharacter, "");
      const db = { ...emptyDb(), ...JSON.parse(repaired) };
      const backupFile = `${dbFile}.corrupt-${Date.now()}.bak`;
      await fs.copyFile(dbFile, backupFile).catch(() => {});
      console.warn(`Repaired invalid replacement characters in ${dbFile}. Corrupt copy saved to ${backupFile}.`);
      await writeDatabase(db);
      return db;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const db = emptyDb();
    await writeDatabase(db);
    return db;
  }
}

export async function readDatabase(): Promise<SeasonalityDatabase> {
  return ensureDb();
}

export async function writeDatabase(db: SeasonalityDatabase) {
  writeQueue = writeQueue.then(async () => {
    db.updated_at = new Date().toISOString();
    await fs.mkdir(path.dirname(dbFile), { recursive: true });
    const tempFile = `${dbFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(db, null, 2));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await fs.rename(tempFile, dbFile);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM" || attempt === 5) {
          await fs.copyFile(tempFile, dbFile);
          await fs.unlink(tempFile).catch(() => {});
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 75 * attempt));
      }
    }
  });
  return writeQueue;
}

export async function getDatabaseSizeBytes() {
  try {
    return (await fs.stat(dbFile)).size;
  } catch {
    return 0;
  }
}

export function upsertInstrument(db: SeasonalityDatabase, instrument: InstrumentRecord) {
  const index = db.instruments.findIndex((row) => row.security_id === instrument.security_id);
  if (index >= 0) db.instruments[index] = { ...db.instruments[index], ...instrument };
  else db.instruments.push(instrument);
}

export function upsertUniverseMember(db: SeasonalityDatabase, member: UniverseMemberRecord) {
  const index = db.universe_members.findIndex(
    (row) => row.universe_name === member.universe_name && row.symbol === member.symbol,
  );
  if (index >= 0) db.universe_members[index] = { ...db.universe_members[index], ...member };
  else db.universe_members.push(member);
}

export function upsertFailure(db: SeasonalityDatabase, failure: Omit<DownloadFailureRecord, "attempt_count" | "last_attempt" | "status">) {
  const now = new Date().toISOString();
  const index = db.download_failures.findIndex((row) => row.security_id === failure.security_id);
  if (index >= 0) {
    db.download_failures[index] = {
      ...db.download_failures[index],
      ...failure,
      attempt_count: db.download_failures[index].attempt_count + 1,
      last_attempt: now,
      status: "open",
    };
  } else {
    db.download_failures.push({ ...failure, attempt_count: 1, last_attempt: now, status: "open" });
  }
}

export function markFailureResolved(db: SeasonalityDatabase, securityId: string) {
  const row = db.download_failures.find((failure) => failure.security_id === securityId);
  if (row) row.status = "resolved";
}

export function replaceQualityIssues(db: SeasonalityDatabase, securityId: string, issues: DataQualityIssueRecord[]) {
  db.data_quality_issues = db.data_quality_issues.filter((issue) => issue.security_id !== securityId).concat(issues);
}

export function upsertDailyPrices(db: SeasonalityDatabase, rows: DailyPriceRecord[]) {
  const existing = new Map(db.daily_prices.map((row, index) => [`${row.security_id}:${row.trade_date}`, index]));
  for (const row of rows) {
    const key = `${row.security_id}:${row.trade_date}`;
    const index = existing.get(key);
    if (index === undefined) {
      existing.set(key, db.daily_prices.length);
      db.daily_prices.push(row);
    } else {
      db.daily_prices[index] = { ...db.daily_prices[index], ...row, created_at: db.daily_prices[index].created_at };
    }
  }
}

export function latestPriceDate(db: SeasonalityDatabase, securityId: string) {
  return db.daily_prices
    .filter((row) => row.security_id === securityId)
    .map((row) => row.trade_date)
    .sort()
    .at(-1);
}
