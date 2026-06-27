// Animated launch report (PDF + standalone HTML) builder and its formatting
// helpers, extracted from LaunchSimulation.tsx (behavior-preserving).
import type { Bar as PdfBar, DossierSection } from "../pdf";
import type { LaunchSimInputs } from "@/lib/schema";
import type { Formatters } from "./format";

type PdfRgb = [number, number, number];

const PDF_CHART_COLORS = {
  indigo: [99, 102, 241] as PdfRgb,
  indigoSoft: [199, 210, 254] as PdfRgb,
  violet: [139, 92, 246] as PdfRgb,
  sky: [14, 165, 233] as PdfRgb,
  cyan: [6, 182, 212] as PdfRgb,
  teal: [20, 184, 166] as PdfRgb,
  emerald: [16, 185, 129] as PdfRgb,
  green: [16, 150, 105] as PdfRgb,
  amber: [245, 158, 11] as PdfRgb,
  rose: [244, 114, 182] as PdfRgb,
  red: [220, 38, 38] as PdfRgb,
  slate: [100, 116, 139] as PdfRgb,
};

const PDF_CHART_PALETTE: PdfRgb[] = [
  PDF_CHART_COLORS.indigo,
  PDF_CHART_COLORS.green,
  PDF_CHART_COLORS.sky,
  PDF_CHART_COLORS.amber,
  PDF_CHART_COLORS.violet,
  PDF_CHART_COLORS.teal,
  PDF_CHART_COLORS.rose,
  PDF_CHART_COLORS.slate,
];

function sampleLaunchTimeline<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints || maxPoints < 2) return items;
  const lastIndex = items.length - 1;
  const sampled: T[] = [];
  let previous = -1;
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i / (maxPoints - 1)) * lastIndex);
    if (index !== previous) sampled.push(items[index]);
    previous = index;
  }
  return sampled;
}

function orderBars(
  data: { name: string; orders: number }[],
  colorBy?: (name: string, index: number) => PdfRgb
): PdfBar[] {
  return data
    .slice(0, 8)
    .filter((row) => row.orders > 0)
    .map((row, index) => ({
      label: row.name,
      value: row.orders,
      color: colorBy?.(row.name, index) ?? PDF_CHART_PALETTE[index % PDF_CHART_PALETTE.length],
    }));
}

function addBreakdownSection(
  sections: DossierSection[],
  heading: string,
  data: { name: string; orders: number; revenue: number }[],
  fmt: Formatters,
  colorBy?: (name: string, index: number) => PdfRgb
) {
  const bars = orderBars(data, colorBy);
  if (!bars.length) return;
  sections.push({
    heading,
    bars: {
      title: "Orders",
      data: bars,
    },
    table: {
      columns: ["Group", "Orders", "Revenue"],
      rows: data.slice(0, 8).map((row) => [
        row.name,
        fmt.num(row.orders),
        fmt.money(row.revenue),
      ]),
    },
  });
}

