/**
 * Backtest harness runner.
 * Run with: npx tsx scripts/backtest.ts
 *
 * Loads every recorded outcome under data/backtest/, replays it through the
 * launch sim, and reports predicted-vs-actual error per metric + the benchmark
 * refund-calibration A/B. Exits non-zero only on a HARNESS failure (a fixture
 * that won't run) — high error is a finding, not a failure.
 *
 * NOTE: the shipped fixtures are SYNTHETIC placeholders. Real accuracy numbers
 * require captured first-party launches (the moat) dropped into data/backtest/.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runBacktest, type BacktestOutcome } from "../lib/backtest";

const dir = join(process.cwd(), "data", "backtest");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

if (!files.length) {
  console.error(`No backtest fixtures in ${dir}`);
  process.exit(1);
}

let anySynthetic = false;
let failures = 0;

for (const file of files) {
  let outcome: BacktestOutcome;
  try {
    outcome = JSON.parse(readFileSync(join(dir, file), "utf8")) as BacktestOutcome;
  } catch (e) {
    failures++;
    console.error(`✗ ${file}: unreadable — ${e instanceof Error ? e.message : e}`);
    continue;
  }

  let res;
  try {
    res = runBacktest(outcome);
  } catch (e) {
    failures++;
    console.error(`✗ ${file}: harness error — ${e instanceof Error ? e.message : e}`);
    continue;
  }

  anySynthetic = anySynthetic || res.synthetic;
  const tag = res.synthetic ? " [SYNTHETIC]" : "";
  console.log(`\n=== ${res.label}${tag} ===`);
  console.log(`personas: ${res.personaCount} | MAPE: ${res.mapePct == null ? "n/a" : res.mapePct + "%"}`);
  console.log("  metric            predicted        actual      abs % err");
  for (const e of res.errors) {
    console.log(
      `  ${e.metric.padEnd(16)} ${String(e.predicted).padStart(12)} ${String(e.actual).padStart(12)} ${(e.absPctError + "%").padStart(12)}`
    );
  }
  const ab = res.refundAb;
  console.log(
    `  refund A/B: actual ${ab.actual ?? "n/a"}% | calibrated ${ab.calibratedPred}% | uncalibrated ${ab.uncalibratedPred}% → winner: ${ab.winner}`
  );
}

if (anySynthetic) {
  console.log(
    "\n⚠ Fixtures are SYNTHETIC placeholders — replace with captured real launches for true accuracy numbers."
  );
}
if (failures) {
  console.error(`\n${failures} fixture(s) failed to run.`);
  process.exit(1);
}
console.log(`\n${files.length} fixture(s) replayed.`);
