import type { PdDataset } from "./types";

export type IncrementalFile = {
  dataset: PdDataset;
  relativePath: string;
  sha256: string;
};

export type ImportManifestEntry = {
  byteSize: number;
  lastModified: number;
  sha256: string;
};

export const RESUMABLE_UPLOAD_THRESHOLD = 6 * 1024 * 1024;

export function shouldUseResumableUpload(byteSize: number) {
  return byteSize > RESUMABLE_UPLOAD_THRESHOLD;
}

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

export function manifestFileKey(file: Pick<IncrementalFile, "dataset" | "relativePath">) {
  return `${file.dataset}:${file.relativePath}`;
}

export function reusableManifestHash(
  entry: ImportManifestEntry | undefined,
  file: { size: number; lastModified: number },
) {
  if (!entry || entry.byteSize !== file.size || entry.lastModified !== file.lastModified) return null;
  return /^[a-f0-9]{64}$/.test(entry.sha256) ? entry.sha256 : null;
}

export function isTransientUploadStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function quickUploadRelativePath(dataset: PdDataset, subpath: string, fileName: string) {
  const parts = subpath.replaceAll("\\", "/").split("/").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error("請填寫有效的分類路徑");
  }
  const safeName = fileName.replaceAll("\\", "/").split("/").at(-1)?.trim() || "";
  if (!safeName || safeName === "." || safeName === "..") throw new Error("檔名無效");
  return `${dataset === "mfg" ? "OwnProduct" : "Outsourcing"}/${parts.join("/")}/${safeName}`;
}

export function compareSyncManifest<T extends IncrementalFile & { id?: string; byteSize?: number }>(
  local: IncrementalFile[],
  remote: T[],
) {
  const localByPath = new Map(local.map((item) => [`${item.dataset}:${item.relativePath}`, item]));
  const serverOnly: T[] = [];
  const conflicts: T[] = [];
  let current = 0;
  for (const item of remote) {
    const localItem = localByPath.get(`${item.dataset}:${item.relativePath}`);
    if (!localItem) serverOnly.push(item);
    else if (localItem.sha256 !== item.sha256) conflicts.push(item);
    else current += 1;
  }
  return { serverOnly, conflicts, current };
}
