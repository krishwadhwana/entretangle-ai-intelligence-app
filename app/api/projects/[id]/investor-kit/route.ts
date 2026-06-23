import { NextResponse } from "next/server";
import { buildInvestorSnapshot, createInvestorKit, updateInvestorKit } from "@/lib/investor";
import { InvestorKitEditsSchema } from "@/lib/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const snapshot = await buildInvestorSnapshot(params.id);
    return NextResponse.json({
      latestKit: snapshot.latestKit,
      kitEdits: snapshot.kitEdits,
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const kit = await createInvestorKit(params.id);
    const snapshot = await buildInvestorSnapshot(params.id);
    return NextResponse.json({ kit, kitEdits: snapshot.kitEdits });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

// Save founder edits to the kit's deck slides, memo sections, Q&A answers,
// use-of-funds lines or financial bullets, then return the kit with the edits
// applied. Edits are stored separately from the generated base so they survive
// regeneration.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = InvestorKitEditsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid edits" }, { status: 400 });
  }
  try {
    const kit = await updateInvestorKit(params.id, parsed.data);
    return NextResponse.json({ kit, kitEdits: parsed.data });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
