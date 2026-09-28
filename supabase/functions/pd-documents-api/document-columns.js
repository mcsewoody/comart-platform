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
