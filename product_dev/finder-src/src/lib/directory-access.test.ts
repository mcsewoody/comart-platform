import { describe, expect, it } from "vitest";
import { safeRelativeParts } from "./directory-access";

describe("directory sync path safety", () => {
  it("accepts only Product Finder library paths", () => {
    expect(safeRelativeParts("products/OwnProduct/素亦/X1.pdf"))
      .toEqual(["OwnProduct", "素亦", "X1.pdf"]);
    expect(safeRelativeParts("Outsourcing/供應商/報價.xlsx"))
      .toEqual(["Outsourcing", "供應商", "報價.xlsx"]);
  });

  it("rejects traversal and unrelated paths", () => {
    expect(() => safeRelativeParts("OwnProduct/../secret.txt")).toThrow();
    expect(() => safeRelativeParts("Documents/file.pdf")).toThrow();
  });
});
