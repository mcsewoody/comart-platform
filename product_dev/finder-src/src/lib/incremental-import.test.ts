import { describe, expect, it } from "vitest";
import {
  dedupeByDatasetHash,
  quickUploadRelativePath,
  reusableManifestHash,
  selectIncrementalBatch,
} from "./incremental-import";

function item(dataset: "mfg" | "buy", index: number, sha256 = `${index}`.padStart(64, "0")) {
  return { dataset, relativePath: `${dataset}/${String(index).padStart(3, "0")}.pdf`, sha256 };
}

describe("incremental import", () => {
  it("deduplicates content inside each logical library without crossing libraries", () => {
    const shared = "a".repeat(64);
    const result = dedupeByDatasetHash([
      item("mfg", 1, shared),
      item("mfg", 2, shared),
      item("buy", 3, shared),
    ]);

    expect(result.unique).toHaveLength(2);
    expect(result.duplicates).toBe(1);
  });

  it("selects a balanced 100 plus 100 batch when both libraries have enough files", () => {
    const files = [
      ...Array.from({ length: 140 }, (_, index) => item("mfg", index + 1)),
      ...Array.from({ length: 130 }, (_, index) => item("buy", index + 1001)),
    ];
    const batch = selectIncrementalBatch(files, 200);

    expect(batch).toHaveLength(200);
    expect(batch.filter((file) => file.dataset === "mfg")).toHaveLength(100);
    expect(batch.filter((file) => file.dataset === "buy")).toHaveLength(100);
  });

  it("fills unused capacity from the other library", () => {
    const files = [
      ...Array.from({ length: 30 }, (_, index) => item("mfg", index + 1)),
      ...Array.from({ length: 250 }, (_, index) => item("buy", index + 1001)),
    ];
    const batch = selectIncrementalBatch(files, 200);

    expect(batch.filter((file) => file.dataset === "mfg")).toHaveLength(30);
    expect(batch.filter((file) => file.dataset === "buy")).toHaveLength(170);
  });

  it("reuses a cached hash only when file metadata is unchanged", () => {
    const sha256 = "b".repeat(64);
    const entry = { byteSize: 1024, lastModified: 1234, sha256 };

    expect(reusableManifestHash(entry, { size: 1024, lastModified: 1234 })).toBe(sha256);
    expect(reusableManifestHash(entry, { size: 2048, lastModified: 1234 })).toBeNull();
  });

  it("builds quick-upload paths inside the selected logical library", () => {
    expect(quickUploadRelativePath("mfg", "素亦/手機指環架", "X1.pdf"))
      .toBe("OwnProduct/素亦/手機指環架/X1.pdf");
    expect(quickUploadRelativePath("buy", "供應商A/三合一", "quote.xlsx"))
      .toBe("Outsourcing/供應商A/三合一/quote.xlsx");
    expect(() => quickUploadRelativePath("buy", "../供應商A", "quote.xlsx")).toThrow();
  });
});
