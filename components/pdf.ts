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
  /** Internal PDF jump target for tables of contents / indexes. */
  anchorId?: string;
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
  /** Bulleted list where each item can carry a clickable source link. */
  linkList?: {
    items: {
      text: string;
      sub?: string;
      url?: string;
      /** Internal PDF jump target. Ignored when url is present. */
      targetId?: string;
    }[];
  };
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

export type DossierDownloadOptions = {
  /** Keep the reliable printable PDF artifact. Defaults to true. */
  pdf?: boolean;
  /** Also create a self-contained animated browser report. Defaults to true. */
  animated?: boolean;
  /** Open the animated report after downloading it. Defaults to true. */
  openAnimated?: boolean;
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
  anchors = new Map<string, { page: number; y: number }>();
  pendingLinks: Array<{
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
    targetId: string;
  }> = [];
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
  currentPage(): number {
    return this.d.getCurrentPageInfo().pageNumber;
  }
  markAnchor(id?: string) {
    if (!id || this.anchors.has(id)) return;
    this.anchors.set(id, {
      page: this.currentPage(),
      y: Math.max(0, this.y - 16),
    });
  }
  addInternalLink(targetId: string | undefined, x: number, y: number, w: number, h: number) {
    if (!targetId) return;
    this.pendingLinks.push({
      page: this.currentPage(),
      x,
      y,
      w,
      h,
      targetId,
    });
  }
  resolveInternalLinks() {
    const current = this.currentPage();
    for (const link of this.pendingLinks) {
      const target = this.anchors.get(link.targetId);
      if (!target) continue;
      this.d.setPage(link.page);
      this.d.link(link.x, link.y, link.w, link.h, {
        pageNumber: target.page,
        top: target.y,
      });
    }
    this.d.setPage(current);
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

function linkList(D: Doc, c: NonNullable<DossierSection["linkList"]>) {
  for (const it of c.items) {
    // point (bold, bulleted)
    D.font(true, 10);
    D.ink(it.targetId && !it.url ? INDIGO : INK);
    const pLines = D.d.splitTextToSize(it.text, D.maxW - 16) as string[];
    const lh = 10 * LINE;
    pLines.forEach((ln, i) => {
      D.ensure(lh);
      const textX = MARGIN + 14;
      const textY = D.y + 9;
      if (i === 0) {
        D.fill(D.accent);
        D.d.circle(MARGIN + 3, D.y + 5.5, 1.7, "F");
      }
      D.font(true, 10);
      D.ink(it.targetId && !it.url ? INDIGO : INK);
      D.d.text(ln, textX, textY);
      if (it.targetId && !it.url) {
        const w = Math.min(D.d.getTextWidth(ln), D.maxW - 16);
        D.addInternalLink(it.targetId, textX, D.y, w, lh);
        D.stroke(INDIGO);
        D.d.setLineWidth(0.35);
        D.d.line(textX, textY + 1.8, textX + w, textY + 1.8);
      }
      D.y += lh;
    });
    // detail
    if (it.sub) {
      D.font(false, 9);
      D.ink([95, 95, 95]);
      const slh = 9 * LINE;
      for (const ln of D.d.splitTextToSize(it.sub, D.maxW - 16) as string[]) {
        D.ensure(slh);
        D.d.text(ln, MARGIN + 14, D.y + 8);
        D.y += slh;
      }
    }
    // clickable source
    if (it.url) {
      let host = it.url;
      try {
        host = new URL(it.url).hostname.replace(/^www\./, "");
      } catch {
        /* keep raw */
      }
      const label = `Source: ${host}`;
      D.ensure(13);
      D.font(false, 8);
      D.ink(INDIGO);
      D.d.textWithLink(label, MARGIN + 14, D.y + 8, { url: it.url });
      const w = D.d.getTextWidth(label);
      D.stroke(INDIGO);
      D.d.setLineWidth(0.4);
      D.d.line(MARGIN + 14, D.y + 9.5, MARGIN + 14 + w, D.y + 9.5);
      D.y += 13;
    }
    D.y += 6;
  }
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
    if (s.anchorId) D.markAnchor(s.anchorId);
    if (s.body) D.text(s.body, 10.5, { color: [50, 50, 50], gap: 6 });
    if (s.kpis?.length) kpiRow(D, s.kpis);
    if (s.bars) barChart(D, s.bars);
    if (s.share) shareBar(D, s.share);
    if (s.line) lineChart(D, s.line);
    if (s.table) table(D, s.table);
    if (s.linkList?.items?.length) linkList(D, s.linkList);
    if (s.bullets?.length) bullets(D, s.bullets);
    D.y += 8;
  }
  D.resolveInternalLinks();
  chrome(D, d.title);
}

// --- animated HTML companion -----------------------------------------------

function toneClass(t?: KPI["tone"]): "good" | "bad" | "neutral" {
  return t === "good" || t === "bad" ? t : "neutral";
}

function esc(value: string | number | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHttpUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function paragraphHtml(body: string | undefined): string {
  if (!body) return "";
  return body
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function kpisHtml(kpis: KPI[] | undefined): string {
  if (!kpis?.length) return "";
  return `
    <div class="kpi-grid">
      ${kpis
        .map(
          (k, i) => `
            <article class="kpi tone-${toneClass(k.tone)}" style="--i:${i}">
              <span>${esc(k.label)}</span>
              <strong>${esc(k.value)}</strong>
              ${k.sub ? `<em>${esc(k.sub)}</em>` : ""}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function chartValue(value: number, unit: string | undefined, money: boolean | undefined): string {
  return money ? fmtNum(value) : `${fmtNum(value)}${unit ?? ""}`;
}

function barsHtml(c: NonNullable<DossierSection["bars"]> | undefined): string {
  if (!c) return "";
  const data = c.data.filter((d) => isFinite(d.value));
  if (!data.length) return "";
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  return `
    <div class="chart-card">
      ${c.title ? `<div class="chart-title">${esc(c.title)}</div>` : ""}
      <div class="bar-list">
        ${data
          .map((row, i) => {
            const width = Math.max(2, (Math.abs(row.value) / max) * 100);
            const tone =
              row.value < 0 ? "bad" : i % 3 === 1 ? "good" : i % 3 === 2 ? "warm" : "neutral";
            return `
              <div class="bar-row" style="--i:${i};--w:${width}%">
                <div class="bar-label">${esc(row.label)}</div>
                <div class="bar-track"><div class="bar-fill tone-${tone}"></div></div>
                <div class="bar-value">${esc(chartValue(row.value, c.unit, c.money))}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function shareHtml(c: NonNullable<DossierSection["share"]> | undefined): string {
  if (!c) return "";
  const data = c.data.filter((d) => d.value > 0).slice(0, 10);
  if (!data.length) return "";
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  return `
    <div class="chart-card">
      ${c.title ? `<div class="chart-title">${esc(c.title)}</div>` : ""}
      <div class="share-bar" aria-label="${esc(c.title ?? "Share chart")}">
        ${data
          .map((row, i) => {
            const width = Math.max(1.5, (row.value / total) * 100);
            return `<span class="share-segment tone-${i % 6}" style="--i:${i};--w:${width}%"></span>`;
          })
          .join("")}
      </div>
      <div class="legend">
        ${data
          .map((row, i) => {
            const pct = Math.round((row.value / total) * 100);
            return `
              <span><i class="tone-${i % 6}"></i>${esc(row.label)} ${pct}%</span>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function lineHtml(c: NonNullable<DossierSection["line"]> | undefined, sectionIndex: number): string {
  if (!c?.series?.some((s) => s.points.length > 1)) return "";
  return `
    <div class="chart-card">
      ${c.title ? `<div class="chart-title">${esc(c.title)}</div>` : ""}
      <div class="line-host" data-section="${sectionIndex}"></div>
      <div class="legend">
        ${c.series
          .map(
            (s, i) => `
              <span><i class="tone-${i % 6}"></i>${esc(s.name)}</span>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function tableHtml(t: NonNullable<DossierSection["table"]> | undefined): string {
  if (!t?.columns.length) return "";
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${t.rows
            .map(
              (row, i) => `
                <tr style="--i:${i}">
                  ${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function listHtml(items: string[] | undefined): string {
  if (!items?.length) return "";
  return `
    <ul class="note-list">
      ${items.map((item, i) => `<li style="--i:${i}">${esc(item)}</li>`).join("")}
    </ul>
  `;
}

function linkListHtml(c: NonNullable<DossierSection["linkList"]> | undefined): string {
  if (!c?.items.length) return "";
  return `
    <ul class="link-list">
      ${c.items
        .map((item, i) => {
          const url = safeHttpUrl(item.url);
          const label = url
            ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.text)}</a>`
            : `<strong>${esc(item.text)}</strong>`;
          return `
            <li style="--i:${i}">
              ${label}
              ${item.sub ? `<span>${esc(item.sub)}</span>` : ""}
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function sectionHtml(section: DossierSection, index: number): string {
  const hasContent =
    section.heading ||
    section.body ||
    section.kpis?.length ||
    section.bars ||
    section.share ||
    section.line ||
    section.table ||
    section.linkList?.items.length ||
    section.bullets?.length;
  if (!hasContent) return "";
  return `
    <section class="panel reveal" style="--i:${index}">
      ${
        section.heading
          ? `<div class="section-head"><h2>${esc(section.heading)}</h2></div>`
          : ""
      }
      ${section.body ? `<div class="body-copy">${paragraphHtml(section.body)}</div>` : ""}
      ${kpisHtml(section.kpis)}
      ${barsHtml(section.bars)}
      ${shareHtml(section.share)}
      ${lineHtml(section.line, index)}
      ${tableHtml(section.table)}
      ${linkListHtml(section.linkList)}
      ${listHtml(section.bullets)}
    </section>
  `;
}

function safeJsonForHtml(d: Dossier): string {
  return JSON.stringify(d)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildAnimatedDossierHtml(d: Dossier): string {
  const chartCount = d.sections.filter((s) => s.bars || s.share || s.line).length;
  const safeJson = safeJsonForHtml(d);
  const title = esc(d.title);
  const sections = d.sections.map(sectionHtml).join("");
  const coverKpis = d.cover?.kpis?.length ? kpisHtml(d.cover.kpis) : "";
  const meta = d.meta?.length
    ? `<div class="meta">${d.meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
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
      --shadow: 0 14px 46px rgba(15,23,42,0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        linear-gradient(120deg, rgba(99,102,241,0.10), transparent 34%),
        linear-gradient(240deg, rgba(20,184,166,0.10), transparent 32%),
        linear-gradient(180deg, #fafafa, #f8fafc 52%, #fff7ed);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(15,23,42,0.052) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15,23,42,0.042) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(180deg, rgba(0,0,0,0.50), transparent 72%);
      animation: grid-drift 18s linear infinite;
    }
    .shell {
      position: relative;
      width: min(1160px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 64px;
    }
    .hero {
      min-height: 84vh;
      display: grid;
      align-content: center;
      gap: 22px;
      padding-bottom: 34px;
    }
    .eyebrow {
      color: var(--indigo);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1 {
      margin: 10px 0 14px;
      max-width: 980px;
      font-size: clamp(40px, 7vw, 84px);
      line-height: .95;
      letter-spacing: 0;
    }
    h2 {
      margin: 0;
      font-size: 15px;
      line-height: 1.25;
    }
    p { margin: 0; }
    .subtitle {
      max-width: 780px;
      color: #404040;
      font-size: 17px;
      line-height: 1.62;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
    }
    .meta span {
      border: 1px solid rgba(99,102,241,0.22);
      background: rgba(255,255,255,0.74);
      border-radius: 999px;
      padding: 7px 11px;
      color: #4b5563;
      font-size: 12px;
      font-weight: 700;
      backdrop-filter: blur(12px);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, .8fr);
      gap: 18px;
      align-items: stretch;
    }
    .verdict {
      border-left: 4px solid var(--indigo);
      background: rgba(255,255,255,0.78);
      border-radius: 8px;
      padding: 18px 20px;
      color: #27272a;
      line-height: 1.58;
      box-shadow: var(--shadow);
      animation: rise .7s ease both .12s;
    }
    .toolbar {
      position: sticky;
      top: 12px;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
      border: 1px solid rgba(229,231,235,.95);
      background: rgba(255,255,255,.84);
      border-radius: 8px;
      padding: 10px 12px;
      box-shadow: 0 10px 34px rgba(15,23,42,.09);
      backdrop-filter: blur(16px);
    }
    .toolbar span {
      color: #525252;
      font-size: 12px;
      font-weight: 800;
    }
    button {
      border: 0;
      border-radius: 8px;
      background: var(--indigo);
      color: white;
      cursor: pointer;
      font-weight: 800;
      padding: 9px 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .panel {
      border: 1px solid rgba(229,231,235,.95);
      background: var(--panel);
      border-radius: 8px;
      padding: 18px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .reveal {
      animation: rise .6s cubic-bezier(.2,.8,.2,1) both;
      animation-delay: calc(var(--i) * 45ms);
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      padding-left: 10px;
      border-left: 4px solid var(--indigo);
    }
    .body-copy {
      display: grid;
      gap: 10px;
      color: #404040;
      font-size: 13px;
      line-height: 1.55;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .kpi {
      position: relative;
      min-height: 112px;
      overflow: hidden;
      border: 1px solid rgba(229,231,235,.95);
      background: rgba(255,255,255,.82);
      border-radius: 8px;
      padding: 14px;
      animation: rise .65s cubic-bezier(.2,.8,.2,1) both;
      animation-delay: calc(var(--i) * 70ms + 120ms);
    }
    .kpi::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(110deg, transparent, rgba(255,255,255,.72), transparent);
      transform: translateX(-120%);
      animation: shimmer 4s ease-in-out infinite;
      animation-delay: calc(var(--i) * 180ms + .8s);
    }
    .kpi span {
      display: block;
      color: #a3a3a3;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .kpi strong {
      display: block;
      margin-top: 8px;
      font-size: clamp(22px, 3vw, 34px);
      line-height: 1.02;
      word-break: break-word;
    }
    .kpi em {
      display: block;
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      font-style: normal;
      line-height: 1.3;
    }
    .tone-good strong, .tone-text-good { color: var(--green); }
    .tone-bad strong, .tone-text-bad { color: var(--red); }
    .chart-card {
      margin-top: 14px;
      border: 1px solid rgba(229,231,235,.95);
      background: rgba(255,255,255,.62);
      border-radius: 8px;
      padding: 14px;
    }
    .chart-title {
      margin-bottom: 12px;
      color: #525252;
      font-size: 12px;
      font-weight: 850;
    }
    .bar-list {
      display: grid;
      gap: 10px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) minmax(140px, 2fr) minmax(70px, auto);
      gap: 10px;
      align-items: center;
      animation: rise .48s ease both;
      animation-delay: calc(var(--i) * 45ms);
    }
    .bar-label {
      min-width: 0;
      color: #404040;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.25;
    }
    .bar-track {
      height: 12px;
      overflow: hidden;
      border-radius: 999px;
      background: #eef2ff;
    }
    .bar-fill {
      width: var(--w);
      height: 100%;
      min-width: 2px;
      border-radius: inherit;
      transform-origin: left center;
      animation: grow 1.1s cubic-bezier(.2,.8,.2,1) both;
      animation-delay: calc(var(--i) * 55ms + .18s);
    }
    .bar-fill.tone-neutral { background: linear-gradient(90deg, #a5b4fc, var(--indigo)); }
    .bar-fill.tone-good { background: linear-gradient(90deg, #6ee7b7, var(--green)); }
    .bar-fill.tone-bad { background: linear-gradient(90deg, #fda4af, var(--red)); }
    .bar-fill.tone-warm { background: linear-gradient(90deg, #fcd34d, var(--amber)); }
    .bar-value {
      color: #404040;
      font-size: 12px;
      font-weight: 850;
      text-align: right;
      white-space: nowrap;
    }
    .share-bar {
      display: flex;
      height: 20px;
      overflow: hidden;
      border-radius: 999px;
      background: #eef2ff;
    }
    .share-segment {
      width: var(--w);
      min-width: 2px;
      transform-origin: left center;
      animation: grow 1s cubic-bezier(.2,.8,.2,1) both;
      animation-delay: calc(var(--i) * 70ms + .12s);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 9px 12px;
      margin-top: 11px;
      color: #525252;
      font-size: 12px;
      font-weight: 700;
    }
    .legend i {
      display: inline-block;
      width: 20px;
      height: 4px;
      margin-right: 6px;
      border-radius: 999px;
      vertical-align: middle;
    }
    .tone-0 { background: var(--indigo); stroke: var(--indigo); }
    .tone-1 { background: var(--green); stroke: var(--green); }
    .tone-2 { background: var(--sky); stroke: var(--sky); }
    .tone-3 { background: var(--amber); stroke: var(--amber); }
    .tone-4 { background: var(--teal); stroke: var(--teal); }
    .tone-5 { background: var(--rose); stroke: var(--rose); }
    .line-host svg {
      display: block;
      width: 100%;
      height: 300px;
      overflow: visible;
    }
    .axis-label {
      fill: #9ca3af;
      font-size: 10px;
      font-weight: 700;
    }
    .line-path {
      fill: none;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .point-dot {
      animation: pop .45s ease both;
      animation-delay: .9s;
    }
    .table-wrap {
      margin-top: 14px;
      overflow-x: auto;
      border: 1px solid rgba(229,231,235,.95);
      border-radius: 8px;
    }
    table {
      width: 100%;
      min-width: 620px;
      border-collapse: collapse;
      background: rgba(255,255,255,.68);
      font-size: 12px;
    }
    th, td {
      padding: 10px 11px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #fff;
      background: var(--indigo);
      font-size: 11px;
      letter-spacing: .03em;
      text-transform: uppercase;
    }
    tbody tr {
      animation: rise .42s ease both;
      animation-delay: calc(var(--i) * 30ms);
    }
    tbody tr:nth-child(even) td { background: rgba(248,250,252,.86); }
    .note-list, .link-list {
      display: grid;
      gap: 9px;
      margin: 14px 0 0;
      padding: 0;
      list-style: none;
    }
    .note-list li, .link-list li {
      border-left: 3px solid var(--indigo);
      background: #f8fafc;
      border-radius: 7px;
      color: #404040;
      line-height: 1.45;
      padding: 10px 12px;
      animation: rise .48s ease both;
      animation-delay: calc(var(--i) * 45ms);
    }
    .link-list a, .link-list strong {
      color: #3730a3;
      font-size: 13px;
      font-weight: 850;
      text-decoration: none;
    }
    .link-list a:hover { text-decoration: underline; }
    .link-list span {
      display: block;
      margin-top: 4px;
      color: #525252;
      font-size: 12px;
    }
    .footer {
      color: #737373;
      font-size: 12px;
      padding-top: 26px;
      text-align: center;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(18px) scale(.986); }
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
    @keyframes draw {
      to { stroke-dashoffset: 0; }
    }
    @keyframes pop {
      from { opacity: 0; transform: scale(.4); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes grid-drift {
      from { background-position: 0 0, 0 0; }
      to { background-position: 44px 44px, 44px 44px; }
    }
    @media (max-width: 840px) {
      .hero { min-height: auto; padding-top: 30px; }
      .hero-grid, .grid { grid-template-columns: 1fr; }
      .kpi-grid { grid-template-columns: 1fr; }
      .toolbar { align-items: flex-start; flex-direction: column; }
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
        <div class="eyebrow">Animated Dossier</div>
        <h1>${title}</h1>
        ${d.subtitle ? `<p class="subtitle">${esc(d.subtitle)}</p>` : ""}
        ${meta}
      </div>
      <div class="hero-grid">
        ${
          d.cover?.verdict
            ? `<div class="verdict">${esc(d.cover.verdict)}</div>`
            : `<div class="verdict">This animated report is generated from the same dossier data as the PDF.</div>`
        }
        ${coverKpis}
      </div>
    </section>

    <div class="toolbar">
      <span>${d.sections.length} sections${chartCount ? ` - ${chartCount} chart groups` : ""}</span>
      <button id="replay" type="button">Replay animations</button>
    </div>

    <div class="grid">
      ${sections}
    </div>
    <p class="footer">Generated by EntreTangle</p>
  </main>
  <script>
    const dossier = ${safeJson};
    const ns = "http://www.w3.org/2000/svg";
    const colors = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#14b8a6", "#f472b6"];

    function compact(n) {
      const value = Number(n) || 0;
      const abs = Math.abs(value);
      if (abs >= 10000000) return (value / 10000000).toFixed(1) + "Cr";
      if (abs >= 100000) return (value / 100000).toFixed(1) + "L";
      if (abs >= 1000) return (value / 1000).toFixed(1) + "k";
      return Math.round(value * 100) / 100;
    }
    function make(tag, attrs) {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs || {}).forEach(function(entry) {
        el.setAttribute(entry[0], String(entry[1]));
      });
      return el;
    }
    function svgText(svg, value, x, y, attrs) {
      const el = make("text", Object.assign({ x, y, class: "axis-label" }, attrs || {}));
      el.textContent = value;
      svg.appendChild(el);
    }
    function renderLine(host) {
      const section = dossier.sections[Number(host.dataset.section)];
      const line = section && section.line;
      if (!line || !line.series || !line.series.length) return;
      const rect = host.getBoundingClientRect();
      const width = Math.max(620, Math.round(rect.width || 900));
      const height = 300;
      const box = { left: 58, right: 18, top: 16, bottom: 42 };
      const plotW = width - box.left - box.right;
      const plotH = height - box.top - box.bottom;
      const all = line.series.flatMap(function(series) {
        return (series.points || []).map(function(point) { return Number(point) || 0; });
      });
      let min = Math.min(0, ...all);
      let max = Math.max(0, ...all);
      if (min === max) max = min + 1;
      const maxLen = Math.max(...line.series.map(function(series) { return (series.points || []).length; }), 2);
      const svg = make("svg", { viewBox: "0 0 " + width + " " + height, role: "img", "aria-label": line.title || "Line chart" });
      for (let i = 0; i <= 4; i += 1) {
        const y = box.top + (i / 4) * plotH;
        svg.appendChild(make("line", { x1: box.left, y1: y, x2: box.left + plotW, y2: y, stroke: "#e5e7eb", "stroke-width": 1 }));
        const val = max - (i / 4) * (max - min);
        svgText(svg, compact(val), box.left - 10, y + 4, { "text-anchor": "end" });
      }
      if (min < 0 && max > 0) {
        const zeroY = box.top + plotH - ((0 - min) / (max - min)) * plotH;
        svg.appendChild(make("line", { x1: box.left, y1: zeroY, x2: box.left + plotW, y2: zeroY, stroke: "#94a3b8", "stroke-width": 1.2 }));
      }
      const labels = line.xLabels || [];
      if (labels.length) {
        svgText(svg, labels[0] || "", box.left, height - 16, {});
        svgText(svg, labels[Math.floor(labels.length / 2)] || "", box.left + plotW / 2, height - 16, { "text-anchor": "middle" });
        svgText(svg, labels[labels.length - 1] || "", box.left + plotW, height - 16, { "text-anchor": "end" });
      }
      function x(index) {
        return box.left + (maxLen <= 1 ? 0 : (index / (maxLen - 1)) * plotW);
      }
      function y(value) {
        return box.top + plotH - ((value - min) / (max - min)) * plotH;
      }
      line.series.forEach(function(series, seriesIndex) {
        const points = (series.points || []).map(function(point) { return Number(point) || 0; });
        if (points.length < 2) return;
        const pathData = points
          .map(function(point, index) {
            return (index === 0 ? "M" : "L") + x(index).toFixed(2) + " " + y(point).toFixed(2);
          })
          .join(" ");
        const path = make("path", {
          d: pathData,
          class: "line-path",
          stroke: colors[seriesIndex % colors.length],
        });
        svg.appendChild(path);
        const len = path.getTotalLength();
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        path.style.animation = "draw 1.45s cubic-bezier(.2,.8,.2,1) forwards";
        path.style.animationDelay = String(seriesIndex * 120 + 120) + "ms";
        const last = points[points.length - 1];
        svg.appendChild(make("circle", {
          cx: x(points.length - 1),
          cy: y(last),
          r: 4,
          fill: colors[seriesIndex % colors.length],
          class: "point-dot",
        }));
      });
      host.innerHTML = "";
      host.appendChild(svg);
    }
    function renderAllLines() {
      document.querySelectorAll(".line-host").forEach(renderLine);
    }
    document.getElementById("replay").addEventListener("click", function() {
      document.body.style.animation = "none";
      document.querySelectorAll(".reveal,.kpi,.bar-row,.bar-fill,.share-segment,tbody tr,.note-list li,.link-list li").forEach(function(el) {
        el.style.animation = "none";
      });
      void document.body.offsetWidth;
      document.body.style.animation = "";
      document.querySelectorAll(".reveal,.kpi,.bar-row,.bar-fill,.share-segment,tbody tr,.note-list li,.link-list li").forEach(function(el) {
        el.style.animation = "";
      });
      renderAllLines();
    });
    window.addEventListener("resize", renderAllLines);
    renderAllLines();
  </script>
</body>
</html>`;
}

function filenameBase(filename: string): string {
  return (filename || "dossier").replace(/\.(pdf|html)$/i, "");
}

function downloadAnimatedDossier(d: Dossier, filename: string, openAnimated: boolean): void {
  const html = buildAnimatedDossierHtml(d);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase(filename)}-animated.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (openAnimated) window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

export function sanitizeDossier(d: Dossier): Dossier {
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
      anchorId: s.anchorId,
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
      linkList: s.linkList
        ? {
            items: s.linkList.items.map((it) => ({
              text: clean(it.text),
              sub: it.sub ? clean(it.sub) : undefined,
              url: it.url, // URLs are ASCII — keep verbatim for the link
              targetId: it.targetId,
            })),
          }
        : undefined,
    })),
  };
}

/** Build + download one PDF from a dossier, plus an animated HTML companion. */
export function downloadDossier(
  d: Dossier,
  filename: string,
  options: DossierDownloadOptions = {}
): void {
  const safe = sanitizeDossier(d);
  const shouldSavePdf = options.pdf ?? true;
  const shouldSaveAnimated = options.animated ?? true;
  if (shouldSavePdf) {
    downloadDossierPdf(safe, filename);
  }
  if (shouldSaveAnimated) {
    downloadAnimatedDossier(safe, filename, options.openAnimated ?? true);
  }
}

export function buildDossierPdfBlob(d: Dossier): Blob {
  const safe = sanitizeDossier(d);
  const D = new Doc(safe.accent ?? INDIGO);
  renderDossier(D, safe);
  return D.d.output("blob");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2500);
}

export function downloadDossierPdf(d: Dossier, filename: string): void {
  const normalized = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  downloadBlob(buildDossierPdfBlob(d), normalized);
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
