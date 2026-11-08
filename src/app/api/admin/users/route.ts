import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listUsers, ownerEmail, setGrant } from "@/lib/userDirectory";

export const dynamic = "force-dynamic";
const forbidden = () => NextResponse.json({ error: "Administrator access required." }, { status: 403 });

export async function GET() {
  if (!(await getServerSession(authOptions))?.isAdmin) return forbidden();
  return NextResponse.json({ users: (await listUsers()).map(user => ({ ...user, isAdmin: user.email === ownerEmail })) });
}

export async function PATCH(request: Request) {
  if (!(await getServerSession(authOptions))?.isAdmin) return forbidden();
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string" || typeof body.fullAccess !== "boolean")
    return NextResponse.json({ error: "Choose a user and access level." }, { status: 400 });
  if (!await setGrant(body.id, body.fullAccess))
    return NextResponse.json({ error: "This user cannot be updated." }, { status: 404 });
  return NextResponse.json({ fullAccess: body.fullAccess });
}
