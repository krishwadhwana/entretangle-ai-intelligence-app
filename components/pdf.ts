"use client";

import { jsPDF } from "jspdf";

// ---------------------------------------------------------------------------
// Graphical PDF dossier builder. Components assemble a Dossier from their data
// and call downloadDossier — this module stays data-agnostic. Everything is
// drawn as crisp vectors (no rasterised screenshots, no extra deps), so files
// stay small and text stays selectable. Sections can carry KPI cards, bar /
// line / share charts, and tables in addition to text + bullets.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

export type KPI = {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
};
export type Bar = { label: string; value: number; color?: RGB };
export type Series = { name: string; color: RGB; points: number[] };

export type DossierSection = {
  heading?: string;
  body?: string;
  bullets?: string[];
  kpis?: KPI[];
  /** Horizontal bar chart. */
  bars?: { title?: string; unit?: string; data: Bar[]; money?: boolean };
  /** Stacked 100%-share bar with a legend (channel/platform share, etc.). */
  share?: { title?: string; data: Bar[] };
  /** Multi-series line chart (shared y-scale across series). */
  line?: { title?: string; xLabels?: string[]; series: Series[]; money?: boolean };
  /** Simple table. */
  table?: { columns: string[]; rows: (string | number)[][] };
  /** Force a page break before this section. */
  pageBreak?: boolean;
};

export type Dossier = {
  title: string;
  subtitle?: string;
  meta?: string[]; // small grey line on the cover, joined with " · "
  accent?: RGB; // brand accent (default indigo)
  cover?: { verdict?: string; kpis?: KPI[]; tagline?: string };
  sections: DossierSection[];
};

const MARGIN = 48;
const LINE = 1.38;
const INK: RGB = [23, 23, 23];
const MUTE: RGB = [110, 110, 110];
const FAINT: RGB = [150, 150, 150];
const HAIR: RGB = [228, 228, 231];
const CARD: RGB = [247, 247, 249];
const GOOD: RGB = [16, 150, 105];
const BAD: RGB = [220, 60, 75];
const INDIGO: RGB = [79, 70, 229];

// A palette for charts (cycled when a bar has no explicit colour).
const PALETTE: RGB[] = [
  [99, 102, 241], [16, 185, 129], [244, 114, 95], [245, 158, 11],
  [14, 165, 233], [168, 85, 247], [236, 72, 153], [100, 116, 139],
];

