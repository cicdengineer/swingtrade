import { NextResponse } from "next/server";
import { deleteManagedTrade, updateManagedTrade } from "@/lib/tradeManagementStore";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const trade = await updateManagedTrade(id, body);
    return NextResponse.json({ trade });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update managed trade." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await deleteManagedTrade(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete managed trade." }, { status: 400 });
  }
}
