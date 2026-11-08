"use client";
import { useEffect, useState } from "react";
import type { DirectoryUser } from "@/lib/userDirectory";

type User = DirectoryUser & { isAdmin: boolean };
const date = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

export function UsersView() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/users", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Could not load users.");
      setUsers((await response.json()).users);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  async function toggle(user: User) {
    setPending(user.id);
    setError("");
    try {
      const fullAccess = !user.fullAccess;
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id, fullAccess }) });
      if (!response.ok) throw new Error("Could not save access. Try again.");
      setUsers(rows => rows?.map(row => row.id === user.id ? { ...row, fullAccess } : row) ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save access."); }
    finally { setPending(""); }
  }
  return <section className="panel"><div className="panel-head"><div><h2>User access</h2>
    <p>Full access unlocks Portfolio details, manual refresh, and all Screener tiles.</p></div></div>
    {error && <p role="alert" className="error">{error}</p>}
    {users?.length ? <div className="table-wrap"><table><thead><tr>
      <th>Name</th><th>Google email</th><th>Role</th><th>First sign-in (IST)</th><th>Last sign-in (IST)</th><th>Full access</th>
    </tr></thead><tbody>{users.map(user => <tr key={user.id}>
      <td>{user.name || "—"}</td><td>{user.email}</td><td>{user.isAdmin ? "Admin" : "Viewer"}</td>
      <td>{date(user.firstLogin)}</td><td>{date(user.lastLogin)}</td>
      <td><input type="checkbox" aria-label={`Full access for ${user.email}`} checked={user.isAdmin || user.fullAccess}
        disabled={user.isAdmin || Boolean(pending)} onChange={() => void toggle(user)} /></td>
    </tr>)}</tbody></table></div> : !error && <p className="panel-empty">{users ? "No sign-ins recorded yet." : "Loading users…"}</p>}
  </section>;
}
