import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tenant webhook verification primitives (pure, unit-tested).
 * Secrets themselves are never logged here — callers pass values in,
 * comparison only returns a boolean.
 */

/** Timing-safe verify-token comparison. Empty on either side never matches. */
export function verifyTokenMatches(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided === "" || expected === "") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Tenant isolation for inbound webhooks: a number looked up by Meta's
 * phone_number_id may only be ingested when it belongs to the organisation
 * addressed by the webhook path.
 */
export function checkTenantScope(numberOrgId: string, pathOrgId: string): boolean {
  if (!numberOrgId || !pathOrgId) return false;
  return numberOrgId === pathOrgId;
}

/**
 * HMAC-SHA256 webhook signature check (Meta `X-Hub-Signature-256`).
 * Fail-closed: missing secret or signature never verifies.
 */
export function checkSignature(secret: string, raw: Buffer, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
