/* Finder 只跟 pd-documents-api 這一支 edge function 說話，所以這裡只留那支
   API 的形狀。CPF 時代的 products／reviews／jobs／trash 等型別在 2.33 隨著
   對應的 api.ts 方法一起刪了 —— 它們的頁面在 2.31 就已經不存在了。 */

export type UserRole = "viewer" | "editor" | "admin";

export type ConfirmationStatus =
  | "human_confirmed"
  | "ai_high_confidence"
  | "needs_review"
  | "conflict";

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  canUpload?: boolean;
  canSync?: boolean;
}

export type PdDataset = "mfg" | "buy";

export interface PdAnalysisLibraryStatus {
  queued: number;
  processing: number;
  retryableFailed: number;
  blockedFailed: number;
  completed: number;
}

export interface PdAnalysisQueueStatus {
  configured: boolean;
  mfg: PdAnalysisLibraryStatus;
  buy: PdAnalysisLibraryStatus;
}

export type PdAnalysisStatus =
  | "metadata_only"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type PdPrimaryDateType =
  | "quotation_date"
  | "issue_date"
  | "revision_date"
  | "creation_date"
  | "filename_date"
  | "manual";

export interface PdDocumentSummary {
  id: string;
  dataset: PdDataset;
  title: string;
  relativePath: string;
  sourceFactory: string | null;
  supplierName: string | null;
  pathLabels: string[];
  documentKind: string;
  extension: string;
  byteSize: number;
  keywords: string[];
  summary: string;
  isReference: boolean;
  analysisStatus: PdAnalysisStatus;
  thumbnailUrl: string | null;
  updatedAt: string;
  sourceModifiedAt: string | null;
  primaryDocumentDate: string | null;
  primaryDateType: PdPrimaryDateType | null;
  primaryDateEvidence: string | null;
  primaryDateLocation: string | null;
  revisionLabel: string | null;
  revisionEvidence: string | null;
  revisionLocation: string | null;
  score?: number;
  matchReason?: string;
}

export interface PdDocumentDetail extends PdDocumentSummary {
  sourceUrl: string | null;
  previewUrl: string | null;
  extractedText: string;
}

export interface PdDocumentEdit {
  title: string;
  documentKind: string;
  sourceParty: string;
  pathLabels: string[];
  keywords: string[];
  summary: string;
  isReference: boolean;
  primaryDocumentDate: string | null;
  revisionLabel: string;
}

export interface PdSearchParams {
  dataset: PdDataset;
  query: string;
  supplier?: string;
  kind?: string;
  includeReference?: boolean;
  limit?: number;
  offset?: number;
}

/* 曾在 Product Finder 被刪除的內容指紋（pd_deleted_documents）。
   批次匯入與上傳一律略過；admin 帶 restore 才能重新匯入。*/
export interface PdDeletedInfo {
  sha256: string;
  relativePath: string;
  title: string;
  deletedAt: string | null;
  deletedByName: string;
}

export interface PdUploadInit {
  duplicate: boolean;
  deleted?: boolean;
  tombstone?: PdDeletedInfo;
  documentId?: string;
  title?: string;
  storageExists?: boolean;
  storagePath?: string;
  signedUrl?: string;
  signedToken?: string;
}

export interface PdSyncDocument {
  id: string;
  dataset: PdDataset;
  relativePath: string;
  sha256: string;
  byteSize: number;
}

export interface PdSyncDownload extends PdSyncDocument {
  url: string;
}

export interface PdUploader {
  id: string;
  email: string;
  displayName: string;
  platformRole: string;
  platformActive: boolean;
  platformStatus: string | null;
  uploadAllowed: boolean;
  syncAllowed: boolean;
}
