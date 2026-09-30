import { appConfig } from "./config";
import { t } from "../i18n";
import { getPlatformSession } from "./platform-session";
import type {
  PdAnalysisQueueStatus,
  PdDataset,
  PdDeletedInfo,
  PdDocumentDetail,
  PdDocumentEdit,
  PdDocumentSummary,
  PdSearchParams,
  PdSyncDocument,
  PdSyncDownload,
  PdUploader,
  PdUploadInit,
} from "./types";

/* ═══════════════════════════════════════════════════════════
   🔴 session 過期要能被「認出來」，不能只是一個普通 Error。

   舊版對 401 的處理就是丟 `new Error("操作失敗（401）")`。上傳頁的批次迴圈
   是一個跑完 200 次的 for-await，它分不出「這個檔壞掉」跟「整條線斷了」，
   所以 session 一過期，剩下 197 個檔會各自送一次注定失敗的請求、各留一行
   錯誤，使用者得整批重來。

   現在 401／403 丟 SessionExpiredError，兩件事同時發生：
     1. 呼叫端（上傳迴圈）可以 `instanceof` 判斷，立刻中止整批
     2. onSessionLost 通知 AuthProvider 把 profile 清掉 → 回到登入轉接頁
   ═══════════════════════════════════════════════════════════ */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

let sessionLostHandler: (() => void) | null = null;

/** AuthProvider 掛一個進來；api 層不自己碰 React state。 */
export function setSessionLostHandler(handler: (() => void) | null) {
  sessionLostHandler = handler;
}

function sessionLost(): never {
  sessionLostHandler?.();
  throw new SessionExpiredError(t("api_session_lost"));
}

async function platformCall<T>(
  action: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const session = getPlatformSession();
  if (!session?.sig) sessionLost();

  const response = await fetch(appConfig.platformApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session": session.sig,
    },
    body: JSON.stringify({ action, ...payload }),
    signal,
  });

  if (response.status === 401 || response.status === 403) sessionLost();

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(result.message || result.error || t("api_op_failed", { s: response.status })),
    );
  }
  return result as T;
}

export const api = {
  async searchPdDocuments(params: PdSearchParams, signal?: AbortSignal) {
    return platformCall<{ items: PdDocumentSummary[]; total: number; elapsedMs: number }>(
      "search",
      { ...params },
      signal,
    );
  },

  async getPdDocument(dataset: PdDataset, id: string) {
    return (
      await platformCall<{ item: PdDocumentDetail | null }>("document", { dataset, id })
    ).item;
  },

  async updatePdDocument(dataset: PdDataset, id: string, patch: PdDocumentEdit) {
    return platformCall<{ ok: boolean }>("updateDocument", { dataset, id, patch });
  },

  async deletePdDocument(dataset: PdDataset, id: string) {
    return platformCall<{ ok: boolean; relativePath: string }>("deleteDocument", { dataset, id });
  },

  async initPdUpload(
    payload: { dataset: PdDataset; relativePath: string; byteSize: number; sha256: string; restore?: boolean },
    signal?: AbortSignal,
  ) {
    return platformCall<PdUploadInit>("initUpload", payload, signal);
  },

  async checkPdHashes(dataset: PdDataset, hashes: string[], signal?: AbortSignal) {
    return platformCall<{ existing: string[]; deleted?: PdDeletedInfo[] }>("checkHashes", { dataset, hashes }, signal);
  },

  async completePdUpload(
    payload: {
      dataset: PdDataset;
      relativePath: string;
      byteSize: number;
      mimeType: string;
      sha256: string;
      storagePath: string;
      lastModified: number;
      restore?: boolean;
    },
    signal?: AbortSignal,
  ) {
    return platformCall<{ duplicate: boolean; deleted?: boolean; tombstone?: PdDeletedInfo; documentId: string; analysisStatus?: string }>(
      "completeUpload",
      payload,
      signal,
    );
  },

  async getPdAnalysisStatus() {
    return platformCall<PdAnalysisQueueStatus>("analysisStatus");
  },

  async startPdAnalysis(dataset: PdDataset | "both", limit: number, maxBatches = 1) {
    return platformCall<{ accepted: boolean; dataset: PdDataset | "both"; limit: number; maxBatches: number }>(
      "startAnalysis",
      { dataset, limit, maxBatches },
    );
  },

  async getPdSyncManifest() {
    return platformCall<{ items: PdSyncDocument[] }>("syncManifest");
  },

  async getPdSyncUrls(items: Array<{ dataset: PdDataset; id: string }>, signal?: AbortSignal) {
    return platformCall<{ items: PdSyncDownload[] }>("syncUrls", { items }, signal);
  },

  async getPdUploaders() {
    return platformCall<{ items: PdUploader[] }>("uploaders");
  },

  async setPdUploader(empId: string, permission: "upload" | "sync", allowed: boolean) {
    return platformCall<{ ok: boolean }>("setUploader", { empId, permission, allowed });
  },
};
