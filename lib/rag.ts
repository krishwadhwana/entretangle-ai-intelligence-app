import OpenAI from "openai";
import { config } from "./config";
import {
  createDocument,
  getProjectChunks,
  type DocChunk,
  type StoredChunk,
} from "./store";

// ---------------------------------------------------------------------------
// Retrieval-augmented grounding (SPEC-V2 §1A "pull from real data", option B).
// Founder-uploaded documents are chunked, embedded, and stored; at run time
// the most relevant chunks are injected into desk/audience prompts as fact.
//
// Embedding backend is chosen automatically:
//   • real:  OpenAI text-embedding-3-small (when a key exists and not mock)
//   • local: a deterministic hashing-TF vectorizer — offline, no key, lexical
//     similarity. This is the mock/no-key fallback so RAG always works.
// Each document stores which model embedded it; retrieval only compares
// vectors from the SAME model (switch backends ⇒ re-upload).
// ---------------------------------------------------------------------------

const LOCAL_MODEL = "local-hash-v1";
const LOCAL_DIM = 384;
const OPENAI_MODEL = "text-embedding-3-small";

const globalForEmb = globalThis as unknown as { embClient?: OpenAI };

function useLocalEmbeddings(): boolean {
  return config.mockMode || !process.env.OPENAI_API_KEY;
}

export function embModelName(): string {
  return useLocalEmbeddings() ? LOCAL_MODEL : OPENAI_MODEL;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic hashing-TF embedding (L2-normalized). Lexical, offline. */
function localEmbed(text: string): number[] {
  const v = new Array(LOCAL_DIM).fill(0);
  for (const tok of tokenize(text)) v[fnv(tok) % LOCAL_DIM] += 1;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

async function openaiEmbed(texts: string[]): Promise<number[][]> {
  if (!globalForEmb.embClient) {
    globalForEmb.embClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  const res = await globalForEmb.embClient.embeddings.create({
    model: OPENAI_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding as number[]);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (useLocalEmbeddings()) return texts.map(localEmbed);
  return openaiEmbed(texts);
}

async function embedOne(text: string): Promise<number[]> {
  return (await embedTexts([text]))[0];
}

/** Split text into ~maxChars chunks on paragraph/sentence boundaries. */
export function chunkText(text: string, maxChars = 1100, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  // Prefer splitting on blank lines, then sentence ends, then hard cut.
  const units = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = "";
  const push = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = buf.length > overlap ? buf.slice(-overlap) : "";
  };
  for (const u of units) {
    if ((buf + "\n\n" + u).length > maxChars && buf) push();
    if (u.length > maxChars) {
      // Oversized paragraph: hard-wrap it.
      for (let i = 0; i < u.length; i += maxChars - overlap) {
        chunks.push(u.slice(i, i + maxChars).trim());
      }
      buf = "";
    } else {
      buf = buf ? `${buf}\n\n${u}` : u;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(Boolean);
}

const MAX_DOC_CHARS = 200_000; // ~50 pages; guard against giant pastes

/** Chunk + embed + persist one founder document. */
export async function ingestDocument(
  projectId: string,
  name: string,
  content: string
): Promise<{ id: string; chunkCount: number; embModel: string }> {
  const text = content.slice(0, MAX_DOC_CHARS);
  const pieces = chunkText(text);
  if (pieces.length === 0) throw new Error("document has no usable text");
  const vectors = await embedTexts(pieces);
  const chunks: DocChunk[] = pieces.map((content, idx) => ({
    idx,
    content,
    embedding: vectors[idx],
  }));
  const doc = await createDocument(projectId, {
    name,
    charCount: text.length,
    embModel: embModelName(),
    chunks,
  });
  return { id: doc.id, chunkCount: doc.chunkCount, embModel: doc.embModel };
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export type RetrievedChunk = {
  content: string;
  docName: string;
  score: number;
};

/**
 * A reusable retriever over one project's documents. Loads chunks once;
 * `search(query, k)` embeds the query and returns the top-k chunks. Only
 * compares against chunks embedded by the CURRENT backend's model.
 */
export class ProjectRetriever {
  private constructor(private chunks: StoredChunk[]) {}

  static async load(projectId: string): Promise<ProjectRetriever> {
    const { chunks, embModels } = await getProjectChunks(projectId);
    const model = embModelName();
    if (embModels.size > 0 && !embModels.has(model)) {
      console.log(
        `[rag] project ${projectId} docs embedded with ${[...embModels].join(
          ","
        )} but active model is ${model}; those docs won't match until re-uploaded`
      );
    }
    return new ProjectRetriever(chunks);
  }

  get hasDocs(): boolean {
    return this.chunks.length > 0;
  }

  async search(query: string, k = 4): Promise<RetrievedChunk[]> {
    if (this.chunks.length === 0 || !query.trim()) return [];
    const qv = await embedOne(query);
    return this.chunks
      .map((c) => ({
        content: c.content,
        docName: c.docName,
        score: cosine(qv, c.embedding),
      }))
      .filter((r) => r.score > 0.01)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** Render retrieved chunks as a prompt section, or "" if none. */
export function formatGroundTruth(hits: RetrievedChunk[]): string {
  if (hits.length === 0) return "";
  const body = hits
    .map(
      (h, i) =>
        `[${i + 1}] (source: ${h.docName})\n${h.content.slice(0, 900)}`
    )
    .join("\n\n");
  return `FOUNDER-PROVIDED GROUND TRUTH — real data the founder uploaded about
THIS venture. Treat it as fact; prefer it over assumptions and cite it as
"founder-data" in sources when a conclusion relies on it:
${body}
END GROUND TRUTH.`;
}
