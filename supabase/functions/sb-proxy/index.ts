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
  "chat_sessions","chat_messages","chat_presence",
])

// ── 線上對話：只有開啟者本人能結束或刪除自己開的那一場 ──
// 「不保留」是整場 cascade 刪除（連同所有人的發言），比覆寫嚴重；
// status/keep/title 決定這場對話的性質與去留，同 premortem 的 phase。
// last_at 刻意不在這裡：每個人發言都要更新它，那是正常的協作寫入。
// members 也只有開啟者改得動：那份清單決定誰讀得到這場對話的內容，
// 任何參與者都能自行加人的話，「只有參與人可以開啟」就沒有意義了。
// ended_at 與 status 是同一件事的兩半（v2.03 發起人可以重新開啟已結束的場次），
// 少鎖一個就等於沒鎖：只改 ended_at 也會讓清單上的時間變成別人說了算
const CHAT_HOST_ONLY = new Set(["status", "keep", "title", "members", "ended_at"])
// 線上對話可以刪除整場的角色：開啟者本人，或 admin
const CHAT_DELETE_ROLES = new Set(["admin"])
// 開啟者是整套權限的根，建立後不可改（改掉就等於把別人開的場次搶過來）
const CHAT_IMMUTABLE = new Set(["host_emp_id", "id", "access"])
// 🔴 邀請連結的通行碼（Portal v2.04）。**不可被任何人改寫** —— 改得動就等於
//    有人可以把 code 換成自己知道的值，再用那個值把自己加進別人的對話。
//    它也不在 CHAT_IMMUTABLE 裡：PATCH 只帶 {join_code} 是「持通行證加入」
//    這個動作的暗號（見下方 chat_sessions 的分支），不是要寫進資料庫。
const CHAT_JOIN_FIELD = "join_code"

// ── 線上對話：單則訊息的修改與刪除（v2.01）──
// 三組欄位，三種授權。**分組的依據是「改壞了會怎樣」，不是欄位長得像不像**：
//   FROZEN  身分與時間 —— 誰都不能改。改掉 emp_id 就等於把話塞到別人嘴裡。
//   TEXT    訊息本文 —— **只有作者本人**。發起人可以刪別人的訊息，但絕不可以
//           改別人的字：刪除是「拿掉」（看得出來），改寫是「換掉」（看不出來）。
//   WIPE    刪除時要抹掉的內容欄位 —— 作者或該場發起人。
//   TR      四語譯文 —— 作者或發起人（孤兒訊息由發起人補翻，見 lcPoll）。
const CHAT_MSG_FROZEN = new Set(["id", "session_id", "emp_id", "author_name", "created_at", "updated_at"])
const CHAT_MSG_TEXT   = new Set(["text", "edited_at"])
const CHAT_MSG_WIPE   = new Set([
  "deleted_at", "deleted_by", "text", "src_lang",
  "text_zhtw", "text_zhcn", "text_en", "text_vi", "tr_at",
  "img_path", "img_name", "img_mime", "img_w", "img_h",
])
const CHAT_MSG_TR = new Set(["src_lang", "text_zhtw", "text_zhcn", "text_en", "text_vi", "tr_at"])

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

