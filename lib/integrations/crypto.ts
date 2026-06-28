// ---------------------------------------------------------------------------
// Token encryption at rest for connected integrations.
//
// Integration OAuth tokens are far more sensitive than the next-auth login
// tokens (they grant read access to a founder's live sales/ads/finance data),
// so we encrypt them with AES-256-GCM before they ever touch Postgres.
//
// Key: INTEGRATIONS_ENC_KEY — a 32-byte key, hex (64 chars) or base64. Generate
// with `openssl rand -hex 32`. When UNSET we fall back to plaintext + a loud
// warning (matches the existing plaintext Account.access_token, fine for local
// dev) — but production MUST set it. encrypt() prefixes a version tag so we can
// rotate schemes later, and decrypt() transparently passes through any value
// that isn't in our envelope format (e.g. pre-existing plaintext tokens).
// ---------------------------------------------------------------------------
import crypto from "crypto";
import { log } from "../log";

const ENVELOPE_PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

let warnedMissingKey = false;

function loadKey(): Buffer | null {
  const raw = process.env.INTEGRATIONS_ENC_KEY?.trim();
  if (!raw) return null;
  // Accept hex (64 chars) or base64.
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "INTEGRATIONS_ENC_KEY must decode to 32 bytes (use `openssl rand -hex 32`)",
    );
  }
  return buf;
}

/** Encrypt a secret for storage. Returns plaintext (with a one-time warning)
 *  when no key is configured, so local dev still works. */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const key = loadKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      log.warn(
        "INTEGRATIONS_ENC_KEY not set — integration tokens stored in PLAINTEXT. Set it in production.",
      );
    }
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // envelope: enc:v1:<iv>.<tag>.<ciphertext>  (all base64url)
  return (
    ENVELOPE_PREFIX +
    [iv, tag, ciphertext].map((b) => b.toString("base64url")).join(".")
  );
}

/** Decrypt a stored secret. Passes through values that aren't in our envelope
 *  format (plaintext written before a key existed). */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return null;
  if (!stored.startsWith(ENVELOPE_PREFIX)) return stored; // legacy plaintext
  const key = loadKey();
  if (!key) {
    throw new Error(
      "INTEGRATIONS_ENC_KEY is required to decrypt a stored integration token but is not set",
    );
  }
  const body = stored.slice(ENVELOPE_PREFIX.length);
  const [ivB64, tagB64, ctB64] = body.split(".");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("malformed encrypted integration token");
  }
  const decipher = crypto.createDecipheriv(
    ALGO,
    key,
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
