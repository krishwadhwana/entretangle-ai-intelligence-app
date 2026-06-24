"use client";

import type {
  AudienceAggregate,
  Block,
  ClientProfile,
  ExportViabilityReport,
  FinalReport,
  LaunchSimRecord,
  ProductImageRef,
  SimulationRunRecord,
  WebsiteAnalysis,
  WorkspaceNodeWire,
} from "@/lib/schema";
import { buildRunDossier } from "./runDossier";
import type { Dossier, DossierSection, KPI } from "./pdf";

export type ProjectDocSummary = {
  name: string;
  charCount: number;
  chunkCount: number;
};

export type ProjectModuleSummary = {
  total: number;
  ready: number;
  needsContext: number;
};

export type ProjectMasterRun = {
  snapshot: SimulationRunRecord;
  brief: string;
  mode?: string | null;
  targetMarket?: string | null;
  blocks: Block[];
  aggregate: AudienceAggregate | null;
  finalReport: FinalReport | null;
  launch: LaunchSimRecord | null;
  exportReport: ExportViabilityReport | null;
  currency: string;
  audienceCurrency?: string | null;
};

export type ProjectMasterDossierInput = {
  projectName: string;
  brief?: string | null;
  profile: ClientProfile | null;
  websiteAnalysis?: WebsiteAnalysis | null;
  documents: ProjectDocSummary[];
  productImages: ProductImageRef[];
  moduleSummary: ProjectModuleSummary;
  assetCount: number;
  runs: ProjectMasterRun[];
  savedExportNodes: WorkspaceNodeWire[];
  generatedOn: string;
};

type AggregateSignal = {
  intentPct: number | null;
  medianWtp: number | null;
  personas: number;
  cohorts: number;
  topChannel: string | null;
  topObjection: string | null;
};

function compact(value: string | null | undefined, fallback = "Not captured") {
  const text = value?.trim();
  return text ? text.replace(/\s+/g, " ") : fallback;
}

function joinList(values: Array<string | null | undefined>, fallback: string) {
  const clean = values.map((v) => v?.trim()).filter(Boolean) as string[];
  return clean.length ? clean.join(", ") : fallback;
}

function pct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "n/a";
}

function money(value: number | null | undefined, currency = "INR") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const formatted = new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
  return `${currency} ${formatted}`;
}

function runTitle(run: ProjectMasterRun) {
  return compact(
    run.brief ||
      run.snapshot.params?.brief ||
      run.snapshot.params?.focusQuestion ||
      "Simulation run",
  );
}

function reportTitle(report: FinalReport | null, fallback: string) {
  return compact(report?.title, fallback);
}

function aggregateSignal(aggregate: AudienceAggregate | null): AggregateSignal {
  if (!aggregate) {
    return {
      intentPct: null,
      medianWtp: null,
      personas: 0,
      cohorts: 0,
      topChannel: null,
      topObjection: null,
    };
  }
  const segments = Object.values(aggregate.bySegment ?? {});
  const n = segments.reduce((sum, s) => sum + s.n, 0);
  const intent =
    n > 0 ? segments.reduce((sum, s) => sum + s.meanIntent * s.n, 0) / n : null;
  const wtp =
    n > 0 ? segments.reduce((sum, s) => sum + s.wtpP50 * s.n, 0) / n : null;
  return {
    intentPct: intent == null ? null : intent * 100,
    medianWtp: wtp,
    personas: aggregate.totalPersonas,
    cohorts: aggregate.totalCohorts,
    topChannel: aggregate.channelShare?.[0]?.name ?? null,
    topObjection: aggregate.topObjections?.[0]?.text ?? null,
  };
}

function latestRunWithAggregate(runs: ProjectMasterRun[]) {
  return [...runs].reverse().find((run) => run.aggregate) ?? null;
}

function latestRunWithReport(runs: ProjectMasterRun[]) {
  return [...runs].reverse().find((run) => run.finalReport) ?? null;
}

function findingCount(runs: ProjectMasterRun[]) {
  return runs.reduce(
    (sum, run) =>
      sum + run.blocks.reduce((inner, block) => inner + block.conclusions.length, 0),
    0,
  );
}