// 🔴 角色一律重新查資料庫，不讀簽章裡的 role：簽章是登入當時簽發的，
//    降權之後舊 token 在有效期內還是帶著舊角色。停用／離職者一律不算。
//    查詢失敗回空字串（fail-closed，呼叫端一律當成「沒有角色」）。
async function liveRoleOf(SUPABASE_URL: string, SERVICE_KEY: string, empId: string): Promise<string> {
  if (!empId) return ""
  try {
    const ur = await fetch(
      `${SUPABASE_URL}/rest/v1/users?emp_id=eq.${encodeURIComponent(empId)}&select=role,active,status`,
      { headers: elevatedApiHeaders(SERVICE_KEY) },
    )
    const rows = ur.ok ? await ur.json() : []
    const u = Array.isArray(rows) && rows[0] ? rows[0] : null
    if (u && u.active !== false && u.status !== "disabled" && u.status !== "resigned") return String(u.role || "")
  } catch { /* fall through */ }
  return ""
}

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
      // 停用／離職者一律不給，即使 role 還是 admin（判斷在 liveRoleOf 裡）
      const liveRole = await liveRoleOf(SUPABASE_URL, SERVICE_KEY, sessEmpId)
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

  // ── 線上對話：不接受硬刪除單則訊息 ──
  // 刪除的語意是「留下一格『本訊息已刪除！』」，那要靠列還在才做得到。
  // 前端一律走 PATCH（軟刪除 ＋ 抹掉內容）；真的要整列消失只有「整場刪除」那條路（cascade）。
  // 🔴 不擋的話，任何持有 session 的人都能把別人的訊息整列抹掉、連痕跡都不留。
  if (req.method === "DELETE" && table === "chat_messages") {
    return json({ error: "forbidden", hint: "messages are soft-deleted via PATCH" }, 403)
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
      // 開啟者以外，只有「當下真的是 admin」的人刪得掉（使用者 2026-09-05 指定）
      const liveRole = await liveRoleOf(SUPABASE_URL, SERVICE_KEY, sessEmpId)
      if (!CHAT_DELETE_ROLES.has(liveRole)) {
        return json({ error: "forbidden", hint: "only the host or an admin may delete this chat" }, 403)
      }
    }
  }

  // 寫入 users 時剝除 pwd_hash（密碼只能經 auth-verify；防止有人用本代理改密碼雜湊）；
  // 自助 PATCH 再套欄位白名單（不得改 role/active/emp_id 等）
  let body: string | undefined = undefined
  let chatJoin = false   // 這一次 PATCH 是不是「持邀請連結加入」（見 chat_sessions 分支）
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
    } else if (table === "chat_presence" && rawText) {
      // ── 在線名單：emp_id 一律改寫成簽章裡的身分 ──
      // 這張表任何人都寫得（每個人要能報告自己在線），所以唯一需要擋的是
      // 「幫別人報告在線」—— 那會讓房裡出現一個其實不在的人，
      // 而在線名單存在的意義就是「誰真的在」。改寫而不是拒絕：
      // 前端本來就只會寫自己，改寫對正常路徑沒有影響。
      try {
        const parsed = JSON.parse(rawText)
        const own = (o: Record<string, unknown>) => { o.emp_id = sessEmpId; return o }
        body = JSON.stringify(Array.isArray(parsed) ? parsed.map(own) : own(parsed))
      } catch { return json({ error: "bad_json" }, 400) }
    } else if (table === "chat_messages" && req.method === "POST" && rawText) {
      // ── 送出訊息：發話者一律改寫成簽章裡的身分 ──
      // 「作者」在新的刪除／修改規則裡是權限的根（本人可改可刪），所以它不能是
      // 前端說了算的欄位。改寫而不是拒絕：正常路徑本來就只會送自己（同 chat_presence）。
      // 冒用時連同 author_name 一起丟掉，讓畫面退回顯示工號 —— 留著假名字
      // 等於改寫了 emp_id 卻還是看到別人的名字。
      try {
        const parsed = JSON.parse(rawText)
        const own = (o: Record<string, unknown>) => {
          if (String(o.emp_id || "") !== sessEmpId) { o.emp_id = sessEmpId; delete o.author_name }
          return o
        }
        body = JSON.stringify(Array.isArray(parsed) ? parsed.map(own) : own(parsed))
      } catch { return json({ error: "bad_json" }, 400) }
    } else if (table === "chat_messages" && req.method === "PATCH" && rawText) {
      // ── 單則訊息：誰能改什麼 ──
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(rawText) } catch { return json({ error: "bad_json" }, 400) }
      const keys = Object.keys(parsed || {})
      if (keys.some((k) => CHAT_MSG_FROZEN.has(k))) {
        return json({ error: "forbidden", hint: "id/session_id/emp_id/author_name/created_at are immutable" }, 403)
      }
      // 🔴 只認 ?id=eq.<訊息 id>。不限定的話，一個
      //    PATCH chat_messages?session_id=eq.X 就能把整場的訊息一次改掉／清空。
      const midFilter = url.searchParams.get("id") || ""
      const mid = midFilter.startsWith("eq.") ? midFilter.slice(3) : ""
      if (!mid) return json({ error: "forbidden", hint: "patch requires ?id=eq.<message_id>" }, 403)

      // 查失敗一律拒絕（fail-closed，同 premortem 的守衛）
      let authorId = "", msgSid = ""
      try {
        const chk = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_messages?id=eq.${encodeURIComponent(mid)}&select=emp_id,session_id`,
          { headers: elevatedApiHeaders(SERVICE_KEY) },
        )
        const rows = chk.ok ? await chk.json() : []
        if (Array.isArray(rows) && rows[0]) {
          authorId = String(rows[0].emp_id || "")
          msgSid   = String(rows[0].session_id || "")
        }
      } catch { authorId = "" }
      if (!authorId) return json({ error: "forbidden", hint: "message not found" }, 403)

      const isAuthor = authorId === sessEmpId
      let isHost = false
      if (!isAuthor && msgSid) {
        // 只有不是作者時才多查一次：自己改自己的訊息（含譯文寫回）是最常走的路徑，
        // 不該為了守衛多付一次查詢
        try {
          const chk2 = await fetch(
            `${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${encodeURIComponent(msgSid)}&select=host_emp_id`,
            { headers: elevatedApiHeaders(SERVICE_KEY) },
          )
          const rows2 = chk2.ok ? await chk2.json() : []
          isHost = !!(Array.isArray(rows2) && rows2[0] && String(rows2[0].host_emp_id || "") === sessEmpId)
        } catch { isHost = false }
      }
      if (!isAuthor && !isHost) {
        return json({ error: "forbidden", hint: "only the author or the host of this chat may change a message" }, 403)
      }

      if ("deleted_at" in parsed) {
        // ── 刪除 ──
        // 🔴 deleted_at 只能設成有值，不能清成 null：痕跡是永久的。
        //    可以「復原」的話，發起人就能把不利的內容刪掉、事後再說「沒有刪過」。
        if (!parsed.deleted_at) {
          return json({ error: "forbidden", hint: "deleted_at cannot be cleared" }, 403)
        }
        if (keys.some((k) => !CHAT_MSG_WIPE.has(k))) {
          return json({ error: "forbidden", hint: "a delete may only wipe content fields" }, 403)
        }
        // 刪除者一律改寫成簽章裡的身分（同 chat_presence 的做法）：
        // 不改寫的話可以把刪除嫁禍給別人，而 deleted_by 正是唯一的追究依據
        parsed.deleted_by = sessEmpId
        body = JSON.stringify(parsed)
      } else {
        // ── 修改 / 譯文寫回 ──
        if (keys.some((k) => k === "deleted_by")) {
          return json({ error: "forbidden", hint: "deleted_by is set by the server" }, 403)
        }
        // 🔴 本文只有作者改得動。發起人刪得掉別人的訊息，但改不動別人的字。
        if (!isAuthor && keys.some((k) => CHAT_MSG_TEXT.has(k))) {
          return json({ error: "forbidden", hint: "only the author may edit the text of a message" }, 403)
        }
        if (keys.some((k) => !CHAT_MSG_TEXT.has(k) && !CHAT_MSG_TR.has(k))) {
          return json({ error: "forbidden", hint: "unexpected field in message patch" }, 403)
        }
        body = rawText
      }
    } else if (table === "chat_sessions" && req.method === "PATCH" && rawText) {
      // ── 線上對話：status/keep/title 只有開啟者改得動 ──
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(rawText) } catch { return json({ error: "bad_json" }, 400) }
      const keys = Object.keys(parsed || {})

      /* ── 持邀請連結加入（Portal v2.04）───────────────────────────────
         body 只有 {join_code} ＝「我拿著這場的通行證，把我加進去」。
         🔴 三件事全部由伺服器自己做，前端一個字都說不上話：
           ① 比對 join_code（拿得到它的只有發起人，因為回應會剝除別人的）
           ② status 必須是 open —— 已結束的是存檔，不該事後混進人
           ③ **members 由伺服器自己組**（舊名單 ∪ 簽章身分）。
              不採用前端送來的陣列：兩個人同時點連結會互相覆寫，
              而且那等於把「誰在名單裡」交還給前端決定。
         混在其他欄位裡一律拒絕：那是想藉這條路繞過 CHAT_HOST_ONLY。 */
      if (keys.includes(CHAT_JOIN_FIELD)) {
        if (keys.length !== 1) {
          return json({ error: "forbidden", hint: "join_code must be the only field" }, 403)
        }
        const idFilter = url.searchParams.get("id") || ""
        const sid = idFilter.startsWith("eq.") ? idFilter.slice(3) : ""
        if (!sid) return json({ error: "forbidden", hint: "join requires ?id=eq.<session_id>" }, 403)
        let row: Record<string, unknown> | null = null
        try {
          const chk = await fetch(
            `${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${encodeURIComponent(sid)}&select=host_emp_id,status,members,join_code`,
            { headers: elevatedApiHeaders(SERVICE_KEY) },
          )
          const rows = chk.ok ? await chk.json() : []
          row = Array.isArray(rows) && rows[0] ? rows[0] : null
        } catch { row = null }
        // 查不到就拒絕（fail-closed，同 premortem 欄位守衛的判斷）
        if (!row) return json({ error: "not_found" }, 404)
        const code = String(parsed[CHAT_JOIN_FIELD] || "")
        if (!code || code !== String(row.join_code || "")) {
          return json({ error: "bad_join_code" }, 403)
        }
        if (String(row.status || "") !== "open") {
          return json({ error: "chat_closed" }, 403)
        }
        const cur = Array.isArray(row.members) ? (row.members as string[]).map(String) : []
        // 已經是發起人或參與人：不必寫，直接回成功（重複點連結是常態）
        if (String(row.host_emp_id || "") === sessEmpId || cur.indexOf(sessEmpId) >= 0) {
          return json({ ok: true, joined: false })
        }
        // 由伺服器改寫成一次單純的 members 寫入，再照原路轉發
        body = JSON.stringify({ members: cur.concat([sessEmpId]) })
        chatJoin = true
      }

      if (!chatJoin && keys.some((k) => CHAT_IMMUTABLE.has(k))) {
        return json({ error: "forbidden", hint: "host_emp_id/id are immutable" }, 403)
      }
      if (!chatJoin && keys.some((k) => CHAT_HOST_ONLY.has(k))) {
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
      if (!chatJoin) body = rawText
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
  /* 🔴 邀請連結的通行碼只有**發起人自己那幾列**留得住（Portal v2.04）。
     不剝的話，一般使用者的清單查詢就把他參與的每一場的 code 都送進瀏覽器，
     而 admin 的清單是**全公司每一場** —— 那等於把「admin 讀不到別人的對話」
     直接送掉。這裡刻意不限於 GET：PATCH last_at（每個人發言都會做）
     帶 return=representation 時回的也是整列。 */
  if (table === "chat_sessions" && text) {
    try {
      const data = JSON.parse(text)
      const strip = (o: Record<string, unknown>) => {
        if (o && typeof o === "object" && String(o.host_emp_id || "") !== sessEmpId) delete o.join_code
        return o
      }
      const cleaned = Array.isArray(data) ? data.map(strip) : strip(data)
      outText = JSON.stringify(cleaned)
    } catch { /* 非 JSON（如錯誤訊息）原樣回傳 */ }
  }

  const outHeaders: Record<string, string> = { ...CORS, "Content-Type": "application/json" }
  const cr = upstream.headers.get("content-range"); if (cr) outHeaders["Content-Range"] = cr
  return new Response(outText, { status: upstream.status, headers: outHeaders })
})
