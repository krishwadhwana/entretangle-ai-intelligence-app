import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Object storage for user-uploaded / generated binary assets (product images,
// design-studio images). Backed by any S3-compatible service — Cloudflare R2,
// AWS S3, Backblaze B2, Supabase Storage — configured purely via env vars:
//
//   S3_BUCKET             bucket name
//   S3_ENDPOINT           e.g. https://<account>.r2.cloudflarestorage.com (R2)
//   S3_ACCESS_KEY_ID      access key / token id
//   S3_SECRET_ACCESS_KEY  secret
//   S3_REGION             "auto" for R2; the bucket region for AWS (default "auto")
//   S3_FORCE_PATH_STYLE   "true" if the provider needs path-style URLs
//
// When S3 is NOT configured (local dev), every operation falls back to the
// local filesystem under data/uploads/ so the app works with no cloud account.
// Keys are forward-slash paths (e.g. "product-images/<projectId>/<id>.jpg");
// the local fallback maps them onto the filesystem 1:1.
// ---------------------------------------------------------------------------

export type StoredObject = { body: Buffer; contentType: string };

const BUCKET = process.env.S3_BUCKET;
const ENDPOINT = process.env.S3_ENDPOINT;
const ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;

let cachedClient: S3Client | null = null;

export function storageConfigured(): boolean {
  return Boolean(BUCKET && ENDPOINT && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

function client(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: ENDPOINT,
    credentials: {
      accessKeyId: ACCESS_KEY_ID as string,
      secretAccessKey: SECRET_ACCESS_KEY as string,
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
  return cachedClient;
}

// Local-fallback root. Reuses the historical data/uploads location so anything
// written before object storage was wired up is still readable in dev.
function localPath(key: string): string {
  // Keys are validated to be relative, slash-delimited paths by callers; guard
  // against traversal regardless.
  const safe = key.replace(/\\/g, "/").replace(/(^|\/)\.\.(?=\/|$)/g, "");
  return path.join(process.cwd(), "data", "uploads", ...safe.split("/"));
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  // Node stream (AWS SDK returns one in Node runtimes).
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (!storageConfigured()) {
    const filePath = localPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return;
  }
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObject(key: string): Promise<StoredObject | null> {
  if (!storageConfigured()) {
    try {
      const body = await readFile(localPath(key));
      return { body, contentType: "application/octet-stream" };
    } catch {
      return null;
    }
  }
  try {
    const res = await client().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    return {
      body: await streamToBuffer(res.Body),
      contentType: res.ContentType || "application/octet-stream",
    };
  } catch (e) {
    // Missing object → null; anything else is a real error worth surfacing.
    if ((e as { name?: string })?.name === "NoSuchKey") return null;
    if ((e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (!storageConfigured()) {
    await rm(localPath(key), { force: true });
    return;
  }
  await client().send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key }),
  );
}