function sourceDossier(node: WorkspaceNodeWire): Dossier | null {
  const dossier = node.payload?.dossier;
  if (
    dossier &&
    typeof dossier === "object" &&
    "title" in dossier &&
    "sections" in dossier &&
    Array.isArray((dossier as Dossier).sections)
  ) {
    return dossier as Dossier;
  }
  return null;
}

function savedDossiers(nodes: WorkspaceNodeWire[]) {
  return nodes
    .map((node) => ({ node, dossier: sourceDossier(node) }))
    .filter((item): item is { node: WorkspaceNodeWire; dossier: Dossier } =>
      Boolean(item.dossier),
    );
}

function coverLetterBody(input: ProjectMasterDossierInput, signal: AggregateSignal) {
  const profile = input.profile;
  const product = compact(profile?.product, input.brief || input.projectName);
  const audience = compact(profile?.targetAudience, "the intended customer");
  const geography = joinList(profile?.geography ?? [], "the selected launch market");
  const goal = compact(profile?.goal, "validate the venture and its launch path");
  const latestReport = latestRunWithReport(input.runs)?.finalReport ?? null;
  const reportVerdict = latestReport?.verdict
    ? ` Latest verdict: ${latestReport.verdict}`
    : "";

  return [
    `${input.projectName} is a venture around ${product}, positioned for ${audience} in ${geography}. The project goal is to ${goal}.`,
    `This cover letter is the brief synopsis of the full project record: founder inputs, website evidence, uploaded data, simulated market response, launch economics, export checks, and saved dossier snapshots.${reportVerdict}`,
    signal.intentPct == null
      ? `Product-market fit is still early because no audience simulation has finished yet. The attached dossier keeps the reasoning and assumptions visible so the next run can strengthen the evidence base.`
      : `The latest audience signal shows ${pct(signal.intentPct)} average purchase intent across ${signal.personas.toLocaleString()} simulated personas, with median willingness-to-pay near ${money(signal.medianWtp, input.runs.at(-1)?.audienceCurrency ?? "INR")}. The strongest discovery channel is ${signal.topChannel ?? "not yet clear"}, while the main objection is ${signal.topObjection ?? "not yet clear"}.`,
    `The full PDF that follows preserves the detailed reasoning, number-building approach, product-market fit analysis, and every generated dossier section in one document.`,
  ].join("\n\n");
}

