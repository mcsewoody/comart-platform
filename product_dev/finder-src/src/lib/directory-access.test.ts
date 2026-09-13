import { describe, expect, it, vi } from "vitest";
import { deleteFileAtRelativePath, safeRelativeParts } from "./directory-access";

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

  it("deletes only the exact file below an approved product path", async () => {
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    const categoryDirectory = {
      getFileHandle: vi.fn().mockResolvedValue({ kind: "file" }),
      removeEntry,
    };
    const productDirectory = {
      getDirectoryHandle: vi.fn().mockResolvedValue(categoryDirectory),
    };
    const root = {
      getDirectoryHandle: vi.fn().mockResolvedValue(productDirectory),
    };
    await expect(deleteFileAtRelativePath(
      root as unknown as Parameters<typeof deleteFileAtRelativePath>[0],
      "OwnProduct/素亦/X1.pdf",
    )).resolves.toBe("deleted");
    expect(root.getDirectoryHandle).toHaveBeenCalledWith("OwnProduct");
    expect(productDirectory.getDirectoryHandle).toHaveBeenCalledWith("素亦");
    expect(removeEntry).toHaveBeenCalledWith("X1.pdf");
  });
});
