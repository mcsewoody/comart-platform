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
//  - 資料表白名單（未列的表一律 403）
//  - 回應一律移除 users.pwd_hash（密碼雜湊只有 auth-verify 能碰）
//  - 回應一律移除 kms_documents.body（機密內容只有 kms-secure-docs 依角色提供）
//  - 寫入 users 時剝除 pwd_hash（密碼只能經 auth-verify 設定）
// 註：本函式仍可被任何知道網址的人呼叫（與 Worker 現況相同），護欄的價值在於
//     「即使被呼叫也不會洩漏密碼雜湊與機密文件內文」，把確認的兩個洞補起來。
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token, prefer, range",
  "Access-Control-Expose-Headers": "content-range, range-unit",
}

const ALLOWED_TABLES = new Set([
  "cal_events","car_bookings","car_fuel_logs","car_inspections","car_maint_logs",
  "car_parkings","car_vehicles","categories","crm_accounts","crm_activities",
  "crm_contacts","crm_tasks","departments","kms_categories","kms_comments",
  "kms_doc_versions","kms_documents","kms_product_lines","kms_review_log",
  "kms_snapshots","lib_books","lib_categories","lib_loans","lib_reservations",
  "logs","notifications","portal_bulletin","portal_messages","price_history",
  "products","quotation_settings","quotes","room_bookings","room_faults",
  "sites","suppliers","trips","users","visit_guests","visit_records",
])

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  const SUPABASE_URL = Deno.env.get("SB_URL") || ""
  const SERVICE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") || ""
  if (!SERVICE_KEY) return json({ error: "server_misconfigured" }, 500)

  const url = new URL(req.url)

  // ── Storage 路徑（quotation 產品圖/檔案上傳）：二進位安全轉發，不做 JSON 處理 ──
  const stIdx = url.pathname.indexOf("/storage/v1/")
  if (stIdx !== -1) {
    const stPath = url.pathname.slice(stIdx + "/storage/v1/".length) + url.search
    const stHeaders: Record<string, string> = {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
    }
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

  // 寫入 users 時剝除 pwd_hash（密碼只能經 auth-verify；防止有人用本代理改密碼雜湊）
  let body: string | undefined = undefined
  if (req.method !== "GET" && req.method !== "HEAD") {
    const rawText = await req.text()
    if (table === "users" && rawText) {
      try {
        const parsed = JSON.parse(rawText)
        const scrub = (o: Record<string, unknown>) => { delete o.pwd_hash; return o }
        body = JSON.stringify(Array.isArray(parsed) ? parsed.map(scrub) : scrub(parsed))
      } catch { body = rawText }
    } else {
      body = rawText || undefined
    }
  }

  // 轉發到 Supabase REST，注入 service_role（繞過 RLS，與 Worker 行為一致）
  const fwHeaders: Record<string, string> = {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
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
