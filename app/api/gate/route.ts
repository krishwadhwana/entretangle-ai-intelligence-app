import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const GateSchema = z.object({ code: z.string().min(1).max(200) });

// Exchange the access code for a long-lived httpOnly cookie holding its
// SHA-256 (checked by middleware on every request).
export async function POST(req: NextRequest) {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return NextResponse.json({ ok: true }); // gate disabled
  }
  const body = GateSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  const given = Buffer.from(body.data.code);
  const expected = Buffer.from(accessCode);
  const ok =
    given.length === expected.length && timingSafeEqual(given, expected);
  if (!ok) {
    return NextResponse.json({ error: "wrong code" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("et_access", createHash("sha256").update(accessCode).digest("hex"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
