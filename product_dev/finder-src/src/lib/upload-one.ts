/* ═══════════════════════════════════════════════════════════
   單檔上傳：初始化 → （秒傳／已存在就跳過）→ 傳 storage → 回報完成。

   🔴 這是整包最會出事的一段（三條路：秒傳、tus 續傳、一般 PUT，外加重試與
      回退），所以 2.33 從 IncrementalUploadPage 抽出來 —— 留在 1,000 行的
      元件裡沒辦法單獨測。行為完全沒改，只是換了位置。
   ═══════════════════════════════════════════════════════════ */
import { Upload } from "tus-js-client";
import { api } from "./api";
import { appConfig } from "./config";
import { formatBytes } from "./utils";
import { isSignedTusAuthError, isTransientUploadStatus, shouldUseResumableUpload } from "./incremental-import";
import { t as tr } from "../i18n";
import type { PdDataset } from "./types";

/* 🔴 狀態存 key 不存文案：把「當下語言的字串」寫進 React state 的話，切語言時
   元件雖然重畫，但 state 裡的字不會重算，檔案清單的狀態欄會卡在舊語言。*/
export type StatusTag = { key: string; params?: Record<string, string | number> };

export const tag = (key: string, params?: Record<string, string | number>): StatusTag => ({ key, params });

export type ImportFile = {
  file: File;
  dataset: PdDataset;
  relativePath: string;
  sha256: string;
  status: StatusTag;
};

export async function uploadOne(
  item: ImportFile,
  onStatus: (status: StatusTag) => void,
  signal: AbortSignal,
): Promise<"completed" | "duplicate"> {
  let storagePath: string | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const init = await api.initPdUpload({
      dataset: item.dataset,
      relativePath: item.relativePath,
      byteSize: item.file.size,
      sha256: item.sha256,
    }, signal);
    if (init.duplicate) return "duplicate";
    if (!init.storagePath) throw new Error(tr("u_e_no_path"));
    storagePath = init.storagePath;

    if (init.storageExists) {
      onStatus(tag("u_st_exists"));
      break;
    }
    if (!init.signedUrl) throw new Error(tr("u_e_no_url"));

    if (shouldUseResumableUpload(item.file.size)) {
      if (!init.signedToken) throw new Error(tr("u_e_no_token"));
      onStatus(tag("u_st_big_prep"));
      try {
        await uploadResumable(item, storagePath, init.signedToken, onStatus, signal);
        break;
      } catch (error) {
        if (!isSignedTusAuthError(error)) throw error;
        onStatus(tag("u_st_big_fallback"));
      }
    }

    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", item.file);
    onStatus(attempt === 1 ? tag("u_st_uploading") : tag("u_st_retry", { n: attempt }));

    let response: Response;
    try {
      response = await fetch(init.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: form,
        signal,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(tr("u_e_storage"));
      if (attempt === 3) throw lastError;
      onStatus(tag("u_st_conn_retry", { n: attempt + 1 }));
      await delay(700 * attempt);
      continue;
    }

    const responseText = response.ok ? "" : await response.text();
    if (response.ok || /resource already exists/i.test(responseText)) break;

    lastError = storageUploadError(item.file, response.status, responseText);
    if (!isTransientUploadStatus(response.status) || attempt === 3) throw lastError;

    onStatus(tag("u_st_tmp_retry", { n: attempt + 1 }));
    await delay(700 * attempt);
  }

  if (!storagePath) throw lastError || new Error(tr("u_e_storage"));

  const result = await api.completePdUpload({
    dataset: item.dataset,
    relativePath: item.relativePath,
    byteSize: item.file.size,
    mimeType: item.file.type || "application/octet-stream",
    sha256: item.sha256,
    storagePath,
    lastModified: item.file.lastModified,
  }, signal);
  if (result.duplicate) return "duplicate";
  onStatus(result.analysisStatus === "metadata_only" ? tag("u_st_meta_idx") : tag("u_st_doc_idx"));
  return "completed";
}

function uploadResumable(
  item: ImportFile,
  storagePath: string,
  signedToken: string,
  onStatus: (status: StatusTag) => void,
  signal: AbortSignal,
) {
  const projectId = new URL(appConfig.supabaseUrl).hostname.split(".")[0];
  const bucketName = item.dataset === "mfg" ? "pd_mfg_source" : "pd_buy_source";

  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(item.file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        "x-signature": signedToken,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName,
        objectName: storagePath,
        contentType: item.file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: (error) => reject(error),
      onProgress: (uploaded, total) => {
        const percentage = total > 0 ? Math.floor((uploaded / total) * 100) : 0;
        onStatus(tag("u_st_big_pct", { p: percentage }));
      },
      onSuccess: () => resolve(),
    });

    /* 🔴 tus 有自己的重試迴圈，AbortSignal 塞不進去，所以手動掛 listener。
       abort() 之後 tus 不會再呼叫 onError，要自己 reject，否則按了「停止」
       這個 Promise 會永遠不 settle，整個批次就卡在那個檔上。*/
    const onAbort = () => {
      void upload.abort();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch(reject);
  });
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function storageUploadError(file: File, status: number, responseText: string) {
  const detail = storageErrorDetail(responseText);
  if (status === 413 || /EntityTooLarge|maximum allowed size|exceeded.*size/i.test(responseText)) {
    return new Error(tr("u_e_too_big", { s: formatBytes(file.size) }));
  }
  return new Error(tr("u_e_storage_s", { s: status, d: detail ? `：${detail}` : "" }));
}

function storageErrorDetail(responseText: string) {
  let value: unknown = responseText;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof value !== "string") break;
    try { value = JSON.parse(value); } catch { break; }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = record.message || record.error || record.code;
    if (typeof message === "string") return message.slice(0, 240);
  }
  return typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, 240) : "";
}

