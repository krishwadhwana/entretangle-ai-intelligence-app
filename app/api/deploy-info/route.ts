import { NextResponse } from "next/server";
import { currentDeployInfo } from "@/lib/deployInfo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    deploy: currentDeployInfo("web"),
    now: new Date().toISOString(),
  });
}
