/* ═══════════════════════════════════════════════════════════
   搜尋結果要撈哪些欄位。

   🔴 兩張表的「來源方」與「路徑」欄位名稱**不一樣**：
        pd_mfg_documents → source_factory / category_path
        pd_buy_documents → supplier_name  / product_path

   summary() 兩個都讀（`row.source_factory || null`、
   `row.category_path || row.product_path`），因為它本來是餵 select("*") 的結果。
   2.35 把 select("*") 改成明確列欄位時，我把兩套都列上去 —— Postgres 回
   `column pd_mfg_documents.supplier_name does not exist`，整個搜尋 500，
   畫面變成「已顯示 0／總共 0 份」。所以欄位清單一定要跟著 dataset 走。

   document-columns.test.mjs 會拿 migration 的真實 schema 來驗這份清單，
   不是靠人記得。
   ═══════════════════════════════════════════════════════════ */

/** 兩張表都有、而且 summary() 真的會讀的欄位。 */
export const SUMMARY_COMMON_COLUMNS = [
  "id",
  "title",
  "relative_path",
  "document_kind",
  "extension",
  "byte_size",
  "keywords",
  "summary_zh_tw",
  "is_reference",
  "analysis_status",
  "thumbnail_path",
  "storage_path",
  "updated_at",
  "source_modified_at",
  "primary_document_date",
  "primary_date_type",
  "primary_date_evidence",
  "primary_date_location",
  "revision_label",
  "revision_evidence",
  "revision_location",
]

export const MFG_ONLY_COLUMNS = ["source_factory", "category_path"]
export const BUY_ONLY_COLUMNS = ["supplier_name", "product_path"]

export function summaryColumnList(dataset) {
  return [
    ...SUMMARY_COMMON_COLUMNS,
    ...(dataset === "mfg" ? MFG_ONLY_COLUMNS : BUY_ONLY_COLUMNS),
  ]
}

export function summaryColumns(dataset) {
  return summaryColumnList(dataset).join(",")
}

/* ── 編輯與刪除要撈的欄位 ───────────────────────────────────
   兩個端點原本都是 select("*")，把 search_text（分析完成後最多 300 KB）整份
   撈出來再丟掉。updateDocument 真的需要 extracted_text —— 它要用內文重新拼
   search_text —— 但不需要舊的 search_text 本身。 */

export const EDIT_COMMON_COLUMNS = [
  "id",
  "title",
  "relative_path",
  "document_kind",
  "keywords",
  "summary_zh_tw",
  "is_reference",
  "primary_document_date",
  "revision_label",
  "extracted_text",
]

export function editColumnList(dataset) {
  return [
    ...EDIT_COMMON_COLUMNS,
    ...(dataset === "mfg" ? MFG_ONLY_COLUMNS : BUY_ONLY_COLUMNS),
  ]
}

export function editColumns(dataset) {
  return editColumnList(dataset).join(",")
}

/** 刪除只需要三個 storage 路徑與兩個稽核欄位。 */
// title 是給 pd_deleted_documents 的：盤點畫面說「這份曾被刪除」時要講得出是哪一份
export const DELETE_COLUMNS = [
  "id", "title", "relative_path", "sha256", "storage_path", "preview_path", "thumbnail_path",
]

export const deleteColumns = () => DELETE_COLUMNS.join(",")
