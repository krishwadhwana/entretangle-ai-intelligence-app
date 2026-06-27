import { withAuth } from "next-auth/middleware";

const secret =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "production"
    ? undefined
    : "entretangle-local-dev-secret");

export default withAuth({
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized: ({ token }) => Boolean(token),
  },
  secret,
});

export const config = {
  matcher: [
    "/((?!api/auth|login|auth/verify-request|auth/error|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
