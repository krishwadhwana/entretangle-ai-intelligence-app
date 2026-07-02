import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { getServerSession } from "next-auth";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";
import { createTransport } from "nodemailer";
import { prisma } from "./db";

export const authSecret =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "production"
    ? undefined
    : "entretangle-local-dev-secret");

function configuredProviders(): NextAuthOptions["providers"] {
  const providers: NextAuthOptions["providers"] = [
    EmailProvider({
      from: process.env.EMAIL_FROM || "EntreTangle <no-reply@entretangle.local>",
      maxAge: 10 * 60,
      async sendVerificationRequest({ identifier, url, provider }) {
        if (!process.env.EMAIL_SERVER || !process.env.EMAIL_FROM) {
          if (process.env.NODE_ENV === "production") {
            throw new Error("Email verification is not configured");
          }
          console.warn(
            `[auth] EMAIL_SERVER/EMAIL_FROM not configured. Verification link for ${identifier}: ${url}`,
          );
          return;
        }

        const transport = createTransport(process.env.EMAIL_SERVER);
        const result = await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: "Sign in to EntreTangle",
          text: `Sign in to EntreTangle with this verified email link:\n\n${url}\n\nThis link expires in 10 minutes.`,
          html: [
            '<div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#171717">',
            "<h1 style=\"font-size:20px;margin:0 0 12px\">Sign in to EntreTangle</h1>",
            '<p style="margin:0 0 18px">Use this verified email link to continue.</p>',
            `<a href="${escapeHtml(url)}" style="display:inline-block;border-radius:8px;background:#171717;color:#fff;padding:10px 14px;text-decoration:none">Sign in</a>`,
            '<p style="margin:18px 0 0;color:#737373;font-size:13px">This link expires in 10 minutes.</p>',
            "</div>",
          ].join(""),
        });

        const failed = [...result.rejected, ...result.pending].filter(Boolean);
        if (failed.length) {
          throw new Error(`Email verification could not be sent to ${failed.join(", ")}`);
        }
      },
    }),
  ];

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    providers.push(
      FacebookProvider({
        clientId: process.env.FACEBOOK_CLIENT_ID,
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  return providers;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: configuredProviders(),
  secret: authSecret,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/auth/verify-request",
    error: "/auth/error",
  },
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
    redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
  },
};

export type CurrentUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
};

export class AuthRequiredError extends Error {
  constructor() {
    super("authentication required");
    this.name = "AuthRequiredError";
  }
}

// --- Open access (temporary) ------------------------------------------------
// While the login gate is disabled, unauthenticated requests resolve to a
// single shared "guest" account so owner-scoped reads/writes keep working.
// Restore the login gate by setting OPEN_ACCESS=false (and, for the header,
// NEXT_PUBLIC_OPEN_ACCESS=false).
export const OPEN_ACCESS = process.env.OPEN_ACCESS !== "false";

const GUEST_USER_ID = "guest-open-access";
const GUEST_USER_EMAIL = "guest@entretangle.local";

async function getGuestUser(): Promise<CurrentUser> {
  // Upsert so the FK-backed ownerId writes in ensure*Access always point at a
  // real users row — self-healing on a fresh database.
  const user = await prisma.user.upsert({
    where: { id: GUEST_USER_ID },
    update: {},
    create: { id: GUEST_USER_ID, email: GUEST_USER_EMAIL, name: "Guest" },
    select: { id: true, email: true, name: true, image: true },
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return OPEN_ACCESS ? await getGuestUser() : null;
  return {
    id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthRequiredError();
  return user;
}

export async function ensureProjectAccess(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true },
  });
  if (!project) return null;
  if (project.ownerId === userId) return project;
  if (project.ownerId) return null;

  await prisma.project.update({
    where: { id: projectId },
    data: { ownerId: userId },
  });
  await Promise.all([
    prisma.run.updateMany({
      where: { projectId, ownerId: null },
      data: { ownerId: userId },
    }),
    prisma.workspaceNode.updateMany({
      where: {
        ownerId: null,
        OR: [{ projectId }, { refProjectId: projectId }],
      },
      data: { ownerId: userId },
    }),
  ]);
  return { ...project, ownerId: userId };
}

export async function ensureRunAccess(runId: string, userId: string) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, ownerId: true, projectId: true },
  });
  if (!run) return null;
  if (run.ownerId === userId) return run;
  if (run.ownerId) return null;

  if (run.projectId) {
    const project = await ensureProjectAccess(run.projectId, userId);
    if (!project) return null;
  }

  await prisma.run.update({ where: { id: runId }, data: { ownerId: userId } });
  return { ...run, ownerId: userId };
}

export async function ensureWorkspaceNodeAccess(nodeId: string, userId: string) {
  const node = await prisma.workspaceNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      ownerId: true,
      projectId: true,
      refProjectId: true,
    },
  });
  if (!node) return null;
  if (node.ownerId === userId) return node;
  if (node.ownerId) return null;

  const projectId = node.projectId ?? node.refProjectId;
  if (projectId) {
    const project = await ensureProjectAccess(projectId, userId);
    if (!project) return null;
  }

  await prisma.workspaceNode.update({
    where: { id: nodeId },
    data: { ownerId: userId },
  });
  return { ...node, ownerId: userId };
}
