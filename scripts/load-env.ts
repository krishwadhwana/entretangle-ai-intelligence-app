// Load .env for LOCAL processes that aren't started by Next (the worker, the
// cron scripts). Vercel and Railway inject real environment variables, so this
// is a harmless no-op there (the file won't exist). Uses Node's built-in
// process.loadEnvFile (Node 20.12+) — no dotenv dependency.
//
// Import this FIRST, before anything that reads process.env at module load
// (e.g. the Prisma client), so the values are present in time.
import fs from "fs";

const path = process.env.ENV_FILE ?? ".env";
const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void })
  .loadEnvFile;
if (typeof loadEnvFile === "function" && fs.existsSync(path)) {
  try {
    loadEnvFile(path);
  } catch {
    // Malformed/locked file — fall back to whatever is already in the env.
  }
}