function toneColor(t?: KPI["tone"]): RGB {
  return t === "good" ? GOOD : t === "bad" ? BAD : INK;
}
function fmtNum(n: number): string {
  if (!isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${Math.round(n).toLocaleString()}`;
  return `${Math.round(n * 100) / 100}`;
}

class Doc {
  d: jsPDF;
  pageW: number;
  pageH: number;
  maxW: number;
  y: number;
  accent: RGB;
  constructor(accent: RGB) {
    this.d = new jsPDF({ unit: "pt", format: "a4" });
    this.pageW = this.d.internal.pageSize.getWidth();
    this.pageH = this.d.internal.pageSize.getHeight();
    this.maxW = this.pageW - MARGIN * 2;
    this.y = MARGIN;
    this.accent = accent;
  }
  fill(c: RGB) { this.d.setFillColor(c[0], c[1], c[2]); }
  stroke(c: RGB) { this.d.setDrawColor(c[0], c[1], c[2]); }
  ink(c: RGB) { this.d.setTextColor(c[0], c[1], c[2]); }
  font(bold = false, size = 10.5) {
    this.d.setFont("helvetica", bold ? "bold" : "normal");
    this.d.setFontSize(size);
  }
  page() {
    this.d.addPage();
    this.y = MARGIN;
  }
  ensure(h: number) {
    if (this.y + h > this.pageH - MARGIN - 18) this.page();
  }
  // Wrapped text block; returns height consumed.
  text(
    str: string,
    size: number,
    o: { bold?: boolean; color?: RGB; gap?: number; indent?: number; lineGap?: number } = {}
  ) {
    if (!str) return;
    const indent = o.indent ?? 0;
    this.font(o.bold, size);
    this.ink(o.color ?? INK);
    const lines = this.d.splitTextToSize(str, this.maxW - indent) as string[];
    const lh = size * (o.lineGap ?? LINE);
    for (const ln of lines) {
      this.ensure(lh);
      this.d.text(ln, MARGIN + indent, this.y + size);
      this.y += lh;
    }
    if (o.gap) this.y += o.gap;
  }
}

// --- section primitives -----------------------------------------------------

function sectionHeading(D: Doc, heading: string) {
  D.ensure(34);
  D.y += 6;
  // accent tab
  D.fill(D.accent);
  D.d.rect(MARGIN, D.y, 3.5, 13, "F");
  D.font(true, 13);
  D.ink(INK);
  D.d.text(heading, MARGIN + 10, D.y + 11);
  D.y += 22;
}

function bullets(D: Doc, items: string[]) {
  for (const b of items) {
    D.font(false, 10.5);
    D.ink([55, 55, 55]);
    const lines = D.d.splitTextToSize(b, D.maxW - 18) as string[];
    const lh = 10.5 * LINE;
    lines.forEach((ln, i) => {
      D.ensure(lh);
      if (i === 0) {
        D.fill(D.accent);
        D.d.circle(MARGIN + 3, D.y + 5.5, 1.6, "F");
      }
      D.ink([55, 55, 55]);
      D.d.text(ln, MARGIN + 14, D.y + 9);
      D.y += lh;
    });
  }
  D.y += 4;
}

function kpiRow(D: Doc, kpis: KPI[]) {
  const perRow = kpis.length <= 3 ? kpis.length : 4;
  const gap = 10;
  const cardW = (D.maxW - gap * (perRow - 1)) / perRow;
  const cardH = 52;
  for (let i = 0; i < kpis.length; i += perRow) {
    const row = kpis.slice(i, i + perRow);
    D.ensure(cardH + 10);
    row.forEach((k, j) => {
      const x = MARGIN + j * (cardW + gap);
      D.fill(CARD);
      D.d.roundedRect(x, D.y, cardW, cardH, 5, 5, "F");
      D.font(false, 7.5);
      D.ink(FAINT);
      D.d.text(k.label.toUpperCase(), x + 10, D.y + 16);
      D.font(true, 15);
      D.ink(toneColor(k.tone));
      D.d.text(k.value, x + 10, D.y + 34);
      if (k.sub) {
        D.font(false, 7.5);
        D.ink(MUTE);
        D.d.text(
          (D.d.splitTextToSize(k.sub, cardW - 16) as string[])[0] ?? k.sub,
          x + 10,
          D.y + 46
        );
      }
    });
    D.y += cardH + 10;
  }
}

function barChart(D: Doc, c: NonNullable<DossierSection["bars"]>) {
  if (c.title) D.text(c.title, 9.5, { bold: true, color: MUTE, gap: 4 });
  const data = c.data.filter((d) => isFinite(d.value));
  if (!data.length) return;
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const labelW = 110;
  const valW = 64;
  const trackW = D.maxW - labelW - valW;
  const rowH = 17;
  for (const [i, d] of data.entries()) {
    D.ensure(rowH);
    const col = d.color ?? PALETTE[i % PALETTE.length];
    D.font(false, 8.5);
    D.ink([60, 60, 60]);
    const lbl = (D.d.splitTextToSize(d.label, labelW - 6) as string[])[0] ?? d.label;
    D.d.text(lbl, MARGIN, D.y + 9);
    // track
    D.fill([238, 238, 241]);
    D.d.roundedRect(MARGIN + labelW, D.y + 2, trackW, 9, 2, 2, "F");
    // value bar
    const w = Math.max(1.5, (Math.abs(d.value) / max) * trackW);
    D.fill(col);
    D.d.roundedRect(MARGIN + labelW, D.y + 2, w, 9, 2, 2, "F");
    // value
    D.font(true, 8.5);
    D.ink([60, 60, 60]);
    D.d.text(
      c.money ? fmtNum(d.value) : `${fmtNum(d.value)}${c.unit ?? ""}`,
      MARGIN + labelW + trackW + 8,
      D.y + 9
    );
    D.y += rowH;
  }
  D.y += 6;
}

function shareBar(D: Doc, c: NonNullable<DossierSection["share"]>) {
  if (c.title) D.text(c.title, 9.5, { bold: true, color: MUTE, gap: 4 });
  const data = c.data.filter((d) => d.value > 0).slice(0, 8);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const barH = 16;
  D.ensure(barH + 8);
  let x = MARGIN;
  data.forEach((d, i) => {
    const w = (d.value / total) * D.maxW;
    D.fill(d.color ?? PALETTE[i % PALETTE.length]);
    D.d.rect(x, D.y, w, barH, "F");
    x += w;
  });
  D.y += barH + 10;
  // legend (wrap)
  let lx = MARGIN;
  data.forEach((d, i) => {
    const pct = `${Math.round((d.value / total) * 100)}%`;
    const label = `${d.label} ${pct}`;
    D.font(false, 8);
    const w = D.d.getTextWidth(label) + 16;
    if (lx + w > MARGIN + D.maxW) {
      lx = MARGIN;
      D.y += 13;
    }
    D.ensure(12);
    D.fill(d.color ?? PALETTE[i % PALETTE.length]);
    D.d.roundedRect(lx, D.y, 7, 7, 1.5, 1.5, "F");
    D.ink([70, 70, 70]);
    D.d.text(label, lx + 11, D.y + 6.5);
    lx += w;
  });
  D.y += 18;
}

function lineChart(D: Doc, c: NonNullable<DossierSection["line"]>) {
  if (c.title) D.text(c.title, 9.5, { bold: true, color: MUTE, gap: 4 });
  const series = c.series.filter((s) => s.points.length > 1);
  if (!series.length) return;
  const plotH = 150;
  const plotW = D.maxW - 8;
  D.ensure(plotH + 34);
  const x0 = MARGIN + 8;
  const y0 = D.y;
  const all = series.flatMap((s) => s.points);
  let min = Math.min(...all, 0);
  let max = Math.max(...all, 0);
  if (max === min) max = min + 1;
  const n = Math.max(...series.map((s) => s.points.length));
  const mapX = (i: number) => x0 + (i / (n - 1)) * plotW;
  const mapY = (v: number) => y0 + plotH - ((v - min) / (max - min)) * plotH;
  // gridlines + axis labels (4 bands)
  D.stroke(HAIR);
  D.d.setLineWidth(0.5);
  for (let g = 0; g <= 4; g++) {
    const gy = y0 + (g / 4) * plotH;
    D.d.line(x0, gy, x0 + plotW, gy);
    const val = max - (g / 4) * (max - min);
    D.font(false, 6.5);
    D.ink(FAINT);
    D.d.text(c.money ? fmtNum(val) : `${fmtNum(val)}`, MARGIN - 4, gy + 2, { align: "right" });
  }
  // zero line emphasis
  if (min < 0 && max > 0) {
    D.stroke([200, 200, 205]);
    D.d.setLineWidth(0.8);
    const zy = mapY(0);
    D.d.line(x0, zy, x0 + plotW, zy);
  }
  // series polylines
  D.d.setLineWidth(1.6);
  for (const s of series) {
    D.stroke(s.color);
    for (let i = 1; i < s.points.length; i++) {
      D.d.line(mapX(i - 1), mapY(s.points[i - 1]), mapX(i), mapY(s.points[i]));
    }
  }
  D.y = y0 + plotH + 6;
  // x labels (first / mid / last)
  if (c.xLabels?.length) {
    D.font(false, 7);
    D.ink(FAINT);
    const xs = c.xLabels;
    D.d.text(xs[0] ?? "", x0, D.y + 6);
    D.d.text(xs[Math.floor(xs.length / 2)] ?? "", x0 + plotW / 2, D.y + 6, { align: "center" });
    D.d.text(xs[xs.length - 1] ?? "", x0 + plotW, D.y + 6, { align: "right" });
    D.y += 12;
  }
  // legend
  let lx = MARGIN + 8;
  for (const s of series) {
    D.fill(s.color);
    D.d.rect(lx, D.y, 12, 3, "F");
    D.font(false, 8);
    D.ink([70, 70, 70]);
    D.d.text(s.name, lx + 16, D.y + 4);
    lx += 16 + D.d.getTextWidth(s.name) + 18;
  }
  D.y += 16;
}

function table(D: Doc, t: NonNullable<DossierSection["table"]>) {
  const cols = t.columns.length;
  const colW = D.maxW / cols;
  const rowH = 18;
  // header
  D.ensure(rowH);
  D.fill(D.accent);
  D.d.rect(MARGIN, D.y, D.maxW, rowH, "F");
  D.font(true, 8.5);
  D.ink([255, 255, 255]);
  t.columns.forEach((h, i) => {
    const align = i === 0 ? "left" : "right";
    const x = i === 0 ? MARGIN + 6 : MARGIN + (i + 1) * colW - 6;
    D.d.text(String(h), x, D.y + 12, { align });
  });
  D.y += rowH;
  // rows
  t.rows.forEach((r, ri) => {
    D.ensure(rowH);
    if (ri % 2 === 1) {
      D.fill(CARD);
      D.d.rect(MARGIN, D.y, D.maxW, rowH, "F");
    }
    D.font(false, 8.5);
    D.ink([50, 50, 50]);
    r.forEach((cell, i) => {
      const align = i === 0 ? "left" : "right";
      const x = i === 0 ? MARGIN + 6 : MARGIN + (i + 1) * colW - 6;
      if (i === 0) D.font(true, 8.5);
      else D.font(false, 8.5);
      const s = (D.d.splitTextToSize(String(cell), colW - 10) as string[])[0] ?? String(cell);
      D.d.text(s, x, D.y + 12, { align });
    });
    D.y += rowH;
  });
  D.stroke(HAIR);
  D.d.setLineWidth(0.5);
  D.d.line(MARGIN, D.y, MARGIN + D.maxW, D.y);
  D.y += 12;
}

// --- cover + chrome ---------------------------------------------------------

function coverPage(D: Doc, d: Dossier) {
  // accent band
  D.fill(D.accent);
  D.d.rect(0, 0, D.pageW, 6, "F");
  let y = 150;
  D.font(false, 9);
  D.ink(D.accent);
  D.d.text("VENTURE INTELLIGENCE DOSSIER", MARGIN, y);
  y += 30;
  D.font(true, 28);
  D.ink(INK);
  const titleLines = D.d.splitTextToSize(d.title, D.maxW) as string[];
  for (const ln of titleLines) {
    D.d.text(ln, MARGIN, y);
    y += 32;
  }
  if (d.subtitle) {
    y += 4;
    D.font(false, 12);
    D.ink(MUTE);
    for (const ln of D.d.splitTextToSize(d.subtitle, D.maxW) as string[]) {
      D.d.text(ln, MARGIN, y);
      y += 17;
    }
  }
  if (d.cover?.verdict) {
    y += 16;
    const boxLines = D.d.splitTextToSize(d.cover.verdict, D.maxW - 28) as string[];
    const boxH = 20 + boxLines.length * 15;
    D.fill([245, 244, 255]);
    D.d.roundedRect(MARGIN, y, D.maxW, boxH, 6, 6, "F");
    D.fill(D.accent);
    D.d.rect(MARGIN, y, 4, boxH, "F");
    D.font(true, 8);
    D.ink(D.accent);
    D.d.text("VERDICT", MARGIN + 16, y + 16);
    D.font(false, 11);
    D.ink([40, 40, 50]);
    boxLines.forEach((ln, i) => D.d.text(ln, MARGIN + 16, y + 32 + i * 15));
    y += boxH + 24;
  }
  // cover KPIs
  if (d.cover?.kpis?.length) {
    D.y = y;
    kpiRow(D, d.cover.kpis);
    y = D.y;
  }
  if (d.meta?.length) {
    D.font(false, 9);
    D.ink(FAINT);
    D.d.text(d.meta.join("   ·   "), MARGIN, D.pageH - 60);
  }
  D.font(false, 8);
  D.ink(FAINT);
  D.d.text("Generated by EntreTangle", MARGIN, D.pageH - 44);
}

function chrome(D: Doc, title: string) {
  const pages = D.d.getNumberOfPages();
  for (let p = 2; p <= pages; p++) {
    D.d.setPage(p);
    // header
    D.font(false, 7.5);
    D.ink(FAINT);
    D.d.text(title, MARGIN, 30);
    D.stroke(HAIR);
    D.d.setLineWidth(0.5);
    D.d.line(MARGIN, 38, D.pageW - MARGIN, 38);
    // footer
    D.d.line(MARGIN, D.pageH - 34, D.pageW - MARGIN, D.pageH - 34);
    D.font(false, 7.5);
    D.ink(FAINT);
    D.d.text("EntreTangle", MARGIN, D.pageH - 22);
    D.d.text(`${p} / ${pages}`, D.pageW - MARGIN, D.pageH - 22, { align: "right" });
  }
}

function renderDossier(D: Doc, d: Dossier) {
  coverPage(D, d);
  D.page();
  D.y = 52;
  for (const s of d.sections) {
    if (s.pageBreak) {
      D.page();
      D.y = 52;
    }
    if (s.heading) sectionHeading(D, s.heading);
    if (s.body) D.text(s.body, 10.5, { color: [50, 50, 50], gap: 6 });
    if (s.kpis?.length) kpiRow(D, s.kpis);
    if (s.bars) barChart(D, s.bars);
    if (s.share) shareBar(D, s.share);
    if (s.line) lineChart(D, s.line);
    if (s.table) table(D, s.table);
    if (s.bullets?.length) bullets(D, s.bullets);
    D.y += 8;
  }
  chrome(D, d.title);
}

// jsPDF's core Helvetica is Latin-1 only. A single non-Latin-1 char (₹, smart
// quotes, en/em dashes, …) makes jsPDF re-encode the WHOLE line as wide 2-byte
// text, which renders with broken letter-spacing. Map the common offenders to
// ASCII and strip anything else so text stays in single-byte WinAnsi mode.
function clean(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/₹/g, "Rs ") // ₹
    .replace(/[‘’‛′]/g, "'") // ' ' ‛ ′
    .replace(/[“”″]/g, '"') // " " ″
    .replace(/[‐-―−]/g, "-") // hyphen/dash variants + minus
    .replace(/…/g, "...") // …
    .replace(/[     ]/g, " ") // non-breaking / thin spaces
    .replace(/[•●▪]/g, "-") // stray bullets
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, ""); // drop remaining non-Latin-1
}

function sanitize(d: Dossier): Dossier {
  const kpi = (k: KPI): KPI => ({
    label: clean(k.label), value: clean(k.value),
    sub: k.sub ? clean(k.sub) : undefined, tone: k.tone,
  });
  const bar = (b: Bar): Bar => ({ ...b, label: clean(b.label) });
  return {
    ...d,
    title: clean(d.title),
    subtitle: d.subtitle ? clean(d.subtitle) : undefined,
    meta: d.meta?.map((m) => clean(m)),
    cover: d.cover
      ? {
          verdict: d.cover.verdict ? clean(d.cover.verdict) : undefined,
          tagline: d.cover.tagline ? clean(d.cover.tagline) : undefined,
          kpis: d.cover.kpis?.map(kpi),
        }
      : undefined,
    sections: d.sections.map((s) => ({
      ...s,
      heading: s.heading ? clean(s.heading) : undefined,
      body: s.body ? clean(s.body) : undefined,
      bullets: s.bullets?.map((b) => clean(b)),
      kpis: s.kpis?.map(kpi),
      bars: s.bars
        ? { ...s.bars, title: s.bars.title ? clean(s.bars.title) : undefined, data: s.bars.data.map(bar) }
        : undefined,
      share: s.share
        ? { ...s.share, title: s.share.title ? clean(s.share.title) : undefined, data: s.share.data.map(bar) }
        : undefined,
      line: s.line
        ? {
            ...s.line,
            title: s.line.title ? clean(s.line.title) : undefined,
            xLabels: s.line.xLabels?.map((x) => clean(x)),
            series: s.line.series.map((se) => ({ ...se, name: clean(se.name) })),
          }
        : undefined,
      table: s.table
        ? {
            columns: s.table.columns.map((c) => clean(c)),
            rows: s.table.rows.map((r) =>
              r.map((c) => (typeof c === "string" ? clean(c) : c))
            ),
          }
        : undefined,
    })),
  };
}

/** Build + download one PDF from a dossier. */
export function downloadDossier(d: Dossier, filename: string): void {
  const safe = sanitize(d);
  const D = new Doc(safe.accent ?? INDIGO);
  renderDossier(D, safe);
  D.d.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

// A short, filesystem-safe slug for filenames.
export function slug(s: string): string {
  return (
    (s || "dossier")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "dossier"
  );
}
