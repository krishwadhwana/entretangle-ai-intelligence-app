import { withAuth } from "next-auth/middleware";

const secret =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "production"
    ? undefined
    : "entretangle-local-dev-secret");

// Open access (temporary): while enabled, every request is authorized so the
// login gate never redirects. Set OPEN_ACCESS=false to restore the gate.
const OPEN_ACCESS = process.env.OPEN_ACCESS !== "false";

export default withAuth({
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized: ({ token }) => OPEN_ACCESS || Boolean(token),
  },
  secret,
});

export const config = {
  matcher: [
    "/((?!api/auth|login|auth/verify-request|auth/error|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
