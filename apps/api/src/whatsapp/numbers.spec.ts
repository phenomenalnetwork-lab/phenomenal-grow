import { describe, expect, it } from "vitest";
import { validateNumberInput } from "./whatsapp.service";

describe("manual Meta settings validation", () => {
  it("accepts a full manual entry", () => {
    const r = validateNumberInput({
      label: " Sales ",
      providerNumberId: "15550009999",
      accessToken: "EAAB12345678901234567890",
      businessAccountId: "1234567890",
    });
    expect(r).toEqual({
      label: "Sales",
      providerNumberId: "15550009999",
      accessToken: "EAAB12345678901234567890",
      businessAccountId: "1234567890",
    });
  });

  it("allows missing business account id", () => {
    const r = validateNumberInput({ label: "x", providerNumberId: "12345", accessToken: "a".repeat(20) });
    expect(r.businessAccountId).toBeNull();
  });

  it("rejects non-numeric phone number ids", () => {
    expect(() => validateNumberInput({ label: "x", providerNumberId: "abc", accessToken: "a".repeat(20) })).toThrow();
  });

  it("rejects short tokens", () => {
    expect(() => validateNumberInput({ label: "x", providerNumberId: "12345", accessToken: "short" })).toThrow();
  });

  it("rejects blank labels", () => {
    expect(() => validateNumberInput({ label: "  ", providerNumberId: "12345", accessToken: "a".repeat(20) })).toThrow();
  });
});
