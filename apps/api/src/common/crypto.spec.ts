import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { decryptToken, encryptToken } from "./crypto";

const KEY = "test-encryption-key-0123456789abcdef";

describe("credential encryption (fail-closed)", () => {
  const saved = process.env.ENCRYPTION_KEY;
  const savedLegacy = process.env.ALLOW_LEGACY_PLAINTEXT;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
    delete process.env.ALLOW_LEGACY_PLAINTEXT;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = saved;
    if (savedLegacy === undefined) delete process.env.ALLOW_LEGACY_PLAINTEXT;
    else process.env.ALLOW_LEGACY_PLAINTEXT = savedLegacy;
  });

  it("round-trips a token", () => {
    const enc = encryptToken("EAA-secret-token");
    expect(enc.startsWith("enc1:")).toBe(true);
    expect(decryptToken(enc)).toBe("EAA-secret-token");
  });

  it("produces unique ciphertexts (random IV)", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  it("throws without ENCRYPTION_KEY on encrypt", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(/ENCRYPTION_KEY/);
  });

  it("throws on wrong key", () => {
    const enc = encryptToken("secret");
    process.env.ENCRYPTION_KEY = "a-different-key-0123456789abcdef";
    expect(() => decryptToken(enc)).toThrow(/decryption failed/);
  });

  it("throws on tampered ciphertext", () => {
    const enc = encryptToken("secret");
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(() => decryptToken(tampered)).toThrow(/decryption failed/);
  });

  it("refuses legacy plaintext by default", () => {
    expect(() => decryptToken("plain-old-token")).toThrow(/unencrypted credential/);
  });

  it("allows legacy plaintext only with the one-shot escape hatch", () => {
    process.env.ALLOW_LEGACY_PLAINTEXT = "1";
    expect(decryptToken("plain-old-token")).toBe("plain-old-token");
  });
});
