import { describe, expect, it } from "vitest";
import { renderBody } from "./engine";

describe("renderBody", () => {
  it("substitutes {{name}} with the first name", () => {
    expect(renderBody("Hi {{name}}, welcome!", "Sarah M.")).toBe("Hi Sarah, welcome!");
  });

  it("is case- and space-tolerant", () => {
    expect(renderBody("Hi {{ Name }}, x {{NAME}}", "John")).toBe("Hi John, x John");
  });

  it("leaves unknown placeholders alone", () => {
    expect(renderBody("Hi {{org}}", "Sarah")).toBe("Hi {{org}}");
  });
});
