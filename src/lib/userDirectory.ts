import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getMysqlPool } from "./localDatabase";

export const ownerEmail = "projectwealthpro@gmail.com";
export type DirectoryUser = {
  id: string; email: string; name: string; firstLogin: string; lastLogin: string; fullAccess: boolean;
};
const file = path.join(process.cwd(), ".data", "users.json");
let queue = Promise.resolve();
let schema: Promise<unknown> | undefined;

async function database() {
  const pool = getMysqlPool();
  schema ??= pool.query(`CREATE TABLE IF NOT EXISTS app_users (
    id VARCHAR(255) PRIMARY KEY, email VARCHAR(320) NOT NULL, name VARCHAR(255) NOT NULL,
    firstLogin CHAR(24) NOT NULL, lastLogin CHAR(24) NOT NULL, fullAccess BOOLEAN NOT NULL DEFAULT FALSE
  )`).catch(error => { schema = undefined; throw error; });
  await schema;
  return pool;
}

async function localUsers(): Promise<DirectoryUser[]> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

function updateLocal(change: (users: DirectoryUser[]) => boolean) {
  const task = queue.then(async () => {
    const users = await localUsers();
    if (!change(users)) return false;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + "." + randomUUID();
    await fs.writeFile(temp, JSON.stringify(users), { mode: 0o600 });
    await fs.rename(temp, file);
    return true;
  });
  queue = task.then(() => {}, () => {});
  return task;
}

export async function recordLogin(id: string, email: string, name: string) {
  const now = new Date().toISOString();
  if (process.env.DATABASE_URL?.trim()) {
    const db = await database();
    await db.execute(`INSERT INTO app_users (id,email,name,firstLogin,lastLogin) VALUES (?,?,?,?,?)
      ON DUPLICATE KEY UPDATE email=VALUES(email), name=VALUES(name), lastLogin=GREATEST(lastLogin,VALUES(lastLogin))`,
      [id,email,name,now,now]);
  } else {
    await updateLocal(users => {
      const user = users.find(row => row.id === id);
      if (user) Object.assign(user, { email, name, lastLogin: now });
      else users.push({ id, email, name, firstLogin: now, lastLogin: now, fullAccess: false });
      return true;
    });
  }
}

export async function hasGrant(id: string) {
  if (!process.env.DATABASE_URL?.trim()) return (await localUsers()).some(user => user.id === id && user.fullAccess);
  const [rows] = await (await database()).execute<RowDataPacket[]>("SELECT fullAccess FROM app_users WHERE id=?", [id]);
  return Boolean(rows[0]?.fullAccess);
}

export async function listUsers(): Promise<DirectoryUser[]> {
  if (!process.env.DATABASE_URL?.trim()) return (await localUsers()).sort((a,b) => b.lastLogin.localeCompare(a.lastLogin));
  const [rows] = await (await database()).query<(DirectoryUser & RowDataPacket)[]>("SELECT id,email,name,firstLogin,lastLogin,fullAccess FROM app_users ORDER BY lastLogin DESC");
  return rows.map(row => ({ ...row, fullAccess: Boolean(row.fullAccess) }));
}

export async function setGrant(id: string, fullAccess: boolean) {
  if (!process.env.DATABASE_URL?.trim()) return updateLocal(users => {
    const user = users.find(row => row.id === id && row.email !== ownerEmail);
    if (!user) return false;
    user.fullAccess = fullAccess;
    return true;
  });
  const [result] = await (await database()).execute<ResultSetHeader>("UPDATE app_users SET fullAccess=? WHERE id=? AND email<>?", [fullAccess,id,ownerEmail]);
  return result.affectedRows > 0;
}
