import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "enc1:";

/** One-shot escape hatch for the single legacy migration run. Never enable in production. */
function legacyAllowed(): boolean {
  return process.env.ALLOW_LEGACY_PLAINTEXT === "1";
}

function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? "";
  if (secret.length < 16) {
    throw new Error("ENCRYPTION_KEY must be set (min 16 chars) — see .env.example");
  }
  return scryptSync(secret, "pgrow-token", 32);
}

/** AES-256-GCM for provider tokens at rest. Fails closed: no key, no ciphertext. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}.${enc.toString("base64")}.${cipher.getAuthTag().toString("base64")}`;
}

export function decryptToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    if (legacyAllowed()) return stored;
    throw new Error("Refusing to use unencrypted credential (no enc1: prefix)");
  }
  const [, ivB64, encB64, tagB64] = stored.split(/[:.]/);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Credential decryption failed (wrong key or tampered data)");
  }
}
