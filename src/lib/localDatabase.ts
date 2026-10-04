import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
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
const mysqlDatabaseId = "default";

type MysqlPool = mysql.Pool;
type MysqlRow = mysql.RowDataPacket & { data: SeasonalityDatabase | string | Buffer | null; size_bytes?: number };

const databaseUrl = process.env.DATABASE_URL?.trim();
const useMysqlStorage = Boolean(databaseUrl);
let mysqlPool: MysqlPool | undefined;
let mysqlReady: Promise<void> | undefined;

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

function normalizeDatabase(raw: Partial<SeasonalityDatabase> | null | undefined): SeasonalityDatabase {
  return { ...emptyDb(), ...(raw ?? {}) };
}

function parseMysqlJson(value: MysqlRow["data"]): SeasonalityDatabase | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function getMysqlPool() {
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  if (!mysqlPool) {
    const url = new URL(databaseUrl);
    mysqlPool = mysql.createPool({
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
      waitForConnections: true,
      connectionLimit: Number(process.env.DATABASE_POOL_SIZE ?? 4),
      charset: "utf8mb4",
      timezone: "Z",
    });
  }
  return mysqlPool;
}

async function ensureMysqlDb() {
  if (!mysqlReady) {
    mysqlReady = (async () => {
      await getMysqlPool().execute(`
        CREATE TABLE IF NOT EXISTS seasonality_json_database (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          schema_version INT NOT NULL DEFAULT 1,
          data JSON NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }
  await mysqlReady;
}

async function ensureMysqlDatabase(): Promise<SeasonalityDatabase> {
  await ensureMysqlDb();
  const [rows] = await getMysqlPool().execute<MysqlRow[]>(
    "SELECT data FROM seasonality_json_database WHERE id = ? LIMIT 1",
    [mysqlDatabaseId],
  );
  const existing = parseMysqlJson(rows[0]?.data);
  if (existing) return normalizeDatabase(existing);

  const db = emptyDb();
  await writeMysqlDatabase(db);
  return db;
}

async function writeMysqlDatabase(db: SeasonalityDatabase) {
  await ensureMysqlDb();
  db.updated_at = new Date().toISOString();
  await getMysqlPool().execute(
    `INSERT INTO seasonality_json_database (id, schema_version, data)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       schema_version = VALUES(schema_version),
       data = VALUES(data),
       updated_at = CURRENT_TIMESTAMP`,
    [mysqlDatabaseId, db.schema_version, JSON.stringify(db)],
  );
}

async function getMysqlDatabaseSizeBytes() {
  await ensureMysqlDb();
  const [rows] = await getMysqlPool().execute<MysqlRow[]>(
    "SELECT CHAR_LENGTH(CAST(data AS CHAR)) AS size_bytes FROM seasonality_json_database WHERE id = ? LIMIT 1",
    [mysqlDatabaseId],
  );
  return Number(rows[0]?.size_bytes ?? 0);
}

async function ensureJsonFileDb(): Promise<SeasonalityDatabase> {
  try {
    const raw = await fs.readFile(dbFile, "utf8");
    try {
      return normalizeDatabase(JSON.parse(raw));
    } catch (error) {
      if (!(error instanceof SyntaxError) || !raw.includes(replacementCharacter)) throw error;

      const repaired = raw.replaceAll(replacementCharacter, "");
      const db = normalizeDatabase(JSON.parse(repaired));
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
  return useMysqlStorage ? ensureMysqlDatabase() : ensureJsonFileDb();
}

export async function writeDatabase(db: SeasonalityDatabase) {
  if (useMysqlStorage) {
    writeQueue = writeQueue.then(() => writeMysqlDatabase(db), () => writeMysqlDatabase(db));
    return writeQueue;
  }

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
  }, async () => {
    db.updated_at = new Date().toISOString();
    await fs.mkdir(path.dirname(dbFile), { recursive: true });
    await fs.writeFile(dbFile, JSON.stringify(db, null, 2));
  });
  return writeQueue;
}

export async function getDatabaseSizeBytes() {
  if (useMysqlStorage) return getMysqlDatabaseSizeBytes();

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
