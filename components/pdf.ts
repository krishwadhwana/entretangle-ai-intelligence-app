"use client";

import { jsPDF } from "jspdf";

// A simple, text-first PDF dossier builder. Components assemble a Dossier from
// their own data (final report, launch diagnostics, financial model, follow-up
// Q&A) and call downloadDossier — keeping this module data-agnostic. Text is
// selectable (not rasterised), so files stay small and crisp.

export type DossierSection = {
  heading: string;
  body?: string;
  bullets?: string[];
};

export type Dossier = {
  title: string;
  subtitle?: string;
  meta?: string[]; // small grey line, joined with " · "
  sections: DossierSection[];
};

const MARGIN = 48;
const LINE = 1.4;

function renderDossier(doc: jsPDF, d: Dossier): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - MARGIN * 2;
  let y = MARGIN;

  const ensure = (h: number) => {
    if (y + h > pageH - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const block = (
    str: string,
    size: number,
    opts: {
      bold?: boolean;
      color?: [number, number, number];
      gap?: number;
      indent?: number;
    } = {}
  ) => {
    if (!str) return;
    const indent = opts.indent ?? 0;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    const [r, g, b] = opts.color ?? [23, 23, 23];
    doc.setTextColor(r, g, b);
    const lines = doc.splitTextToSize(str, maxW - indent) as string[];
    const lh = size * LINE;
    for (const ln of lines) {
      ensure(lh);
      doc.text(ln, MARGIN + indent, y);
      y += lh;
    }
    if (opts.gap) y += opts.gap;
  };

  // Header
  block(d.title, 20, { bold: true, gap: 4 });
  if (d.subtitle) block(d.subtitle, 11, { color: [90, 90, 90], gap: 4 });
  if (d.meta?.length) block(d.meta.join("  ·  "), 9, { color: [140, 140, 140], gap: 8 });
  ensure(14);
  doc.setDrawColor(225);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 16;

  for (const s of d.sections) {
    ensure(28);
    block(s.heading, 13, { bold: true, gap: 3 });
    if (s.body) block(s.body, 10.5, { color: [45, 45, 45], gap: 4 });
    for (const bullet of s.bullets ?? []) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(45, 45, 45);
      const lines = doc.splitTextToSize(bullet, maxW - 16) as string[];
      const lh = 10.5 * LINE;
      lines.forEach((ln, i) => {
        ensure(lh);
        if (i === 0) doc.text("•", MARGIN, y);
        doc.text(ln, MARGIN + 14, y);
        y += lh;
      });
    }
    y += 12;
  }

  // Footer page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(165, 165, 165);
    doc.text(`${p} / ${pages}`, pageW - MARGIN, pageH - 24, { align: "right" });
  }
}

/** Build + download one PDF from a dossier. */
export function downloadDossier(d: Dossier, filename: string): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  renderDossier(doc, d);
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
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
