import { PrismaClient } from "@prisma/client";

// Prisma singleton — survives Next.js dev hot reloads.
// Serverless connection tuning (connection_limit / pool_timeout /
// connect_timeout) lives on the DATABASE_URL env var in each deployment, not
// here, so it can be adjusted without a code change.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Transient connection errors a *cold* serverless instance hits when it opens
// its first connection across regions to the Railway proxy. These are not data
// problems — the next attempt almost always succeeds once the connection is
// warm — so retrying turns an intermittent 500 into a slightly slower 200.
//   P1001 can't reach DB · P1002 connect timeout · P1008 op timeout
//   P1017 server closed the connection · P2024 timed out fetching from the pool
const TRANSIENT_DB_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

function isTransientDbError(e: unknown): boolean {
  const code = (e as { code?: string; errorCode?: string })?.code ??
    (e as { errorCode?: string })?.errorCode;
  if (code && TRANSIENT_DB_CODES.has(code)) return true;
  // Initialization/connection errors don't always carry a tidy code.
  const msg = String((e as { message?: string })?.message ?? "").toLowerCase();
  return (
    msg.includes("can't reach database") ||
    msg.includes("connection pool") ||
    msg.includes("timed out") ||
    msg.includes("connection closed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a DB query, retrying only transient connection failures with a short
 * backoff. Non-connection errors (bad query, constraint violation) throw
 * immediately so real bugs aren't masked.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === attempts - 1 || !isTransientDbError(e)) throw e;
      await sleep(150 * 2 ** attempt); // 150ms, 300ms
    }
  }
  throw lastError;
}
