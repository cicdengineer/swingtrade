import { NextResponse } from "next/server";
import { readDatabase } from "@/lib/localDatabase";

export const dynamic = "force-dynamic";

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
};

export async function GET() {
  const db = await readDatabase();
  return new NextResponse(csv(db.universe_members), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=seasonality-edge-universe.csv",
    },
  });
}
