// 「刪除後不再匯入」的判斷（Finder 2.39）。抽成純 JS 才能 `node --test`：
// edge function 在本機跑不起來，而這一段判錯的症狀是「刪掉的文件又回來了」
// 或「admin 想還原卻還原不了」—— 兩種都要等到有人發現才會被回報。

// tomb：pd_deleted_documents 查到的那一列（沒有就是 null）
// 回傳 "allow"（照常上傳）／"blocked"（曾刪除，擋下）／"restore_forbidden"（非 admin 想還原）
export function tombstoneDecision(tomb, { restore = false, isAdmin = false } = {}) {
  if (!tomb) return "allow"
  if (!restore) return "blocked"
  return isAdmin ? "allow" : "restore_forbidden"
}

// 回給前端的樣子：只給盤點畫面需要的欄位，不回刪除者工號
export function tombstonePublic(row) {
  return {
    sha256: String(row?.sha256 || ""),
    relativePath: String(row?.relative_path || ""),
    title: String(row?.title || ""),
    deletedAt: row?.deleted_at || null,
    deletedByName: String(row?.deleted_by_name || ""),
  }
}
