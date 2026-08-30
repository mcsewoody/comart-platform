import type { PdDataset } from "./types";

export type IncrementalFile = {
  dataset: PdDataset;
  relativePath: string;
  sha256: string;
};

export function dedupeByDatasetHash<T extends IncrementalFile>(files: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const file of files) {
    const key = importFileKey(file);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(file);
  }

  return { unique, duplicates };
}

export function selectIncrementalBatch<T extends IncrementalFile>(files: T[], limit = 200) {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const mfg = sorted.filter((file) => file.dataset === "mfg");
  const buy = sorted.filter((file) => file.dataset === "buy");
  const targetPerDataset = Math.floor(limit / 2);
  const selected = [
    ...mfg.slice(0, targetPerDataset),
    ...buy.slice(0, targetPerDataset),
  ];
  const selectedKeys = new Set(selected.map(importFileKey));

  if (selected.length < limit) {
    const remainder = sorted.filter((file) => !selectedKeys.has(importFileKey(file)));
    selected.push(...remainder.slice(0, limit - selected.length));
  }

  return selected.slice(0, limit);
}

export function importFileKey(file: Pick<IncrementalFile, "dataset" | "sha256">) {
  return `${file.dataset}:${file.sha256}`;
}
