/**
 * One-time migration: move existing Design Studio assets that are still stored
 * inline (base64/SVG/HTML/font bytes) in the owner_dashboard JSONB out to object
 * storage (R2). Idempotent and safe to re-run — already-externalized projects
 * are skipped.
 *
 * Requires the S3_* env vars to be set (the same ones the app uses). Without
 * them, storage falls back to the LOCAL filesystem under data/uploads/, which
 * is NOT what you want for the production migration — so this script refuses to
 * run unless storage is configured (override with --allow-local for dev tests).
 *
 *   npx tsx scripts/migrate-assets-to-r2.ts            # migrate everything
 *   npx tsx scripts/migrate-assets-to-r2.ts --dry-run  # report only, no writes
 *   npx tsx scripts/migrate-assets-to-r2.ts <projectId> [<projectId> ...]
 */
import {
  listAllProjectIds,
  migrateProjectAssetsToStorage,
} from "../lib/store";
import { storageConfigured } from "../lib/storage";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allowLocal = args.includes("--allow-local");
  const ids = args.filter((a) => !a.startsWith("--"));

  if (!storageConfigured() && !allowLocal) {
    console.error(
      "Object storage is not configured (S3_* env vars missing). Set them, or " +
        "pass --allow-local to migrate into the local filesystem fallback.",
    );
    process.exit(1);
  }

  const targets = ids.length ? ids : await listAllProjectIds();
  console.log(
    `${dryRun ? "[dry-run] " : ""}Migrating assets for ${targets.length} project(s)…`,
  );

  let migrated = 0;
  const totals = { assets: 0, sites: 0, fonts: 0 };
  for (const id of targets) {
    try {
      const res = await migrateProjectAssetsToStorage(id, { dryRun });
      const pending = res.assets + res.sites + res.fonts;
      if (dryRun) {
        console.log(
          pending
            ? `  ${id}: would migrate ${res.assets} asset(s), ${res.sites} site(s), ${res.fonts} font(s)`
            : `  ${id}: nothing to migrate`,
        );
        totals.assets += res.assets;
        totals.sites += res.sites;
        totals.fonts += res.fonts;
        if (pending) migrated += 1;
        continue;
      }
      if (res.changed) {
        migrated += 1;
        totals.assets += res.assets;
        totals.sites += res.sites;
        totals.fonts += res.fonts;
        console.log(
          `  ${id}: migrated ${res.assets} asset(s), ${res.sites} site(s), ${res.fonts} font(s)`,
        );
      } else {
        console.log(`  ${id}: already externalized — skipped`);
      }
    } catch (e) {
      console.error(`  ${id}: FAILED`, e);
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Done. ${migrated} project(s) ${
      dryRun ? "would change" : "changed"
    } — ${totals.assets} assets, ${totals.sites} sites, ${totals.fonts} fonts ${
      dryRun ? "pending" : "moved to storage"
    }.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
