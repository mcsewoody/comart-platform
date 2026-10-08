// mail-send：從「登入者本人的公司信箱」寄信（Microsoft Graph，應用程式 comart-web-mail，Mail.Send）
//
// 🔴 寄件人一律是資料庫裡這個人的 users.email —— 不收前端指定的寄件人。
//    Mail.Send（應用程式權限）可以代表租戶裡任何信箱寄信，前端說了算的話等於任何人都能冒用 Woody 寄信。
// 🔴 只給業務部 ＋ admin（角色與部門當下重查資料庫，停用／離職者拒絕）。
// 附件只能來自私有 bucket crm-expo／crm-cards（伺服器自己去拿），或前端直接送的檔案（報價單 PDF）。
// 每封都寫一列 crm_mail_log（成功或失敗都寫）。寄件備份留在寄件人的 Outlook「寄件備份」。
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { verifySession } from "../_shared/session.ts"
import { namedSecretKey, elevatedApiHeaders } from "../_shared/api-keys.ts"
import { validate, cleanEmails, safePath, graphAttachment, graphMessage, chunkRanges, DIRECT_LIMIT } from "./lib.js"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session",
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } })
const sbUrl = () => Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || ""
const sbHdr = () => elevatedApiHeaders(namedSecretKey("kms_edge"))

