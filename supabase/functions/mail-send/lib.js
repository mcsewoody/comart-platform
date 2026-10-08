// mail-send 的純邏輯（node --test 測得到；edge function 本機跑不起來）
export const MAX_TO = 5
export const MAX_SUBJECT = 300
export const MAX_HTML = 300_000
export const ALLOWED_BUCKETS = new Set(["crm-expo", "crm-cards"])
export const KINDS = new Set(["followup", "quote", "thanks", "test"])
// Graph sendMail 單一請求上限約 4 MB（base64 後），留餘裕：原始大小合計超過這個就改走「草稿＋上傳工作階段」
export const DIRECT_LIMIT = 2_800_000
export const UPLOAD_CHUNK = 320 * 1024 * 10   // 必須是 320 KiB 的倍數

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

export function cleanEmails(v) {
  const arr = Array.isArray(v) ? v : (typeof v === "string" ? v.split(/[,;/\s]+/) : [])
  const out = []
  for (const x of arr) { const e = String(x || "").trim(); if (e && EMAIL_RE.test(e) && !out.includes(e.toLowerCase())) out.push(e.toLowerCase()) }
  return out
}

export function safePath(p) {
  const s = String(p || "")
  return s && !s.includes("..") && !s.startsWith("/") && /^[A-Za-z0-9_\-./]+$/.test(s) ? s : ""
}

// 回傳錯誤代碼字串或 null
export function validate(body) {
  if (!body || typeof body !== "object") return "bad_body"
  if (!KINDS.has(body.kind)) return "bad_kind"
  const to = cleanEmails(body.to)
  if (!to.length) return "no_recipient"
  if (to.length > MAX_TO) return "too_many_recipients"
  const subject = String(body.subject || "").trim()
  if (!subject || subject.length > MAX_SUBJECT) return "bad_subject"
  const html = String(body.html || "")
  if (!html.trim() || html.length > MAX_HTML) return "bad_html"
  for (const a of [...(body.attach || []), ...(body.inline || []).filter((x) => x.path)]) {
    if (!ALLOWED_BUCKETS.has(a.bucket) || !safePath(a.path)) return "bad_attachment"
  }
  for (const f of [...(body.files || []), ...(body.inline || []).filter((x) => x.b64)]) {
    if (typeof f.b64 !== "string" || !f.b64) return "bad_file"
  }
  for (const i of body.inline || []) if (!/^[A-Za-z0-9_.\-]{1,64}$/.test(String(i.cid || ""))) return "bad_cid"
  return null
}

export function graphAttachment(a) {
  const o = { "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.mime || "application/octet-stream", contentBytes: a.b64 }
  if (a.cid) { o.isInline = true; o.contentId = a.cid }
  return o
}

export function graphMessage({ subject, html, to, cc }) {
  return {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: to.map((address) => ({ emailAddress: { address } })),
    ccRecipients: (cc || []).map((address) => ({ emailAddress: { address } })),
  }
}

export function chunkRanges(size, chunk = UPLOAD_CHUNK) {
  const out = []
  for (let s = 0; s < size; s += chunk) out.push([s, Math.min(size, s + chunk) - 1])
  return out
}
