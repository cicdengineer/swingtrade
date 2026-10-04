import { NextResponse } from "next/server"; import { hasDhanCredentials } from "@/lib/dhan";
export const dynamic = "force-dynamic";
export function GET(){ return NextResponse.json({ configured: hasDhanCredentials() }); }
