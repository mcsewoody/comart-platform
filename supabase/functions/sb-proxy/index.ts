// sb-proxy：取代 Cloudflare Worker（comart.mcsewoody.workers.dev）的資料代理。
//
// 為什麼換掉 Worker（2026-07-08）：
//  1. workers.dev 網域在中國被 GFW 封鎖 → 中國同事「能登入但資料載不出來」
//  2. Worker 是「用前端可見的 x-admin-token 就能取得 service-role 全權」的後門，
//     且其原始碼不在本 repo，無法修補（實測可繞過 migration 018/019 直接讀
//     pwd_hash 與機密文件）
//
// 本函式跑在 Supabase（supabase.co，中國可達），維持與 Worker 相同的
// /supabase/rest/v1/<table> URL 介面（前端只需改網址常數），但加上護欄：
//  - 【2026-07-20 起】所有請求必須帶有效的 HMAC 簽章 session（x-session 標頭，
//    由 auth-verify 登入時簽發）；users/departments/sites 的寫入僅限 admin 角色。
//    舊的「前端可見固定 x-admin-token」已廢除（任何人按 F12 就拿得到，形同無防護）
//  - 資料表白名單（未列的表一律 403）
//  - 回應一律移除 users.pwd_hash（密碼雜湊只有 auth-verify 能碰）
//  - 回應一律移除 kms_documents.body（機密內容只有 kms-secure-docs 依角色提供）
//  - 寫入 users 時剝除 pwd_hash（密碼只能經 auth-verify 設定）
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { verifySession } from "../_shared/session.ts"
import { elevatedApiHeaders, namedSecretKey } from "../_shared/api-keys.ts"

// 過渡旗標：true = 新舊憑證並收（部署新前端期間避免中斷），false = 只收 x-session。
// 前端（GitHub Pages）確認上線後改為 false 再部署一次。
const GRACE = false
const LEGACY_TOKEN = "COMART-ADMIN-2026"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token, x-session, prefer, range, x-upsert",
  "Access-Control-Expose-Headers": "content-range, range-unit",
}

// admin 才能寫的表（其餘白名單表：任何有效 session 皆可讀寫）
const ADMIN_WRITE_TABLES = new Set(["users", "departments", "sites"])
// 一般使用者可自行更新（PATCH 自己那筆 users）的欄位白名單
const SELF_PATCH_FIELDS = new Set([
  "avatar_url", "bio_zh", "bio_en", "expertise_zh", "expertise_en", "mobile", "ext",
])

