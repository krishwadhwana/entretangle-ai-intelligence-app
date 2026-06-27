// Pure formatting / number / scenario-naming helpers extracted from
// LaunchSimulation.tsx (behavior-preserving; no logic changes).
import type { LaunchSimRecord } from "@/lib/schema";

function parseNumericText(raw: string): number {
  const currencyStripped = raw.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const minusNormalized = currencyStripped.startsWith("-")
    ? `-${currencyStripped.slice(1).replace(/-/g, "")}`
    : currencyStripped.replace(/-/g, "");
  const firstDecimal = minusNormalized.indexOf(".");
  const normalized =
    firstDecimal === -1
      ? minusNormalized
      : `${minusNormalized.slice(0, firstDecimal + 1)}${minusNormalized
          .slice(firstDecimal + 1)
          .replace(/\./g, "")}`;

  if (
    !normalized ||
    normalized === "-" ||
    normalized === "." ||
    normalized === "-."
  ) {
    return 0;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

type Formatters = {
  money: (n: number) => string;
  num: (n: number) => string;
  compact: (n: number) => string;
  compactMoney: (n: number) => string;
  displayCurrency: string;
  sourceCurrency: string;
  moneyRate: number;
};

function makeFormatters(
  displayCurrency: string,
  moneyRate = 1,
  sourceCurrency = displayCurrency
): Formatters {
  let money: (n: number) => string;
  const convert = (n: number) => n * moneyRate;
  try {
    const f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: displayCurrency,
      maximumFractionDigits: 0,
    });
    money = (n) => f.format(convert(n));
  } catch {
    money = (n) =>
      `${displayCurrency} ${Math.round(convert(n)).toLocaleString()}`;
  }
  const compactF = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return {
    money,
    num: (n) => Math.round(n).toLocaleString(),
    compact: (n) => compactF.format(n),
    compactMoney: (n) => compactF.format(convert(n)),
    displayCurrency,
    sourceCurrency,
    moneyRate,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pctToRatio = (v: number) => clamp01(v / 100);

function nextName(scenarios: LaunchSimRecord[]): string {
  return `Scenario ${scenarios.length + 1}`;
}

export { parseNumericText, makeFormatters, pctToRatio, nextName };
export type { Formatters };
