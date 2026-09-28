import { t as tr } from "../i18n";
import type { PdAnalysisStatus, PdDataset } from "./types";

/* 🔴 這幾組清單與 `k_*` / `m_*` / `sk_*` 字典 key 是**動態拼出來**的關係
   （`tr(\`k_${kind}\`)`），所以字典裡那些 key 用 grep 搜不到字面引用。
   2.33 就是因此把它們當孤兒刪掉，列表整片顯示 key 名稱。
   src/i18n.test.ts 會逐一驗證這裡每個值都查得到字典 —— 往下面加值時，
   字典沒補齊測試就會紅。

   🔴 這個檔案只導出「已經翻好的字串」，**不導出可以直接被 render 的 key 表**。
   2.36 之前 KIND_OPTIONS 與 SKIP_REASON_LABELS 是各頁自己的 `Record<string,string>`，
   存的是 key，而呼叫端得自己記得包一層 `t()`；忘了包的地方就直接把 `k_cad2`、
   `sk_oversized` 印到畫面與匯出的 CSV 上（文件詳情頁的類型徽章與欄位、跳過清單
   報表三處都中了，五種語言全錯，而且上線了）。
   結構上拿掉這個「要記得包 t()」的責任，比再寫一條規則叫人記得可靠。*/

export const KIND_KEYS = [
  "design_drawing", "bom", "cad", "image", "presentation",
  "document", "catalog", "quotation", "other",
] as const;

export const MATCH_KEYS = [
  "exact_filename", "filename", "keyword", "category", "factory",
  "supplier", "product_path", "path", "content", "cross_language", "recent",
] as const;

export const kindLabel = (kind: string) =>
  (KIND_KEYS as readonly string[]).includes(kind) ? tr(`k_${kind}`) : kind;

export const matchLabel = (reason: string) =>
  (MATCH_KEYS as readonly string[]).includes(reason) ? tr(`m_${reason}`) : tr("m_default");

/* 文件詳情頁的「文件類型」下拉：順序即畫面順序，兩個資料庫的可選值不同。
   用字比搜尋結果的 `k_*` 長一點（`k_cad2`／`k_image2`／`k_document2`），是刻意的。*/
const KIND_OPTION_KEYS: Record<PdDataset, ReadonlyArray<readonly [string, string]>> = {
  mfg: [["design_drawing", "k_design_drawing"], ["bom", "k_bom"], ["cad", "k_cad2"], ["image", "k_image2"], ["presentation", "k_presentation"], ["document", "k_document2"], ["other", "k_other"]],
  buy: [["catalog", "k_catalog"], ["quotation", "k_quotation"], ["image", "k_image2"], ["presentation", "k_presentation"], ["document", "k_document2"], ["cad", "k_cad2"], ["other", "k_other"]],
};

/** 下拉選項：`[值, 已翻好的顯示文字]`。 */
export const kindOptions = (dataset: PdDataset): Array<[string, string]> =>
  KIND_OPTION_KEYS[dataset].map(([value, key]) => [value, tr(key)]);

export const kindOptionLabel = (dataset: PdDataset, kind: string) =>
  tr(KIND_OPTION_KEYS[dataset].find(([value]) => value === kind)?.[1] ?? "") || kind;

export type SkipReason =
  | "outside_dataset" | "empty" | "excluded" | "oversized" | "archive" | "unsupported";

export const SKIP_REASONS: readonly SkipReason[] = [
  "outside_dataset", "empty", "excluded", "oversized", "archive", "unsupported",
];

export const skipReasonLabel = (reason: SkipReason) => tr(`sk_${reason}`);

/* AI 判定的「主要日期是哪一種日期」。字典沒有的型態原樣顯示（後端之後新增
   型態時不會變成空白）。*/
const DATE_TYPE_KEYS: Record<string, string> = {
  quotation_date: "dt_quotation_date", issue_date: "dt_issue_date", revision_date: "dt_revision_date",
  creation_date: "dt_creation_date", filename_date: "dt_filename_date", manual: "dt_manual",
};

export const DATE_TYPES = Object.keys(DATE_TYPE_KEYS);

export const dateTypeLabel = (type: string | null) =>
  type ? (DATE_TYPE_KEYS[type] ? tr(DATE_TYPE_KEYS[type]) : type) : tr("d_unidentified");

/* 內容索引狀態。🔴 `failed` 以前跟 queued／processing 一起被顯示成「等待內容
   分析」—— 永遠失敗的文件會永遠顯示「等待中」，沒有人知道它其實已經放棄了。
   而且這個狀態原本只在詳情頁看得到，搜尋結果列表完全沒有，所以
   「這份文件搜不到內文」與「沒有這份文件」在畫面上長得一模一樣。*/
const ANALYSIS_STATUS_KEYS: Record<PdAnalysisStatus, string> = {
  completed: "d_idx_done",
  metadata_only: "d_idx_meta",
  queued: "d_idx_wait",
  processing: "d_idx_processing",
  failed: "d_idx_failed",
};

export const ANALYSIS_STATUSES = Object.keys(ANALYSIS_STATUS_KEYS) as PdAnalysisStatus[];

export const analysisStatusLabel = (status: PdAnalysisStatus) =>
  tr(ANALYSIS_STATUS_KEYS[status] ?? "d_idx_wait");

/** 只有 completed 是「內文查得到」。其餘都該在列表上講出來。 */
export const isContentIndexed = (status: PdAnalysisStatus) => status === "completed";

export const analysisStatusTone = (status: PdAnalysisStatus): "danger" | "warning" =>
  status === "failed" ? "danger" : "warning";