function hexRgb(hex: string, fallback = PDF_CHART_COLORS.indigo): PdfRgb {
  const raw = hex.replace("#", "").trim();
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return fallback;
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

type AnimatedReportTone = "good" | "bad" | "neutral";
type AnimatedReportRow = {
  label: string;
  value: number;
  text: string;
  sub?: string;
  tone?: AnimatedReportTone;
};
type AnimatedTimelinePoint = {
  label: string;
  orders: number;
  refunds: number;
  cumulativeNetProfit: number;
  cumulativeCash: number;
  inventoryOnHand: number;
  stockouts: number;
};
type AnimatedLaunchReportData = {
  title: string;
  subtitle: string;
  verdict: string;
  meta: string[];
  kpis: {
    label: string;
    value: string;
    sub?: string;
    tone: AnimatedReportTone;
  }[];
  timeline: AnimatedTimelinePoint[];
  pnl: AnimatedReportRow[];
  funnel: AnimatedReportRow[];
  acquisition: AnimatedReportRow[];
  mix: AnimatedReportRow[];
  breakdowns: { title: string; rows: AnimatedReportRow[] }[];
  inventory: AnimatedReportRow[];
  diagnostics: { drivers: string[]; risks: string[]; nextMoves: string[] };
  assumptions: string[];
};

function downloadAnimatedLaunchReport(
  report: AnimatedLaunchReportData,
  filename: string
) {
  const html = buildAnimatedLaunchReportHtml(report);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".html") ? filename : `${filename}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function buildAnimatedLaunchReportHtml(report: AnimatedLaunchReportData): string {
  const safeJson = JSON.stringify(report)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const maxAbs = (rows: AnimatedReportRow[]) =>
    Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const barList = (title: string, rows: AnimatedReportRow[], extra = "") => {
    const max = maxAbs(rows);
    return `
      <section class="panel reveal ${extra}">
        <div class="section-head">
          <h2>${esc(title)}</h2>
        </div>
        <div class="bar-list">
          ${rows
            .map((row, index) => {
              const width = Math.max(2, (Math.abs(row.value) / max) * 100);
              const tone = row.tone ?? (row.value < 0 ? "bad" : "neutral");
              return `
                <div class="bar-row" style="--i:${index};--w:${width}%">
                  <div class="bar-label">
                    <strong>${esc(row.label)}</strong>
                    ${row.sub ? `<span>${esc(row.sub)}</span>` : ""}
                  </div>
                  <div class="bar-track">
                    <div class="bar-fill tone-${tone}"></div>
                  </div>
                  <div class="bar-value tone-text-${tone}">${esc(row.text)}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  };
  const listBlock = (title: string, items: string[]) =>
    items.length
      ? `
        <section class="panel reveal">
          <div class="section-head"><h2>${esc(title)}</h2></div>
          <ul class="note-list">
            ${items.map((item) => `<li>${esc(item)}</li>`).join("")}
          </ul>
        </section>
      `
      : "";
  const breakdowns = report.breakdowns
    .filter((section) => section.rows.length)
    .map((section) => barList(section.title, section.rows, "compact-panel"))
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(report.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #171717;
      --muted: #737373;
      --line: #e5e7eb;
      --panel: rgba(255,255,255,0.92);
      --indigo: #6366f1;
      --green: #10b981;
      --red: #dc2626;
      --amber: #f59e0b;
      --sky: #0ea5e9;
      --teal: #14b8a6;
      --rose: #f472b6;
      --shadow: 0 20px 70px rgba(15,23,42,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        linear-gradient(120deg, rgba(99,102,241,0.10), transparent 32%),
        linear-gradient(240deg, rgba(20,184,166,0.12), transparent 30%),
        linear-gradient(180deg, #fafafa, #f8fafc 44%, #fff7ed);
      min-height: 100vh;
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(15,23,42,0.055) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15,23,42,0.045) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(180deg, rgba(0,0,0,0.55), transparent 74%);
      animation: grid-drift 18s linear infinite;
    }
    .shell {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 36px 0 64px;
      position: relative;
    }
    .hero {
      min-height: 88vh;
      display: grid;
      align-content: center;
      gap: 26px;
      padding-bottom: 28px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
      gap: 24px;
      align-items: stretch;
    }
    .eyebrow {
      color: var(--indigo);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1 {
      font-size: clamp(42px, 8vw, 92px);
      line-height: 0.92;
      letter-spacing: 0;
      margin: 10px 0 16px;
      max-width: 920px;
    }
    h2 {
      font-size: 15px;
      line-height: 1.2;
      margin: 0;
    }
    p { margin: 0; }
    .subtitle {
      max-width: 760px;
      color: #404040;
      font-size: 17px;
      line-height: 1.65;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
    }
    .pill {
      border: 1px solid rgba(99,102,241,0.22);
      background: rgba(255,255,255,0.72);
      border-radius: 999px;
      padding: 7px 11px;
      color: #4b5563;
      font-size: 12px;
      font-weight: 700;
      backdrop-filter: blur(12px);
    }
    .verdict {
      border-left: 4px solid var(--indigo);
      background: rgba(255,255,255,0.76);
      border-radius: 8px;
      padding: 18px 20px;
      color: #27272a;
      line-height: 1.55;
      box-shadow: var(--shadow);
      animation: rise .7s ease both .12s;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .kpi {
      min-height: 124px;
      border: 1px solid rgba(229,231,235,0.9);
      background: rgba(255,255,255,0.82);
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 12px 40px rgba(15,23,42,0.08);
      animation: rise .7s cubic-bezier(.2,.8,.2,1) both;
      animation-delay: calc(var(--i) * 80ms + 160ms);
      position: relative;
      overflow: hidden;
    }
    .kpi::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(110deg, transparent, rgba(255,255,255,.68), transparent);
      transform: translateX(-120%);
      animation: shimmer 4s ease-in-out infinite;
      animation-delay: calc(var(--i) * 220ms + 1s);
    }
    .kpi span {
      color: #a3a3a3;
      display: block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .kpi strong {
      display: block;
      margin-top: 8px;
      font-size: clamp(24px, 3vw, 38px);
      line-height: 1;
    }
    .kpi em {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      font-style: normal;
    }
    .tone-good strong, .tone-text-good { color: var(--green); }
    .tone-bad strong, .tone-text-bad { color: var(--red); }
    .tone-neutral strong, .tone-text-neutral { color: var(--ink); }
    .playback {
      position: sticky;
      top: 12px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 12px;
      border: 1px solid rgba(229,231,235,0.9);
      background: rgba(255,255,255,0.82);
      border-radius: 12px;
      padding: 10px;
      box-shadow: 0 10px 40px rgba(15,23,42,0.10);
      backdrop-filter: blur(18px);
      margin-bottom: 20px;
    }
    button {
      border: 0;
      border-radius: 9px;
      background: var(--indigo);
      color: white;
      font-weight: 800;
      padding: 10px 13px;
      cursor: pointer;
    }
    button.secondary {
      color: #374151;
      background: #f3f4f6;
    }
    .progress-shell {
      height: 9px;
      background: #eef2ff;
      border-radius: 999px;
      flex: 1;
      overflow: hidden;
    }
    #progressBar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--indigo), var(--teal), var(--amber));
      border-radius: inherit;
      transition: width .12s linear;
    }
    #clock {
      min-width: 84px;
      text-align: right;
      color: #4b5563;
      font-size: 12px;
      font-weight: 800;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }
    .panel {
      border: 1px solid rgba(229,231,235,0.95);
      background: var(--panel);
      border-radius: 10px;
      padding: 18px;
      box-shadow: 0 12px 42px rgba(15,23,42,0.08);
      overflow: hidden;
    }
    .wide { grid-column: 1 / -1; }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-head small {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    svg.chart {
      width: 100%;
      height: 310px;
      display: block;
      overflow: visible;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: #525252;
      font-size: 12px;
      font-weight: 700;
    }
    .legend i {
      display: inline-block;
      width: 22px;
      height: 4px;
      border-radius: 999px;
      margin-right: 6px;
      vertical-align: middle;
    }
    .bar-list {
      display: grid;
      gap: 11px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: minmax(116px, 1fr) minmax(140px, 2fr) minmax(76px, auto);
      align-items: center;
      gap: 12px;
      animation: rise .55s ease both;
      animation-delay: calc(var(--i) * 55ms);
    }
    .bar-label strong {
      display: block;
      color: #404040;
      font-size: 12px;
      line-height: 1.2;
    }
    .bar-label span {
      color: #8b8b8b;
      display: block;
      font-size: 11px;
      line-height: 1.3;
      margin-top: 2px;
    }
    .bar-track {
      height: 13px;
      border-radius: 999px;
      background: #f1f5f9;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      width: var(--w);
      min-width: 2px;
      border-radius: inherit;
      transform-origin: left center;
      animation: grow 1.1s cubic-bezier(.2,.8,.2,1) both;
      animation-delay: calc(var(--i) * 55ms + .22s);
    }
    .bar-value {
      color: #404040;
      font-size: 12px;
      font-weight: 800;
      text-align: right;
      white-space: nowrap;
    }
    .bar-fill.tone-good { background: linear-gradient(90deg, #34d399, #10b981); }
    .bar-fill.tone-bad { background: linear-gradient(90deg, #fda4af, #dc2626); }
    .bar-fill.tone-neutral { background: linear-gradient(90deg, #a5b4fc, #6366f1); }
    .note-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 10px;
    }
    .note-list li {
      border-left: 3px solid var(--indigo);
      background: #f8fafc;
      border-radius: 7px;
      color: #404040;
      line-height: 1.45;
      padding: 10px 12px;
      animation: rise .55s ease both;
    }
    .footer {
      color: #737373;
      font-size: 12px;
      text-align: center;
      padding: 32px 0 0;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(18px) scale(.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes grow {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }
    @keyframes shimmer {
      0%, 38% { transform: translateX(-120%); }
      62%, 100% { transform: translateX(120%); }
    }
    @keyframes grid-drift {
      from { background-position: 0 0, 0 0; }
      to { background-position: 44px 44px, 44px 44px; }
    }
    @media (max-width: 820px) {
      .hero { min-height: auto; padding-top: 34px; }
      .hero-grid, .grid { grid-template-columns: 1fr; }
      .kpi-grid { grid-template-columns: 1fr; }
      .playback { align-items: stretch; flex-wrap: wrap; }
      .progress-shell { flex-basis: 100%; order: 3; }
      #clock { text-align: left; }
      .bar-row { grid-template-columns: 1fr; gap: 6px; }
      .bar-value { text-align: left; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <div class="eyebrow">Animated Launch Report</div>
        <h1>${esc(report.title)}</h1>
        <p class="subtitle">${esc(report.subtitle)}</p>
        <div class="meta">${report.meta.map((item) => `<span class="pill">${esc(item)}</span>`).join("")}</div>
      </div>
      <div class="hero-grid">
        <div class="verdict">${esc(report.verdict || "No verdict generated for this scenario.")}</div>
        <div class="kpi-grid">
          ${report.kpis
            .map(
              (kpi, index) => `
                <article class="kpi tone-${kpi.tone}" style="--i:${index}">
                  <span>${esc(kpi.label)}</span>
                  <strong>${esc(kpi.value)}</strong>
                  ${kpi.sub ? `<em>${esc(kpi.sub)}</em>` : ""}
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    </section>

    <div class="playback">
      <button id="playToggle">Pause</button>
      <button id="replay" class="secondary">Replay</button>
      <div class="progress-shell"><div id="progressBar"></div></div>
      <div id="clock">Start</div>
    </div>

    <section class="panel wide reveal">
      <div class="section-head">
        <h2>Demand playback</h2>
        <small>orders and refunds</small>
      </div>
      <svg id="demandChart" class="chart" role="img" aria-label="Animated demand chart"></svg>
      <div class="legend"><span><i style="background:#6366f1"></i>Orders</span><span><i style="background:#dc2626"></i>Refunds</span></div>
    </section>

    <section class="panel wide reveal">
      <div class="section-head">
        <h2>Cash payback playback</h2>
        <small>cumulative profit and cash</small>
      </div>
      <svg id="cashChart" class="chart" role="img" aria-label="Animated cash payback chart"></svg>
      <div class="legend"><span><i style="background:#10b981"></i>Cumulative net profit</span><span><i style="background:#f59e0b"></i>Cumulative cash</span></div>
    </section>

    <section class="panel wide reveal">
      <div class="section-head">
        <h2>Inventory playback</h2>
        <small>inventory and stockouts</small>
      </div>
      <svg id="inventoryChart" class="chart" role="img" aria-label="Animated inventory chart"></svg>
      <div class="legend"><span><i style="background:#14b8a6"></i>Inventory on hand</span><span><i style="background:#dc2626"></i>Stockouts</span></div>
    </section>

    <div class="grid">
      ${barList("Revenue, costs, and profit", report.pnl)}
      ${barList("Acquisition funnel", report.funnel)}
      ${report.acquisition.length ? barList("Acquisition by channel", report.acquisition) : ""}
      ${barList("New vs returning", report.mix)}
      ${barList("Inventory and returns", report.inventory)}
      ${breakdowns}
      ${listBlock("What's driving it", report.diagnostics.drivers)}
      ${listBlock("Risks", report.diagnostics.risks)}
      ${listBlock("Next moves", report.diagnostics.nextMoves)}
      ${listBlock("Assumptions", report.assumptions)}
    </div>
    <p class="footer">Generated by EntreTangle - open this HTML file in any modern browser to replay the launch.</p>
  </main>
  <script>
    const report = ${safeJson};
    const timeline = report.timeline.length ? report.timeline : [{label:"Start",orders:0,refunds:0,cumulativeNetProfit:0,cumulativeCash:0,inventoryOnHand:0,stockouts:0}];
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ns = "http://www.w3.org/2000/svg";
    let playing = !reduceMotion;
    let progress = reduceMotion ? 1 : 0;
    let startedAt = 0;
    const duration = Math.min(Math.max(timeline.length * 130, 5200), 14000);
    const progressBar = document.getElementById("progressBar");
    const clock = document.getElementById("clock");
    const playToggle = document.getElementById("playToggle");

    function compact(n) {
      const value = Number(n) || 0;
      const abs = Math.abs(value);
      if (abs >= 10000000) return (value / 10000000).toFixed(1) + "Cr";
      if (abs >= 100000) return (value / 100000).toFixed(1) + "L";
      if (abs >= 1000) return (value / 1000).toFixed(1) + "k";
      return Math.round(value).toLocaleString();
    }
    function make(tag, attrs) {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs || {}).forEach(function(entry) {
        el.setAttribute(entry[0], String(entry[1]));
      });
      return el;
    }
    function text(svg, value, x, y, attrs) {
      const el = make("text", Object.assign({ x, y, fill: "#9ca3af", "font-size": 10, "font-weight": 700 }, attrs || {}));
      el.textContent = value;
      svg.appendChild(el);
    }
    function dimensions(svg) {
      const rect = svg.getBoundingClientRect();
      const width = Math.max(620, Math.round(rect.width || 900));
      const height = 310;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      svg.innerHTML = "";
      return { width, height, left: 58, right: 18, top: 16, bottom: 42 };
    }
    function scaleFor(fields) {
      const values = [];
      timeline.forEach(function(point) {
        fields.forEach(function(field) { values.push(Number(point[field]) || 0); });
      });
      let min = Math.min(0, ...values);
      let max = Math.max(0, ...values);
      if (min === max) max = min + 1;
      return { min, max };
    }
    function drawGrid(svg, box, scale) {
      const plotW = box.width - box.left - box.right;
      const plotH = box.height - box.top - box.bottom;
      for (let i = 0; i <= 4; i += 1) {
        const y = box.top + (i / 4) * plotH;
        svg.appendChild(make("line", { x1: box.left, y1: y, x2: box.left + plotW, y2: y, stroke: "#e5e7eb", "stroke-width": 1 }));
        const val = scale.max - (i / 4) * (scale.max - scale.min);
        text(svg, compact(val), box.left - 10, y + 4, { "text-anchor": "end" });
      }
      if (scale.min < 0 && scale.max > 0) {
        const zeroY = box.top + plotH - ((0 - scale.min) / (scale.max - scale.min)) * plotH;
        svg.appendChild(make("line", { x1: box.left, y1: zeroY, x2: box.left + plotW, y2: zeroY, stroke: "#94a3b8", "stroke-width": 1.2 }));
      }
      text(svg, timeline[0].label, box.left, box.height - 14, {});
      text(svg, timeline[timeline.length - 1].label, box.left + plotW, box.height - 14, { "text-anchor": "end" });
    }
    function drawLineChart(id, series, p) {
      const svg = document.getElementById(id);
      const box = dimensions(svg);
      const fields = series.map(function(item) { return item.field; });
      const scale = scaleFor(fields);
      const plotW = box.width - box.left - box.right;
      const plotH = box.height - box.top - box.bottom;
      const visible = Math.max(2, Math.ceil(timeline.length * p));
      drawGrid(svg, box, scale);
      function x(i) {
        return box.left + (timeline.length <= 1 ? 0 : (i / (timeline.length - 1)) * plotW);
      }
      function y(v) {
        return box.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
      }
      series.forEach(function(item) {
        let d = "";
        for (let i = 0; i < visible; i += 1) {
          const cmd = i === 0 ? "M" : "L";
          d += cmd + x(i).toFixed(2) + " " + y(Number(timeline[i][item.field]) || 0).toFixed(2) + " ";
        }
        svg.appendChild(make("path", { d, fill: "none", stroke: item.color, "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      });
    }
    function drawDemand(p) {
      const svg = document.getElementById("demandChart");
      const box = dimensions(svg);
      const scale = scaleFor(["orders", "refunds"]);
      const plotW = box.width - box.left - box.right;
      const plotH = box.height - box.top - box.bottom;
      const visible = Math.max(1, Math.ceil(timeline.length * p));
      drawGrid(svg, box, scale);
      const slot = plotW / Math.max(timeline.length, 1);
      const barW = Math.max(2, slot * 0.58);
      function y(v) {
        return box.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
      }
      for (let i = 0; i < visible; i += 1) {
        const point = timeline[i];
        const x = box.left + i * slot + (slot - barW) / 2;
        const orderH = Math.max(1, box.top + plotH - y(point.orders));
        svg.appendChild(make("rect", { x, y: y(point.orders), width: barW, height: orderH, rx: 4, fill: "#6366f1", opacity: .86 }));
        if (point.refunds > 0) {
          const refundH = Math.max(1, box.top + plotH - y(point.refunds));
          svg.appendChild(make("rect", { x: x + barW * .56, y: y(point.refunds), width: barW * .38, height: refundH, rx: 4, fill: "#dc2626", opacity: .86 }));
        }
      }
    }
    function render(p) {
      progress = Math.max(0, Math.min(1, p));
      drawDemand(progress);
      drawLineChart("cashChart", [
        { field: "cumulativeNetProfit", color: "#10b981" },
        { field: "cumulativeCash", color: "#f59e0b" }
      ], progress);
      drawLineChart("inventoryChart", [
        { field: "inventoryOnHand", color: "#14b8a6" },
        { field: "stockouts", color: "#dc2626" }
      ], progress);
      const idx = Math.min(timeline.length - 1, Math.max(0, Math.ceil(timeline.length * progress) - 1));
      progressBar.style.width = Math.round(progress * 100) + "%";
      clock.textContent = timeline[idx].label;
    }
    function tick(ts) {
      if (!playing) return;
      if (!startedAt) startedAt = ts;
      const p = ((ts - startedAt) % duration) / duration;
      render(p);
      window.requestAnimationFrame(tick);
    }
    playToggle.addEventListener("click", function() {
      playing = !playing;
      playToggle.textContent = playing ? "Pause" : "Play";
      if (playing) {
        startedAt = performance.now() - progress * duration;
        window.requestAnimationFrame(tick);
      }
    });
    document.getElementById("replay").addEventListener("click", function() {
      progress = 0;
      playing = true;
      playToggle.textContent = "Pause";
      startedAt = 0;
      window.requestAnimationFrame(tick);
    });
    window.addEventListener("resize", function() { render(progress); });
    render(progress);
    if (playing) window.requestAnimationFrame(tick);
  </script>
</body>
</html>`;
}

function esc(value: string | number | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, " ");
}

function formatAssumptionValue(
  value: string | number,
  unit: string,
  fmt: Formatters
): string {
  if (typeof value === "string") return value;
  const unitCurrency =
    unit === fmt.sourceCurrency || unit.startsWith(`${fmt.sourceCurrency}/`);
  const formatted =
    Math.abs(value) < 10 && !Number.isInteger(value)
      ? value.toFixed(2).replace(/\.?0+$/, "")
      : fmt.num(value);
  if (
    unitCurrency &&
    fmt.displayCurrency !== fmt.sourceCurrency &&
    fmt.moneyRate !== 1
  ) {
    return `${fmt.money(value)} (${formatted} ${unit})`;
  }
  return unit ? `${formatted} ${unit}` : formatted;
}

function buildAdvancedSettingsBullets(
  raw: LaunchSimInputs,
  used: LaunchSimInputs,
  fmt: Formatters
): string[] {
  const stepUnit = used.granularity === "day" ? "day" : "month";
  const moneyPer = (value: number, unit: string) => `${fmt.money(value)}/${unit}`;
  const auto = (isAuto: boolean, label = "auto-resolved") =>
    isAuto ? ` (${label})` : "";
  const channels =
    used.channels.length > 0
      ? used.channels
          .map((c) => {
            const paid =
              c.kind === "paid" || c.kind === "marketplace" || c.kind === "retail";
            const spend = paid ? `, ${pctLabel(c.spendPct)} spend` : "";
            return `${c.label} (${c.kind}${spend}, ${fmt.money(c.cpm)} CPM, ${smartNumber(c.frequencyCap)} freq)`;
          })
          .join("; ")
      : "None";
  const rentalLines =
    used.businessModel === "rental"
      ? [
          `Rental - Assets: ${fmt.num(used.rentalAssetCount)} reusable assets`,
          `Rental - Asset cost: ${moneyPer(used.rentalAssetCost, "asset")}`,
          `Rental - Pricing basis: ${
            used.rentalPricingBasis === "per_day" ? "per day" : "per booking"
          }`,
          `Rental - Revenue/booking: ${fmt.money(
            used.rentalPricingBasis === "per_day"
              ? used.salePrice * used.rentalAvgDurationDays
              : used.salePrice
          )}`,
          `Rental - Rentable days: ${smartNumber(used.rentalRentableDaysPerMonth)} days/asset/month`,
          `Rental - Avg duration: ${smartNumber(used.rentalAvgDurationDays)} days/booking`,
          `Rental - Downtime: ${smartNumber(used.rentalDowntimeDaysPerBooking)} days/booking`,
          `Rental - Capacity: ${fmt.num(
            (used.rentalAssetCount * used.rentalRentableDaysPerMonth) /
              Math.max(
                used.rentalAvgDurationDays + used.rentalDowntimeDaysPerBooking,
                1 / 30
              )
          )} bookings/month`,
          `Rental - Maintenance: ${moneyPer(used.rentalMaintenancePerOrder, "booking")}`,
          `Rental - Damage/loss risk: ${smartNumber(used.rentalDamageLossPct)}%`,
          `Rental - Deposit cover: ${fmt.money(used.rentalDepositAmount)}`,
        ]
      : [];
  const modelLines =
    used.businessModel === "subscription"
      ? [
          `Subscription - Monthly churn: ${smartNumber(
            used.subscriptionMonthlyChurnPct
          )}%`,
        ]
      : used.businessModel === "booking"
        ? [
            `Booking - Capacity: ${fmt.num(
              used.bookingCapacityPerMonth
            )} bookings/month`,
          ]
        : used.businessModel === "usage_based"
          ? [
              `Usage - Frequency: ${smartNumber(
                used.usageEventsPerCustomerPerMonth
              )} uses/customer/month`,
              `Usage - Monthly churn: ${smartNumber(used.usageMonthlyChurnPct)}%`,
            ]
          : used.businessModel === "lead_gen"
            ? [
                "Lead-gen - Monetized unit: qualified lead / commission event",
              ]
            : used.businessModel === "project_services"
              ? [
                  `Project services - Capacity: ${smartNumber(
                    used.projectCapacityPerMonth
                  )} projects/month`,
                ]
              : [];

  return [
    `Acquisition - Reachable pool: ${fmt.num(used.reachablePool ?? 0)} people${auto(raw.reachablePool == null, "auto-sized")}`,
    `Acquisition - CPM: ${moneyPer(used.cpm, "1k impressions")}`,
    `Acquisition - Paid CAC: ${
      used.paidCac == null ? "Benchmark/model cap" : fmt.money(used.paidCac)
    }${auto(raw.paidCac == null, "benchmark/model")}`,
    `Acquisition - Frequency cap: ${smartNumber(used.frequencyCap)} impressions/person`,
    `Acquisition - Organic reach: ${fmt.num(used.organicReachPerStep)} people/${stepUnit}`,
    `Acquisition - Paid platforms: ${used.adPlatforms.join(", ") || "None"}`,
    `Acquisition - Channels: ${channels}`,
    `Funnel behavior - Targeting quality: ${pctLabel(used.targetingQuality)}`,
    `Funnel behavior - Virality k: ${smartNumber(used.viralityK)} people/buyer`,
    `Funnel behavior - Decision speed: ${pctLabel(used.decisionSpeed ?? 0)}/${stepUnit}${auto(raw.decisionSpeed == null)}`,
    `Funnel behavior - Abandon rate: ${pctLabel(used.abandonRate)}/${stepUnit}`,
    `Funnel behavior - Launch month: ${used.launchStartMonth ? monthLabel(used.launchStartMonth) : "Seasonality off"}${auto(raw.launchStartMonth == null, "seasonality default")}`,
    `Funnel behavior - Attention momentum: ${signedPercent(used.demandMomentumPct)} demand tilt`,
    `Funnel behavior - Growth / month: ${signedPercent(used.monthlyGrowthPct ?? 0)}${auto(raw.monthlyGrowthPct == null, "audience-derived")}`,
    `Operations & costs - Shipping/order: ${moneyPer(used.shippingPerOrder, "order")}`,
    `Operations & costs - Payment fee: ${pctLabel(used.paymentFeePct)}`,
    `Operations & costs - Fixed costs: ${moneyPer(used.fixedCostsPerMonth, "month")}`,
    `Operations & costs - Launch reserve: ${
      used.launchInvestmentReserve == null
        ? "None"
        : fmt.money(used.launchInvestmentReserve)
    }${auto(raw.launchInvestmentReserve == null, "not entered")}`,
    `Operations & costs - Initial inventory: ${fmt.num(used.initialInventoryUnits ?? 0)} units${auto(raw.initialInventoryUnits == null, "auto-sized")}`,
    `Operations & costs - Reordering: ${used.reorderEnabled ? "On" : "Off"}`,
    `Operations & costs - Reorder lead: ${fmt.num(used.reorderLeadTimeDays)} days`,
    `Operations & costs - Minimum order quantity: ${fmt.num(used.minOrderQtyUnits ?? 0)} units/batch${auto(raw.minOrderQtyUnits == null, "auto-sized")}`,
    ...rentalLines,
    ...modelLines,
    `Returns & retention - Return window: ${fmt.num(used.returnWindowDays)} days`,
    `Returns & retention - Target refund rate: ${
      used.targetRefundRatePct == null
        ? "Persona baseline"
        : `${smartNumber(used.targetRefundRatePct)}%`
    }${auto(raw.targetRefundRatePct == null, "benchmark/default")}`,
    `Returns & retention - Refund multiplier: ${smartNumber(used.refundRateMult)}x`,
    `Returns & retention - Resellable returns: ${pctLabel(used.resellablePct)}`,
    `Returns & retention - Return shipping/order: ${moneyPer(
      used.returnShippingPerOrder ?? used.shippingPerOrder,
      "return"
    )}${auto(raw.returnShippingPerOrder == null, "same as outbound")}`,
    `Returns & retention - Repeat rate multiplier: ${smartNumber(used.repeatRateMult)}x`,
    `Engine - Trajectory jitter: ${pctLabel(used.jitterAmplitude)}`,
  ];
}

function pctLabel(value: number): string {
  return `${smartNumber(value * 100)}%`;
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${smartNumber(value)}%`;
}

function smartNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const maxFractionDigits = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 1;
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function monthLabel(month: number): string {
  return (
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][month - 1] ?? `Month ${month}`
  );
}


export {
  PDF_CHART_COLORS,
  sampleLaunchTimeline,
  orderBars,
  addBreakdownSection,
  hexRgb,
  downloadAnimatedLaunchReport,
  sourceLabel,
  formatAssumptionValue,
  buildAdvancedSettingsBullets,
};
