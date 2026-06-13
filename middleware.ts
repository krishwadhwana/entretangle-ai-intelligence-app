import { NextRequest, NextResponse } from "next/server";

// Access gate: the app is public on the internet and its LLM routes spend
// real API credits, so everything is behind ACCESS_CODE. The cookie stores a
// SHA-256 of the code (set by /api/gate), never the code itself.
// If ACCESS_CODE is unset the gate is open (local dev convenience).

export const ACCESS_COOKIE = "et_access";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === "/gate" || pathname === "/api/gate") {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
  if (cookie && cookie === (await sha256Hex(accessCode))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "access code required" }, { status: 401 });
  }
  const gateUrl = req.nextUrl.clone();
  gateUrl.pathname = "/gate";
  gateUrl.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(gateUrl);
}

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