function reasoningSections(input: ProjectMasterDossierInput, signal: AggregateSignal) {
  const totalBlocks = input.runs.reduce((sum, run) => sum + run.blocks.length, 0);
  const exportRuns = input.runs.filter((run) => run.mode === "export").length;
  const launchedRuns = input.runs.filter((run) => run.launch).length;
  const docs = input.documents.reduce((sum, doc) => sum + doc.chunkCount, 0);

  const sections: DossierSection[] = [
    {
      heading: "Project foundation",
      table: {
        columns: ["Area", "Captured signal"],
        rows: [
          ["Product", compact(input.profile?.product, input.brief ?? input.projectName)],
          ["Category", compact(input.profile?.category)],
          ["Audience", compact(input.profile?.targetAudience)],
          ["Geography", joinList(input.profile?.geography ?? [], "Not captured")],
          ["Price band", compact(input.profile?.priceBand)],
          ["Founder goal", compact(input.profile?.goal)],
          ["Website evidence", input.websiteAnalysis ? compact(input.websiteAnalysis.summary) : "No website analysis saved"],
          ["Uploaded data", `${input.documents.length} documents, ${docs} chunks`],
        ],
      },
    },
    {
      heading: "Logical reasoning applied",
      body:
        "The project reasoning starts from founder-reported facts and website evidence, then tests those facts through specialist research desks, simulated buyer cohorts, and deterministic business math. Qualitative claims are kept with their source desks; numerical conclusions are grounded in the profile, uploaded documents, benchmark priors, persona willingness-to-pay, launch assumptions, saved financial models, and export cost inputs when available.",
      bullets: [
        `${totalBlocks} research or synthesis desks generated ${findingCount(input.runs)} findings across the project.`,
        signal.personas
          ? `${signal.personas.toLocaleString()} personas across ${signal.cohorts} cohorts were used for the latest audience-level PMF signal.`
          : "Audience-level PMF is pending until a run finishes with simulated personas.",
        launchedRuns
          ? `${launchedRuns} run${launchedRuns === 1 ? "" : "s"} include a launch trajectory that converts demand into orders, revenue, CAC, returns, cash, and break-even pressure.`
          : "Launch economics are not yet saved for this project.",
        exportRuns
          ? `${exportRuns} export run${exportRuns === 1 ? "" : "s"} test destination-market viability with landed cost, duty, FX, margin, WTP coverage, and fulfillment paths.`
          : "No destination-market export run is attached yet.",
      ],
    },
    {
      heading: "Approach behind the numbers",
      body:
        "The numbers in this packet should be read as an evidence ladder, not as a single magic forecast. Founder-entered facts and uploaded documents are treated as strongest project evidence. Benchmarks and market data fill gaps where direct data is missing. Audience simulations translate those assumptions into buyer intent, WTP, channel preference, objections, and cohort differences. Launch and export engines then convert those signals into unit economics, pricing thresholds, cash pressure, and route-specific viability.",
      bullets: [
        "Assumptions remain visible inside each run dossier, so a reader can see which figures are founder-entered, estimated, sourced, or computed.",
        "Where the project lacks direct proof, the PDF states that uncertainty instead of hiding it behind a precise-looking number.",
        "Saved dossier snapshots are appended as-is, preserving the analysis exactly as it existed when the snapshot was saved.",
      ],
    },
    {
      heading: "Product-market fit analysis",
      body:
        signal.intentPct == null
          ? "There is not enough finished audience evidence to call product-market fit. The right next move is to complete a simulation run, then compare purchase intent, WTP, objections, and channel concentration against the intended price and GTM plan."
          : [
              `Current fit signal: ${pct(signal.intentPct)} average purchase intent, ${money(signal.medianWtp, input.runs.at(-1)?.audienceCurrency ?? "INR")} blended median WTP, and ${signal.personas.toLocaleString()} simulated personas.`,
              signal.intentPct >= 45
                ? "This is a constructive PMF signal, especially if the recommended price is near or below WTP and the top objections are operationally fixable."
                : signal.intentPct < 30
                  ? "This is a weak PMF signal. The product likely needs tighter positioning, a sharper segment, lower acquisition friction, better proof, or a revised price/cost structure."
                  : "This is a mixed PMF signal. There may be a viable wedge, but the project should validate the strongest segment and remove the dominant objections before scaling spend.",
              `Discovery appears most concentrated in ${signal.topChannel ?? "unclear channels"}. The leading objection is ${signal.topObjection ?? "not yet identified"}.`,
            ].join("\n\n"),
    },
  ];

  return sections;
}

function appendDossier(
  target: DossierSection[],
  dossier: Dossier,
  heading: string,
  anchorId: string,
  sourceLine: string,
) {
  target.push({
    heading,
    anchorId,
    pageBreak: true,
    body: [dossier.subtitle, dossier.cover?.verdict, sourceLine]
      .filter(Boolean)
      .join("\n\n"),
    kpis: dossier.cover?.kpis,
  });
  dossier.sections.forEach((section) => {
    target.push({ ...section, pageBreak: section.pageBreak });
  });
}

function runDossier(run: ProjectMasterRun, generatedOn: string) {
  return buildRunDossier({
    brief: runTitle(run),
    mode: run.mode ?? run.snapshot.params?.mode,
    targetMarket: run.targetMarket,
    currency: run.currency || "INR",
    audienceCurrency: run.audienceCurrency ?? run.currency ?? "INR",
    report: run.finalReport,
    aggregate: run.aggregate,
    worldModel: {
      conclusionCount: run.blocks.reduce(
        (sum, block) => sum + block.conclusions.length,
        0,
      ),
      blockCount: run.blocks.length,
    },
    blocks: run.blocks,
    launch: run.launch,
    exportReport: run.exportReport,
    generatedOn,
  });
}

