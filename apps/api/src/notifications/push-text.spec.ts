import { describe, expect, it } from "vitest";
import { pushTextForKind } from "./notifications.service";
import { NOTIFICATION_KINDS } from "@pgrow/types";

describe("lock-screen push text", () => {
  it("covers every known notification kind", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const text = pushTextForKind(kind);
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.body.length).toBeGreaterThan(0);
    }
  });

  it("falls back to generic text for unknown kinds", () => {
    expect(pushTextForKind("nope.unknown")).toEqual({
      title: "Notification",
      body: "Open Phenomenal Grow to see details.",
    });
  });

  it("never leaks contact-shaped content", () => {
    const sensitive = ["+", "@", "failed", "131047"];
    for (const kind of [...NOTIFICATION_KINDS, "nope.unknown"]) {
      const blob = JSON.stringify(pushTextForKind(kind));
      for (const s of sensitive) expect(blob).not.toContain(s);
    }
  });
});
