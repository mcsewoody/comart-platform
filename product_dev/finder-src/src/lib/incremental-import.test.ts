import { describe, expect, it } from "vitest";
import { dedupeByDatasetHash, selectIncrementalBatch } from "./incremental-import";

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
});