function coverKpis(input: ProjectMasterDossierInput, signal: AggregateSignal): KPI[] {
  const docs = savedDossiers(input.savedExportNodes).length;
  const kpis: KPI[] = [
    { label: "Runs", value: String(input.runs.length) },
    { label: "Findings", value: String(findingCount(input.runs)) },
    { label: "Saved dossiers", value: String(docs) },
    { label: "Documents", value: String(input.documents.length) },
    { label: "Assets", value: String(input.assetCount + input.productImages.length) },
  ];
  if (signal.intentPct != null) {
    kpis.push({
      label: "PMF signal",
      value: pct(signal.intentPct),
      tone:
        signal.intentPct >= 45
          ? "good"
          : signal.intentPct < 30
            ? "bad"
            : "neutral",
    });
  }
  return kpis;
}

export function buildProjectMasterDossier(
  input: ProjectMasterDossierInput,
): Dossier {
  const latestAggregateRun = latestRunWithAggregate(input.runs);
  const signal = aggregateSignal(latestAggregateRun?.aggregate ?? null);
  const saved = savedDossiers(input.savedExportNodes);
  const sections: DossierSection[] = [
    {
      heading: "Cover letter",
      body: coverLetterBody(input, signal),
    },
    ...reasoningSections(input, signal),
    {
      heading: "Dossier index",
      pageBreak: true,
      linkList: {
        items: [
          ...input.runs.map((run, index) => ({
            text: `${index + 1}. ${reportTitle(run.finalReport, runTitle(run))}`,
            sub: `${run.mode ?? run.snapshot.params.mode} run - ${run.blocks.length} desks - ${
              run.aggregate?.totalPersonas?.toLocaleString() ?? "0"
            } personas`,
            targetId: `run-${index}`,
          })),
          ...saved.map(({ node, dossier }, index) => ({
            text: `${input.runs.length + index + 1}. ${compact(dossier.title, node.title)}`,
            sub: `Saved export snapshot - ${compact(node.title)}`,
            targetId: `saved-${index}`,
          })),
        ],
      },
    },
  ];

  if (!input.runs.length && !saved.length) {
    sections.push({
      heading: "No generated dossiers yet",
      body:
        "This project has a cover letter and project foundation, but no simulation run or saved export snapshot is available to append yet.",
    });
  }

  input.runs.forEach((run, index) => {
    appendDossier(
      sections,
      runDossier(run, input.generatedOn),
      `Run dossier ${index + 1}: ${reportTitle(run.finalReport, runTitle(run))}`,
      `run-${index}`,
      `Run status: ${run.snapshot.status}. Generated into the master project PDF on ${input.generatedOn}.`,
    );
  });

  saved.forEach(({ node, dossier }, index) => {
    const sourceType =
      typeof node.payload?.sourceType === "string" ? node.payload.sourceType : "saved";
    const savedAt =
      typeof node.payload?.savedAt === "string" ? node.payload.savedAt : node.createdAt;
    appendDossier(
      sections,
      dossier,
      `Saved dossier ${index + 1}: ${compact(dossier.title, node.title)}`,
      `saved-${index}`,
      `Snapshot source: ${sourceType}. Saved at ${new Date(savedAt).toLocaleString()}.`,
    );
  });

  return {
    title: `${input.projectName} - cover letter and master dossier`,
    subtitle: "Brief synopsis plus complete project dossier packet",
    accent: [79, 70, 229],
    meta: [
      `${input.runs.length} runs`,
      `${saved.length} saved dossiers`,
      `${input.moduleSummary.ready}/${input.moduleSummary.total} modules ready`,
      input.generatedOn,
    ],
    cover: {
      verdict:
        latestRunWithReport(input.runs)?.finalReport?.verdict ??
        "Project-level synopsis compiled from the full workspace record.",
      kpis: coverKpis(input, signal),
    },
    sections,
  };
}
