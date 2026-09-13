function descendingNullableDate(left, right) {
  const leftTime = left ? Date.parse(left) : Number.NaN
  const rightTime = right ? Date.parse(right) : Number.NaN
  const leftValid = Number.isFinite(leftTime)
  const rightValid = Number.isFinite(rightTime)
  if (leftValid && rightValid && leftTime !== rightTime) return rightTime - leftTime
  if (leftValid !== rightValid) return leftValid ? -1 : 1
  return 0
}

/**
 * Search order: relevance, primary/version date, then source file modified date.
 * Missing dates always sort after known dates.
 */
export function compareSearchResults(left, right) {
  const scoreDifference = Number(right.score || 0) - Number(left.score || 0)
  if (scoreDifference) return scoreDifference

  const versionDateDifference = descendingNullableDate(
    left.primary_document_date,
    right.primary_document_date,
  )
  if (versionDateDifference) return versionDateDifference

  const modifiedDateDifference = descendingNullableDate(
    left.source_modified_at,
    right.source_modified_at,
  )
  if (modifiedDateDifference) return modifiedDateDifference

  return String(left.document_id || "").localeCompare(String(right.document_id || ""))
}

/**
 * RPC `content` results include both literal extracted-text matches (base score
 * 220) and low-score trigram fallbacks (at most 180). Keep the former while
 * removing fuzzy noise that becomes especially visible after alias expansion.
 */
export function isRelevantSearchCandidate(query, item) {
  if (!String(query || "").trim()) return true
  if (item?.match_reason !== "content") return true
  return Number(item?.score || 0) >= 200
}
