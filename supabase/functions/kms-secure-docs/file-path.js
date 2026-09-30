// KMS 原始檔的儲存路徑（2026-10-01，kms-files 改成私有 bucket 時抽出來）。
// 純 JS 才能 `node --test`：edge function 在本機跑不起來，而路徑解析錯了的症狀是
// 「按下載沒反應」或更糟 —— 簽到別份文件的檔案。

// kms_documents.file_url 存的是**定位字串**，形狀沿用公開 bucket 時代的網址：
//   https://<project>.supabase.co/storage/v1/object/public/kms-files/uploads/<ts>_<name>
// bucket 改成私有後這個網址本身打不開，只用來取出路徑，再換 10 分鐘的簽章網址。
// 刻意不改寫既有 1,209 筆的格式：新舊一致，而且任何還沒換新版的呼叫端也不會解析錯。
export function kmsFilePath(fileUrl) {
  const s = String(fileUrl || "")
  const m = /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?kms-files\/([^?#]+)/.exec(s)
  if (!m) return null
  let path
  try { path = decodeURIComponent(m[1]) } catch { return null }
  // 只接受 uploads/ 底下、沒有上一層跳脫的路徑
  if (!path.startsWith("uploads/") || path.includes("..") || path.includes("\\")) return null
  return path
}

// 上傳路徑：`uploads/<毫秒>_<只留 ASCII 的檔名>`（Supabase Storage 物件鍵不收中文）
export function kmsUploadPath(fileName, now = Date.now()) {
  const safe = String(fileName || "file").replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120) || "file"
  return `uploads/${now}_${safe}`
}

export function kmsLocator(base, path) {
  return `${base}/storage/v1/object/public/kms-files/${path}`
}
