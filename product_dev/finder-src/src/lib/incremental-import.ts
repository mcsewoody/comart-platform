import { t } from "../i18n";
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

/* ═══════════════════════════════════════════════════════════
   🔴 掃描指紋快取要「合併」不是「覆寫」。

   舊版在 IncrementalUploadPage 直接 saveManifest(nextManifest)，而 nextManifest
   只裝這一次掃到的檔 —— 掃了子資料夾 A，整個 B 的快取就沒了，下次掃 B 又要
   重算全部 sha256（hashFile 是讀整個檔，50 MB 上限、幾千個檔）。

   但單純合併會無上限長大，localStorage 滿了之後 saveManifest 把 QuotaExceeded
   整個吞掉，就變成「每次全部重算」而且沒有任何訊號。所以合併 + 上限淘汰：
   物件的字串 key 保持插入順序，把這次掃到的排到最後，超過上限就從最舊的砍。
   ═══════════════════════════════════════════════════════════ */
export const MANIFEST_MAX_ENTRIES = 8000;

export function mergeManifest(
  previous: Record<string, ImportManifestEntry>,
  scanned: Record<string, ImportManifestEntry>,
  max = MANIFEST_MAX_ENTRIES,
): Record<string, ImportManifestEntry> {
  const ordered = [
    ...Object.keys(previous).filter((key) => !(key in scanned)),
    ...Object.keys(scanned),
  ];
  const kept = ordered.length > max ? ordered.slice(ordered.length - max) : ordered;
  const merged: Record<string, ImportManifestEntry> = {};
  for (const key of kept) merged[key] = scanned[key] ?? previous[key];
  return merged;
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

export function isSignedTusAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /Invalid Compact JWS|InvalidUploadSignature/i.test(message) ||
    (/AccessDenied/i.test(message) && /Unauthorized/i.test(message));
}

export function quickUploadRelativePath(dataset: PdDataset, subpath: string, fileName: string) {
  const parts = subpath.replaceAll("\\", "/").split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error(t("e_bad_subpath"));
  }
  const safeName = fileName.replaceAll("\\", "/").split("/").at(-1)?.trim() || "";
  if (!safeName || safeName === "." || safeName === "..") throw new Error(t("e_bad_filename"));
  const library = dataset === "mfg" ? "OwnProduct" : "Outsourcing";
  return parts.length ? `${library}/${parts.join("/")}/${safeName}` : `${library}/${safeName}`;
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
