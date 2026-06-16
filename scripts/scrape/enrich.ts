/**
 * Refresh the sourced data snapshots that feed the benchmark layer.
 * Run with: npx tsx scripts/scrape/enrich.ts
 *
 * Pipeline: run each keyless authoritative-API collector → write its snapshot
 * under data/benchmarks/collected/ → only rewrite a file whose content changed
 * (idempotent: the snapshots carry the DATA's own year, not the fetch time, so
 * a re-run with unchanged upstream data produces byte-identical files).
 *
 * These snapshots are `sourced` (see verified.ts SOURCES + ApiSourceRef). They
 * do NOT cover CPM/CAC/CVR — those have no free primary source (see DATA_PLAN).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { collectComtradeImports } from "./collectors/comtrade";
import { collectWorldBankMacro } from "./collectors/worldbank";

const dir = join(process.cwd(), "data", "benchmarks", "collected");

function writeIfChanged(file: string, data: unknown): void {
  const path = join(dir, file);
  const next = JSON.stringify(data, null, 2) + "\n";
  const prev = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (prev === next) {
    console.log(`= ${file} (unchanged)`);
    return;
  }
  writeFileSync(path, next, "utf8");
  console.log(`✓ ${file} updated`);
}

async function main() {
  const comtrade = await collectComtradeImports();
  console.log(`• comtrade: ${Object.keys(comtrade).length} categories`);
  if (Object.keys(comtrade).length) writeIfChanged("comtrade-imports.json", comtrade);

  const worldbank = await collectWorldBankMacro();
  console.log(`• worldbank: ${Object.keys(worldbank).length} indicators`);
  if (Object.keys(worldbank).length) writeIfChanged("worldbank-macro.json", worldbank);
}

main();
