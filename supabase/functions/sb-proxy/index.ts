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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session, prefer, range, x-upsert",
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
  "premortem_sessions","premortem_entries","premortem_mitigations",
  // 注意：premortem_summary_log（AI 結論的版本歷史）**刻意不列入**——
  // 稽核紀錄不該能被應用程式讀取或刪除，只能從 Supabase 後台查。
  "poll_sessions","poll_options","poll_votes","poll_comments",
  "chat_sessions","chat_messages",
])

// ── 線上對話：只有開啟者本人能結束或刪除自己開的那一場 ──
// 「不保留」是整場 cascade 刪除（連同所有人的發言），比覆寫嚴重；
// status/keep/title 決定這場對話的性質與去留，同 premortem 的 phase。
// last_at 刻意不在這裡：每個人發言都要更新它，那是正常的協作寫入。
const CHAT_HOST_ONLY = new Set(["status", "keep", "title"])
// 開啟者是整套權限的根，建立後不可改（改掉就等於把別人開的場次搶過來）
const CHAT_IMMUTABLE = new Set(["host_emp_id", "id"])

// ── 事前驗屍：受保護欄位 ──
// AI 評論與總結是永久存檔的會議正式結論；phase 決定會議進程；chair_emp_id 是整套權限的根。
// 這些欄位的 PATCH 必須是「該場會議的主席本人」，不能只靠前端的 pmIsChair()（那是 UI）。
const PM_PROTECTED = new Set([
  "ai_summary", "ai_summary_a", "ai_summary_b", "summary_at",
  "summary_edited_at", "summary_edited_by", "phase",
  // play_idx 是展示階段的播放位置：主席按「下一則」，全場畫面跟著跳。
  // 不擋的話任何與會者都能把別人的畫面拉走，等於搶走主席的簡報器。
  "play_idx",
])
// chair_emp_id 完全禁止改：沒有任何正當情境要換主席，改了等於接管整場會議
// kind 同理：一場已定稿的驗屍紀錄若能被改成腦力激盪，等於竄改正式紀錄的性質
// opt_*／template 是意見徵集在建會時定下的規則，建立後一律不可改：
// 🔴 opt_anonymous 尤其重要 —— 大家是在「這場匿名」的前提下寫的，事後翻成具名
//    等於承諾到期（CLAUDE.md 已否決「中途解匿」）。其餘三項一併鎖住，規則中途改變同樣不誠實。
const PM_IMMUTABLE = new Set([
  "chair_emp_id", "created_by", "kind",
  "template", "opt_anonymous", "opt_live_visible", "opt_vote", "opt_entry_cap",
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
  if (!sess) return json({ error: "unauthorized", hint: "missing/invalid x-session" }, 401)
  const role = sess?.role || ""
  const sessEmpId = String(sess?.empId || "")

  const url = new URL(req.url)

  // ── 圖片代理（?imgproxy=<url>）：PDF/Excel 匯出需要把產品圖轉 base64，而
  //    canvas 讀跨網域圖片會被 CORS 擋住，所以由伺服器端代抓再回傳。
  //    限白名單圖床防 SSRF。
  //    🔴 firebasestorage.googleapis.com 已於 2026-08-23 移除：289 筆產品圖
  //    （全部剩餘的 Firebase 圖）已搬到 product-assets bucket，資料庫裡的
  //    Firebase 網址歸零。順帶解決一個一直存在的問題——Firebase 是 Google 網域、
  //    在中國被 GFW 封鎖，而畫面上的產品圖是直接 <img src>（不走這個代理），
  //    所以東莞廠原本有 91% 的產品圖是破的，只有匯出正常。
  //    要再加圖床請確認它不是 Google 網域，否則等於把同一個坑挖回來。──
  const imgTarget = url.searchParams.get("imgproxy")
  if (imgTarget) {
    let host = ""
    try { host = new URL(imgTarget).hostname } catch { return json({ error: "bad imgproxy url" }, 400) }
    const IMG_HOSTS = ["tcvlnpgpuphdalzvmoyo.supabase.co"]
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
  //
  // 🔴 這一段用 service_role 無條件轉發任何 /storage/v1/ 路徑。對公開圖片沒問題，
  //    但成本資料（BOM 表）放進來就不行了：bucket 設成 private 只擋得住外部匿名者，
  //    擋不住已登入的內部人——任何持有有效 session 的人（含 role='user'）都能
  //    直接向這個端點要 product-private 的檔案，service_role 會照給。
  //    所以私有 bucket 必須在這裡再擋一層。
  //
  //    角色**重新查資料庫**而不是讀簽章裡的 role，理由與 kms-secure-docs 相同：
  //    簽章是登入當時簽發的，權限異動後舊 token 還在有效期內。查當下的值，
  //    降權才會立即生效。
  const RESTRICTED_BUCKETS = new Set(["product-private"])
  // 誰看得到成本資料：比照報價系統既有的分界（產品編輯器只開給 admin/dcc，
  // role='user' 進不去），不另外發明一套規則。
  const COST_ROLES = new Set(["admin", "dcc"])
  const stIdx = url.pathname.indexOf("/storage/v1/")
  if (stIdx !== -1) {
    const stPath = url.pathname.slice(stIdx + "/storage/v1/".length) + url.search
    /* 受限 bucket 的偵測刻意不去解析 Storage API 的路徑形狀。那些形狀有一堆
       （object/、object/sign/、object/list/、object/info/、object/authenticated/、
       object/upload/sign/、render/image/authenticated/…），而 Supabase 之後還可能
       再加。只要「受限 bucket 的名字出現在路徑的任何一段」就套守衛：
       誤擋一個名字剛好相同的路徑，代價是一次 403；漏放一次，代價是成本資料外流。 */
    const segs = stPath.split("?")[0].split("/").filter(Boolean)
    if (segs.some((x) => RESTRICTED_BUCKETS.has(x))) {
      let liveRole = ""
      try {
        const ur = await fetch(
          `${SUPABASE_URL}/rest/v1/users?emp_id=eq.${encodeURIComponent(sessEmpId)}&select=role,active,status`,
          { headers: elevatedApiHeaders(SERVICE_KEY) },
        )
        const rows = ur.ok ? await ur.json() : []
        const u = Array.isArray(rows) && rows[0] ? rows[0] : null
        // 停用／離職者一律不給，即使 role 還是 admin
        if (u && u.active !== false && u.status !== "disabled" && u.status !== "resigned") liveRole = String(u.role || "")
      } catch { liveRole = "" }
      if (!COST_ROLES.has(liveRole)) {
        return json({ error: "forbidden", hint: "cost files require admin or dcc" }, 403)
      }
    }
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

  // ── 事前驗屍：刪除整場會議僅限「該場主席本人」 ──
  // admin 在驗屍會議裡沒有任何特權，刪除也不例外（與 pmIsChair 的設計一致）。
  // 一場會議被刪，連帶 entries/mitigations 因 on delete cascade 一起消失，比覆寫更嚴重。
  if (req.method === "DELETE" && table === "premortem_sessions") {
    const idFilter = url.searchParams.get("id") || ""
    const sid = idFilter.startsWith("eq.") ? idFilter.slice(3) : ""
    if (!sid) return json({ error: "forbidden", hint: "delete requires ?id=eq.<session_id>" }, 403)
    let chairId = ""
    try {
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/premortem_sessions?id=eq.${encodeURIComponent(sid)}&select=chair_emp_id`,
        { headers: elevatedApiHeaders(SERVICE_KEY) },
      )
      const rows = chk.ok ? await chk.json() : []
      chairId = Array.isArray(rows) && rows[0] ? String(rows[0].chair_emp_id || "") : ""
    } catch { chairId = "" }
    if (!chairId || chairId !== sessEmpId) {
      return json({ error: "forbidden", hint: "only the chair of this session may delete it" }, 403)
    }
  }

  // ── 線上對話：DELETE chat_sessions 必須是開啟者本人（cascade 會帶走所有訊息）──
  if (req.method === "DELETE" && table === "chat_sessions") {
    const idFilter = url.searchParams.get("id") || ""
    const sid = idFilter.startsWith("eq.") ? idFilter.slice(3) : ""
    if (!sid) return json({ error: "forbidden", hint: "delete requires ?id=eq.<session_id>" }, 403)
    let hostId = ""
    try {
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${encodeURIComponent(sid)}&select=host_emp_id`,
        { headers: elevatedApiHeaders(SERVICE_KEY) },
      )
      const rows = chk.ok ? await chk.json() : []
      hostId = Array.isArray(rows) && rows[0] ? String(rows[0].host_emp_id || "") : ""
    } catch { hostId = "" }
    if (!hostId || hostId !== sessEmpId) {
      return json({ error: "forbidden", hint: "only the host of this chat may delete it" }, 403)
    }
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
    } else if (table === "premortem_sessions" && req.method === "PATCH" && rawText) {
      // ── 受保護欄位：必須是該場會議的主席本人 ──
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(rawText) } catch { return json({ error: "bad_json" }, 400) }
      const keys = Object.keys(parsed || {})
      if (keys.some((k) => PM_IMMUTABLE.has(k))) {
        return json({ error: "forbidden", hint: "chair_emp_id/created_by are immutable" }, 403)
      }
      if (keys.some((k) => PM_PROTECTED.has(k))) {
        // 只認 ?id=eq.<id> 這一種形式；取不到 id 就預設拒絕（不去猜其他 filter 的語意）
        const idFilter = url.searchParams.get("id") || ""
        const sid = idFilter.startsWith("eq.") ? idFilter.slice(3) : ""
        if (!sid) return json({ error: "forbidden", hint: "protected fields require ?id=eq.<session_id>" }, 403)
        // 這支 function 沒有全域 try/catch，查詢若拋例外會變成 500；包起來並「失敗即拒絕」
        let chairId = ""
        try {
          const chk = await fetch(
            `${SUPABASE_URL}/rest/v1/premortem_sessions?id=eq.${encodeURIComponent(sid)}&select=chair_emp_id`,
            { headers: elevatedApiHeaders(SERVICE_KEY) },
          )
          const rows = chk.ok ? await chk.json() : []
          chairId = Array.isArray(rows) && rows[0] ? String(rows[0].chair_emp_id || "") : ""
        } catch { chairId = "" }
        if (!chairId || chairId !== sessEmpId) {
          return json({ error: "forbidden", hint: "only the chair of this session may change it" }, 403)
        }
      }
      body = rawText
    } else if (table === "chat_sessions" && req.method === "PATCH" && rawText) {
      // ── 線上對話：status/keep/title 只有開啟者改得動 ──
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(rawText) } catch { return json({ error: "bad_json" }, 400) }
      const keys = Object.keys(parsed || {})
      if (keys.some((k) => CHAT_IMMUTABLE.has(k))) {
        return json({ error: "forbidden", hint: "host_emp_id/id are immutable" }, 403)
      }
      if (keys.some((k) => CHAT_HOST_ONLY.has(k))) {
        const idFilter = url.searchParams.get("id") || ""
        const sid = idFilter.startsWith("eq.") ? idFilter.slice(3) : ""
        if (!sid) return json({ error: "forbidden", hint: "protected fields require ?id=eq.<session_id>" }, 403)
        let hostId = ""
        try {
          const chk = await fetch(
            `${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${encodeURIComponent(sid)}&select=host_emp_id`,
            { headers: elevatedApiHeaders(SERVICE_KEY) },
          )
          const rows = chk.ok ? await chk.json() : []
          hostId = Array.isArray(rows) && rows[0] ? String(rows[0].host_emp_id || "") : ""
        } catch { hostId = "" }
        if (!hostId || hostId !== sessEmpId) {
          return json({ error: "forbidden", hint: "only the host of this chat may change it" }, 403)
        }
      }
      body = rawText
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