function b64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function unb64(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let tok: { v: string; exp: number } | null = null
async function graphToken(): Promise<string> {
  if (tok && tok.exp > Date.now() + 60_000) return tok.v
  const tid = Deno.env.get("MS_TENANT_ID"), cid = Deno.env.get("MS_CLIENT_ID"), sec = Deno.env.get("MS_CLIENT_SECRET")
  if (!tid || !cid || !sec) throw new Error("graph_not_configured")
  const r = await fetch(`https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cid, client_secret: sec, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error("graph_token_failed: " + (j.error || r.status))
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }
  return tok.v
}
async function graph(method: string, path: string, body?: unknown) {
  const r = await fetch("https://graph.microsoft.com/v1.0" + path, {
    method, headers: { Authorization: "Bearer " + await graphToken(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) {
    let msg = ""; try { const j = await r.json(); msg = j?.error?.code + ": " + (j?.error?.message || "") } catch { /* */ }
    throw new Error(`graph ${r.status} ${msg}`.slice(0, 400))
  }
  const t = await r.text(); return t ? JSON.parse(t) : null
}

async function isCliKey(req: Request): Promise<boolean> {
  const k = req.headers.get("apikey") || ""
  if (!k) return false
  try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")).some((v) => typeof v === "string" && v && v === k) }
  catch { return false }
}
async function liveUser(empId: string) {
  const r = await fetch(`${sbUrl()}/rest/v1/users?emp_id=eq.${encodeURIComponent(empId)}&select=emp_id,email,role,dept,active,status`, { headers: sbHdr() })
  const u = r.ok ? (await r.json())?.[0] : null
  if (!u || u.active === false || u.status === "disabled" || u.status === "resigned") return null
  return u
}
async function storageGet(bucket: string, path: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const r = await fetch(`${sbUrl()}/storage/v1/object/${bucket}/${path}`, { headers: sbHdr() })
  if (!r.ok) throw new Error(`attachment_not_found ${path}`)
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type") || "application/octet-stream" }
}
async function logMail(row: Record<string, unknown>) {
  try {
    await fetch(`${sbUrl()}/rest/v1/crm_mail_log`, { method: "POST",
      headers: { ...sbHdr(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) })
  } catch { /* 紀錄失敗不影響寄信結果 */ }
}

type Att = { name: string; mime: string; bytes: Uint8Array; cid?: string }

async function sendViaGraph(from: string, msg: Record<string, unknown>, atts: Att[]) {
  const total = atts.reduce((n, a) => n + a.bytes.length, 0)
  const enc = encodeURIComponent(from)
  if (total <= DIRECT_LIMIT) {
    await graph("POST", `/users/${enc}/sendMail`, {
      message: { ...msg, attachments: atts.map((a) => graphAttachment({ ...a, b64: b64(a.bytes) })) },
      saveToSentItems: true,
    })
    return
  }
  // 大附件（邀請函 PDF 常常好幾 MB）：先建草稿 → 小的直接附、大的走上傳工作階段 → 寄出
  const draft = await graph("POST", `/users/${enc}/messages`, msg)
  try {
    for (const a of atts) {
      if (a.bytes.length < 2_500_000) {
        await graph("POST", `/users/${enc}/messages/${draft.id}/attachments`, graphAttachment({ ...a, b64: b64(a.bytes) }))
        continue
      }
      const sess = await graph("POST", `/users/${enc}/messages/${draft.id}/attachments/createUploadSession`, {
        AttachmentItem: { attachmentType: "file", name: a.name, size: a.bytes.length, contentType: a.mime,
          ...(a.cid ? { isInline: true, contentId: a.cid } : {}) },
      })
      for (const [s, e] of chunkRanges(a.bytes.length)) {
        const r = await fetch(sess.uploadUrl, { method: "PUT",
          headers: { "Content-Length": String(e - s + 1), "Content-Range": `bytes ${s}-${e}/${a.bytes.length}` },
          body: a.bytes.subarray(s, e + 1) })
        if (!r.ok && r.status !== 201 && r.status !== 200) throw new Error("upload_failed " + r.status)
      }
    }
    await graph("POST", `/users/${enc}/messages/${draft.id}/send`)
  } catch (e) {
    try { await graph("DELETE", `/users/${enc}/messages/${draft.id}`) } catch { /* 草稿留著也無害 */ }
    throw e
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method" }, 405)
  let body: any
  try { body = await req.json() } catch { return json({ error: "bad_json" }, 400) }
  // 本機腳本帶專案 secret key：只准寄「測試信給那個人自己」（用來確認 Graph 權限有沒有被 IT 限縮到特定信箱）
  let empId = ""
  if (await isCliKey(req)) { if (body?.kind !== "test" || !body?.asEmp) return json({ error: "cli_test_only" }, 403); empId = String(body.asEmp) }
  else { const who = await verifySession(req.headers.get("x-session") || ""); empId = String(who?.empId || "") }
  if (!empId) return json({ error: "unauthorized" }, 401)
  const u = await liveUser(empId)
  if (!u) return json({ error: "inactive" }, 403)
  if (!(u.role === "admin" || u.dept === "sales")) return json({ error: "forbidden", hint: "sales_or_admin_only" }, 403)
  const from = String(u.email || "").trim().toLowerCase()
  if (!from) return json({ error: "no_sender_email", hint: "這個帳號在 users 沒有 Email" }, 400)

  const bad = validate(body)
  if (bad) return json({ error: bad }, 400)
  // 測試信只能寄給自己
  const to = body.kind === "test" ? [from] : cleanEmails(body.to)
  const cc = body.kind === "test" ? [] : cleanEmails(body.cc || []).filter((e: string) => !to.includes(e))

  const atts: Att[] = []
  try {
    for (const a of body.attach || []) { const g = await storageGet(a.bucket, safePath(a.path)); atts.push({ name: String(a.name || "attachment"), mime: a.mime || g.mime, bytes: g.bytes }) }
    for (const i of body.inline || []) {
      if (i.path) { const g = await storageGet(i.bucket, safePath(i.path)); atts.push({ name: String(i.name || i.cid + ".jpg"), mime: i.mime || g.mime, bytes: g.bytes, cid: i.cid }) }
      else atts.push({ name: String(i.name || i.cid + ".jpg"), mime: i.mime || "image/jpeg", bytes: unb64(i.b64), cid: i.cid })
    }
    for (const f of body.files || []) atts.push({ name: String(f.name || "file"), mime: f.mime || "application/octet-stream", bytes: unb64(f.b64) })
  } catch (e) { return json({ error: "attachment", detail: String((e as Error).message) }, 400) }
  if (atts.reduce((n, a) => n + a.bytes.length, 0) > 30_000_000) return json({ error: "too_large" }, 400)

  const subject = String(body.subject).trim()
  const logBase = { kind: body.kind, from_emp: u.emp_id, from_email: from, subject: subject.slice(0, 300),
    exhibition_id: body.exhibitionId || null, visit_id: body.visitId || null }
  try {
    await sendViaGraph(from, graphMessage({ subject, html: String(body.html), to, cc }), atts)
  } catch (e) {
    const msg = String((e as Error).message)
    for (const t of to) await logMail({ ...logBase, to_email: t, ok: false, error: msg.slice(0, 500) })
    return json({ error: "send_failed", detail: msg }, 502)
  }
  for (const t of to) await logMail({ ...logBase, to_email: t, ok: true })
  return json({ ok: true, from, to })
})
