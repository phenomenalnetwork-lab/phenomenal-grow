import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone.util";

describe("normalizePhone", () => {
  it.each([
    ["+15551234567", "+15551234567"],
    ["+1 555-123-4567", "+15551234567"],
    ["+1 (555) 123 4567", "+15551234567"],
    ["0027655551234", "+27655551234"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("rejects malformed numbers", () => {
    const bad: Array<string | undefined> = ["123", "+", "+12", "abc", "", undefined, "+155512345678901234567"];
    for (const input of bad) {
      expect(() => normalizePhone(input as string), `rejects ${String(input)}`).toThrow();
    }
  });
});
