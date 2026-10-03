// ═══════════════════════════════════════════════════════════════════════
// flight-schedule — 航班定期時刻表（admin 機場接送的「查詢航班」）
//
// 🔴 為什麼不再只靠 claude-proxy + web search（2026-09-30）：
//    使用者回報 10/11 CI601 的時間「與華航差了五分鐘」。那不是模型算錯，是來源：
//    web search 讀到哪一個第三方網站就用哪一個，而它們彼此就不一致
//    （同一天查，一個寫 07:20、一個寫 07:25），而且常常拿「上週的實際起飛」
//    當成班表。這種錯**每次查都可能不同**，而錯五分鐘不會有人察覺，
//    直到司機晚到。
//    TDX（交通部運輸資料流通服務）的定期時刻表是航空公司報給民航局的班表，
//    也是舊系統（comart-car-booking）原本用的來源。
//
// 需要兩個 secret：TDX_CLIENT_ID／TDX_CLIENT_SECRET
//   （https://tdx.transportdata.tw 免費註冊 → 會員中心 → API 金鑰）。
// 沒設定時回 { ok:false, reason:'tdx_not_configured' }，前端會退回網路搜尋，
// 並且在畫面上明講「這是網路搜尋的結果，請與機票核對」。
//
// 驗證：與 claude-proxy 同一套 x-session。
// ═══════════════════════════════════════════════════════════════════════
import { verifySession } from "../_shared/session.ts"
import { pickSchedule, normFlight } from "./schedule.js"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session",
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
const API = "https://tdx.transportdata.tw/api/basic/v2/Air/GeneralSchedule"

// token 有效一天；同一個 isolate 內重用，提早 5 分鐘換
let tok: { v: string; exp: number } | null = null
async function tdxToken(id: string, secret: string): Promise<string> {
  if (tok && Date.now() < tok.exp) return tok.v
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  })
  if (!r.ok) {
    // 帶出 TDX 的錯誤代碼（invalid_client／unauthorized_client…），不含任何金鑰內容 ——
    // 只有狀態碼的話分不出是「金鑰錯」還是「帳號還沒啟用」
    let code = ""
    try { const e = await r.json(); code = String(e.error || "") + (e.error_description ? ":" + String(e.error_description).slice(0, 80) : "") } catch { /* 非 JSON */ }
    throw new Error(`tdx_token_${r.status}${code ? "_" + code : ""}`)
  }
  const j = await r.json()
  if (!j.access_token) throw new Error("tdx_token_empty")
  tok = { v: j.access_token, exp: Date.now() + Math.max(60, (Number(j.expires_in) || 3600) - 300) * 1000 }
  return tok.v
}

async function tdxQuery(kind: "International" | "Domestic", flight: string, token: string) {
  const filter = encodeURIComponent(`FlightNumber eq '${flight}'`)
  const r = await fetch(`${API}/${kind}?$filter=${filter}&$top=200&$format=JSON`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  })
  if (r.status === 401) tok = null   // token 被撤銷時下一次重拿
  if (!r.ok) throw new Error(`tdx_${kind}_${r.status}`)
  const j = await r.json()
  return Array.isArray(j) ? j : []
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405)

  const sess = await verifySession(req.headers.get("x-session") || "")
  if (!sess) return json({ ok: false, reason: "unauthorized" }, 401)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ ok: false, reason: "bad_request" }, 400) }
  const flight = normFlight(body.flight)
  const date = String(body.date || "")
  // 班號只收「兩碼航空代碼 + 1–4 位數字」：它會被拼進 OData 的 $filter
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(flight) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, reason: "bad_request" }, 400)
  }

  // 🔴 trim：從網頁後台貼上的值常常帶著前後空白或換行，TDX 會直接回 400 invalid_client
  const id = (Deno.env.get("TDX_CLIENT_ID") || "").trim()
  const secret = (Deno.env.get("TDX_CLIENT_SECRET") || "").trim()
  if (!id || !secret) return json({ ok: false, reason: "tdx_not_configured" })

  try {
    const token = await tdxToken(id, secret)
    let res = pickSchedule(await tdxQuery("International", flight, token), flight, date)
    // 國內線（松山—金門之類）只在國際線查不到這個班號時才查，省一次請求
    if (!res.known) res = pickSchedule(await tdxQuery("Domestic", flight, token), flight, date)
    return json({ ok: true, source: "TDX 定期航班時刻表", ...res })
  } catch (e) {
    console.warn("[flight-schedule]", flight, date, String((e as Error)?.message || e))
    return json({ ok: false, reason: "tdx_error", detail: String((e as Error)?.message || e) }, 502)
  }
})
