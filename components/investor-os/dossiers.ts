// PDF dossier builders for the Investor OS kit artifacts, extracted from
// InvestorOSSection.tsx (behavior-preserving; pure InvestorKit -> Dossier).
import type { InvestorKit } from "@/lib/schema";
import type { Dossier } from "../pdf";

function buildKitDossier(kit: InvestorKit): Dossier {
  const sections = [
    {
      heading: "Readiness",
      body: `Score: ${kit.readinessScore}/100. Status: ${kit.readinessStatus.replace("_", " ")}.`,
      bullets: kit.caveats,
    },
    {
      heading: "Pitch deck",
      table: {
        columns: ["Slide", "Provenance", "Key points"],
        rows: kit.artifacts.pitchDeck.slides.map((s) => [
          s.title,
          s.provenance,
          s.bullets.join(" "),
        ]),
      },
    },
    ...kit.artifacts.investorMemo.sections.map((s) => ({
      heading: `Memo: ${s.title}`,
      body: s.body,
    })),
    {
      heading: "Financial model summary",
      body: kit.artifacts.financialModelSummary.status,
      bullets: kit.artifacts.financialModelSummary.bullets,
    },
    {
      heading: "Data room index",
      bullets: kit.artifacts.dataRoomIndex,
    },
    {
      heading: "Investor Q&A",
      table: {
        columns: ["Question", "Answer"],
        rows: kit.artifacts.investorQA.map((q) => [q.question, q.answer]),
      },
    },
    {
      heading: "Use of funds",
      bullets: kit.artifacts.useOfFundsPlan,
    },
  ];
  return {
    title: kit.artifacts.pitchDeck.title,
    subtitle: "Investor fundraise kit",
    meta: [`Readiness ${kit.readinessScore}/100`, new Date(kit.createdAt).toLocaleDateString()],
    sections,
  };
}

function buildDeckDossier(kit: InvestorKit): Dossier {
  return {
    title: kit.artifacts.pitchDeck.title,
    subtitle: "Pitch deck",
    meta: [
      `${kit.artifacts.pitchDeck.slides.length} slides`,
      `Readiness ${kit.readinessScore}/100`,
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: kit.artifacts.pitchDeck.slides.map((slide, i) => ({
      heading: `${i + 1}. ${slide.title}`,
      bullets: slide.bullets,
      body: `Provenance: ${slide.provenance.replace("_", " ")}${
        slide.evidenceIds.length
          ? `\nEvidence IDs: ${slide.evidenceIds.join(", ")}`
          : ""
      }`,
      pageBreak: i > 0 && i % 3 === 0,
    })),
  };
}

function buildMemoDossier(kit: InvestorKit): Dossier {
  return {
    title: kit.artifacts.investorMemo.title,
    subtitle: "Investor memo",
    meta: [
      `${kit.artifacts.investorMemo.sections.length} sections`,
      `Readiness ${kit.readinessScore}/100`,
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: [
      ...kit.artifacts.investorMemo.sections.map((section) => ({
        heading: section.title,
        body: section.body,
        bullets: section.evidenceIds.length
          ? [`Evidence IDs: ${section.evidenceIds.join(", ")}`]
          : undefined,
      })),
      {
        heading: "Financial model summary",
        body: kit.artifacts.financialModelSummary.status,
        bullets: kit.artifacts.financialModelSummary.bullets,
        pageBreak: true,
      },
      {
        heading: "Caveats",
        bullets: kit.caveats,
      },
    ],
  };
}

function buildDataRoomDossier(kit: InvestorKit): Dossier {
  return {
    title: `${kit.artifacts.pitchDeck.title} data room`,
    subtitle: "Data room index and readiness gaps",
    meta: [
      `Readiness ${kit.readinessScore}/100`,
      kit.readinessStatus.replace("_", " "),
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: [
      {
        heading: "Data room index",
        bullets: kit.artifacts.dataRoomIndex,
      },
      {
        heading: "Readiness gates",
        table: {
          columns: ["Gate", "Status", "Score"],
          rows: kit.readinessSnapshot.map((gate) => [
            gate.name,
            gate.status,
            `${gate.score}/100`,
          ]),
        },
      },
      {
        heading: "Diligence caveats",
        bullets: kit.caveats,
      },
    ],
  };
}

function buildQADossier(kit: InvestorKit): Dossier {
  return {
    title: `${kit.artifacts.pitchDeck.title} investor Q&A`,
    subtitle: "Objection handling pack",
    meta: [
      `${kit.artifacts.investorQA.length} questions`,
      `Readiness ${kit.readinessScore}/100`,
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: kit.artifacts.investorQA.map((qa, i) => ({
      heading: `${i + 1}. ${qa.question}`,
      body: qa.answer,
      bullets: qa.evidenceIds.length
        ? [`Evidence IDs: ${qa.evidenceIds.join(", ")}`]
        : undefined,
    })),
  };
}

function buildProjectionDossier(kit: InvestorKit): Dossier {
  return {
    title: `${kit.artifacts.pitchDeck.title} projections`,
    subtitle: "Financial summary and use-of-funds pack",
    meta: [
      kit.artifacts.financialModelSummary.status,
      `Readiness ${kit.readinessScore}/100`,
      new Date(kit.createdAt).toLocaleDateString(),
    ],
    sections: [
      {
        heading: "Capital posture",
        bullets: kit.artifacts.financialModelSummary.bullets,
      },
      {
        heading: "Use of funds",
        bullets: kit.artifacts.useOfFundsPlan,
      },
      {
        heading: "Readiness caveats",
        bullets: kit.caveats,
      },
    ],
  };
}


export {
  buildKitDossier,
  buildDeckDossier,
  buildMemoDossier,
  buildDataRoomDossier,
  buildQADossier,
  buildProjectionDossier,
};
