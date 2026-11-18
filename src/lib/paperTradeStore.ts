import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getMysqlPool } from "./localDatabase";
import type { PaperTrade } from "./paperTrade";

const file = path.join(process.cwd(), ".data", "paper-trades.json");
let queue = Promise.resolve();
let schema: Promise<unknown> | undefined;

async function database() {
  const pool = getMysqlPool();
  schema ??= pool.query(`CREATE TABLE IF NOT EXISTS app_paper_trades (
    id CHAR(36) PRIMARY KEY, securityId VARCHAR(16) NOT NULL, symbol VARCHAR(80) NOT NULL,
    entry DOUBLE NOT NULL, stop DOUBLE NOT NULL, quantity BIGINT NOT NULL,
    capital DOUBLE NOT NULL, riskPercent DOUBLE NOT NULL, openedAt CHAR(24) NOT NULL,
    exitPrice DOUBLE NULL, closedAt CHAR(24) NULL
  ) ENGINE=InnoDB`).catch(error => { schema = undefined; throw error; });
  await schema;
  return pool;
}

async function readLocal(): Promise<PaperTrade[]> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function updateLocal(change: (trades: PaperTrade[]) => void) {
  const task = queue.then(async () => {
    const trades = await readLocal();
    change(trades);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(trades));
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
  queue = task.catch(() => {});
  return task;
}

export async function listPaperTrades(): Promise<PaperTrade[]> {
  if (!process.env.DATABASE_URL) return (await readLocal()).reverse();
  const [rows] = await (await database()).query<(PaperTrade & RowDataPacket)[]>(
    "SELECT * FROM app_paper_trades ORDER BY openedAt DESC, id DESC",
  );
  return rows;
}

export async function openPaperTrade(trade: PaperTrade) {
  if (!process.env.DATABASE_URL) return updateLocal(trades => {
    if (!trades.some(existing => existing.id === trade.id)) trades.push(trade);
  });
  await (await database()).execute(
    `INSERT INTO app_paper_trades (id, securityId, symbol, entry, stop, quantity, capital, riskPercent, openedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = app_paper_trades.id`,
    [trade.id, trade.securityId, trade.symbol, trade.entry, trade.stop, trade.quantity, trade.capital, trade.riskPercent, trade.openedAt],
  );
}

export async function closePaperTrade(id: string, exitPrice: number) {
  const closedAt = new Date().toISOString();
  if (!process.env.DATABASE_URL) return updateLocal(trades => {
    const trade = trades.find(trade => trade.id === id);
    if (trade?.closedAt === null) Object.assign(trade, { exitPrice, closedAt });
  });
  await (await database()).execute(
    "UPDATE app_paper_trades SET exitPrice = ?, closedAt = ? WHERE id = ? AND closedAt IS NULL",
    [exitPrice, closedAt, id],
  );
}