const ALLOWED_TABLES = new Set([
  "biz_meeting_minutes","cal_events","car_bookings","car_fuel_logs","car_inspections",
  "car_maint_logs","car_parkings","car_vehicles","categories","crm_accounts",
  "crm_activities","crm_contacts","crm_tasks","departments","kms_categories",
  "kms_comments","kms_doc_versions","kms_documents","kms_product_lines","kms_review_log",
  "kms_snapshots","lib_books","lib_categories","lib_loans","lib_reservations",
  "logs","notifications","portal_bulletin","portal_messages","price_history",
  "products","quotation_settings","quotes","room_bookings","room_faults",
  "sites","suppliers","trips","users","visit_guests","visit_records","weekly_minutes",
  "woody_reports",
])

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  const SUPABASE_URL = Deno.env.get("SB_URL") || ""
  const SERVICE_KEY = namedSecretKey("kms_edge")
  if (!SERVICE_KEY) return json({ error: "server_misconfigured" }, 500)

  // ── 身分驗證：x-session（HMAC 簽章，登入時由 auth-verify 簽發）──
  const sess = await verifySession(req.headers.get("x-session") || "")
  const legacyOk = GRACE && req.headers.get("x-admin-token") === LEGACY_TOKEN
  if (!sess && !legacyOk) return json({ error: "unauthorized", hint: "missing/invalid x-session" }, 401)
  const role = sess?.role || (legacyOk ? "admin" : "")
  const sessEmpId = String(sess?.empId || "")

  const url = new URL(req.url)

  // ── 圖片代理（?imgproxy=<url>）：PDF/Excel 匯出需要把產品圖轉 base64，但圖床
  //    （Firebase Storage）沒有 CORS 標頭、瀏覽器讀不到；由伺服器端代抓再回傳
  //    （順帶解決 Firebase 是 Google 網域在中國被封的問題）。限白名單圖床防 SSRF。──
  const imgTarget = url.searchParams.get("imgproxy")
  if (imgTarget) {
    let host = ""
    try { host = new URL(imgTarget).hostname } catch { return json({ error: "bad imgproxy url" }, 400) }
    const IMG_HOSTS = ["firebasestorage.googleapis.com", "tcvlnpgpuphdalzvmoyo.supabase.co", "storage.googleapis.com"]
    if (!IMG_HOSTS.includes(host)) return json({ error: "img host not allowed", host }, 403)
    try {
      const imgRes = await fetch(imgTarget)
      if (!imgRes.ok) return json({ error: "img fetch failed", status: imgRes.status }, 502)
      const buf = await imgRes.arrayBuffer()
      return new Response(buf, { status: 200, headers: { ...CORS, "Content-Type": imgRes.headers.get("content-type") || "image/jpeg", "Cache-Control": "public, max-age=86400" } })
    } catch (e) {
      return json({ error: "img proxy exception", message: String((e as Error)?.message || e) }, 502)
    }
  }

  // ── Drive 檔案清單（quotation Files 分頁）：用伺服器端 Google Drive API 金鑰
  //    列出公開資料夾內容，回傳給前端以「深色主題」呈現（取代退回 Google 白底
  //    iframe）。金鑰只存在 Supabase Secrets，不外露。順帶讓中國拿得到清單
  //    （由境外 sb-proxy 代呼叫 Google，惟實際開檔/下載仍走 Google Drive）。──
  if (url.pathname.endsWith("/drive")) {
    const folder = url.searchParams.get("folder")
    const GKEY = Deno.env.get("GOOGLE_DRIVE_API_KEY") || ""
    if (!folder) return json({ error: "missing folder" }, 400)
    if (!GKEY) return json({ error: "drive key not set" }, 500)
    try {
      const q = encodeURIComponent(`'${folder}' in parents and trashed=false`)
      const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,size)")
      const gurl = `https://www.googleapis.com/drive/v3/files?q=${q}&key=${GKEY}` +
        `&fields=${fields}&orderBy=folder,name&pageSize=200` +
        `&supportsAllDrives=true&includeItemsFromAllDrives=true`
      const gRes = await fetch(gurl)
      const gData = await gRes.json()
      if (!gRes.ok || gData.error) return json({ error: gData.error || ("drive HTTP " + gRes.status) }, 502)
      return json({ files: gData.files || [] })
    } catch (e) {
      return json({ error: "drive proxy exception", message: String((e as Error)?.message || e) }, 502)
    }
  }

  // ── Storage 路徑（quotation 產品圖/檔案上傳）：二進位安全轉發，不做 JSON 處理 ──
  const stIdx = url.pathname.indexOf("/storage/v1/")
  if (stIdx !== -1) {
    const stPath = url.pathname.slice(stIdx + "/storage/v1/".length) + url.search
    const stHeaders: Record<string, string> = elevatedApiHeaders(SERVICE_KEY)
    const ct = req.headers.get("content-type"); if (ct) stHeaders["Content-Type"] = ct
    const xup = req.headers.get("x-upsert"); if (xup) stHeaders["x-upsert"] = xup
    const stBody = (req.method === "GET" || req.method === "HEAD") ? undefined : new Uint8Array(await req.arrayBuffer())
    const stUp = await fetch(`${SUPABASE_URL}/storage/v1/${stPath}`, { method: req.method, headers: stHeaders, body: stBody })
    if (stUp.status === 204 || stUp.status === 205 || stUp.status === 304) return new Response(null, { status: stUp.status, headers: CORS })
    const buf = await stUp.arrayBuffer()
    return new Response(buf, { status: stUp.status, headers: { ...CORS, "Content-Type": stUp.headers.get("content-type") || "application/octet-stream" } })
  }

  // 取出 /rest/v1/ 之後的部分（table + query string），與 Worker 的路徑格式一致
  const marker = "/rest/v1/"
  const idx = url.pathname.indexOf(marker)
  if (idx === -1) return json({ error: "bad_path" }, 400)
  const restPath = url.pathname.slice(idx + marker.length) + url.search // e.g. "users?select=..."

  const table = restPath.split(/[?/]/)[0]
  if (!ALLOWED_TABLES.has(table)) {
    return json({ error: "table not allowed", table }, 403)
  }

  const isWrite = req.method !== "GET" && req.method !== "HEAD"

  // ── 寫入授權：users/departments/sites 僅限 admin；
  //    例外：一般使用者可 PATCH「自己那筆 users」的個人資料欄位（頭像/簡介等）──
  let selfPatch = false
  if (isWrite && ADMIN_WRITE_TABLES.has(table) && role !== "admin") {
    const empIdFilter = url.searchParams.get("emp_id") || ""
    selfPatch = table === "users" && req.method === "PATCH" &&
      sessEmpId !== "" && empIdFilter === `eq.${sessEmpId}`
    if (!selfPatch) return json({ error: "forbidden", table, hint: "admin role required" }, 403)
  }

  // 寫入 users 時剝除 pwd_hash（密碼只能經 auth-verify；防止有人用本代理改密碼雜湊）；
  // 自助 PATCH 再套欄位白名單（不得改 role/active/emp_id 等）
  let body: string | undefined = undefined
  if (isWrite) {
    const rawText = await req.text()
    if (table === "users" && rawText) {
      try {
        const parsed = JSON.parse(rawText)
        const scrub = (o: Record<string, unknown>) => {
          delete o.pwd_hash
          if (selfPatch) for (const k of Object.keys(o)) { if (!SELF_PATCH_FIELDS.has(k)) delete o[k] }
          return o
        }
        body = JSON.stringify(Array.isArray(parsed) ? parsed.map(scrub) : scrub(parsed))
      } catch { body = rawText }
    } else {
      body = rawText || undefined
    }
  }

  // 轉發到 Supabase REST，注入 service_role（繞過 RLS，與 Worker 行為一致）
  const fwHeaders: Record<string, string> = {
    ...elevatedApiHeaders(SERVICE_KEY),
    "Content-Type": req.headers.get("content-type") || "application/json",
  }
  const prefer = req.headers.get("prefer"); if (prefer) fwHeaders["Prefer"] = prefer
  const range = req.headers.get("range"); if (range) fwHeaders["Range"] = range

  const upstream = await fetch(`${SUPABASE_URL}/rest/v1/${restPath}`, {
    method: req.method,
    headers: fwHeaders,
    body,
  })

  // 204/205/304 依規範不可帶 body（Deno 的 Response 會直接 throw）→ 直接回傳無 body
  if (upstream.status === 204 || upstream.status === 205 || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers: CORS })
  }

  const text = await upstream.text()

  // 回應護欄：移除敏感欄位
  let outText = text
  if ((req.method === "GET") && (table === "users" || table === "kms_documents") && text) {
    try {
      const data = JSON.parse(text)
      const dropField = table === "users" ? "pwd_hash" : "body"
      const strip = (o: Record<string, unknown>) => { if (o && typeof o === "object") delete o[dropField]; return o }
      const cleaned = Array.isArray(data) ? data.map(strip) : strip(data)
      outText = JSON.stringify(cleaned)
    } catch { /* 非 JSON（如錯誤訊息）原樣回傳 */ }
  }

  const outHeaders: Record<string, string> = { ...CORS, "Content-Type": "application/json" }
  const cr = upstream.headers.get("content-range"); if (cr) outHeaders["Content-Range"] = cr
  return new Response(outText, { status: upstream.status, headers: outHeaders })
})
