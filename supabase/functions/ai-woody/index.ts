// AI Woody —— Woody 的 AI 分身（Portal「AI 工具」的 AI Woody 頁籤）。
//
// 🔴 人格檔不在這份原始碼裡（repo 是公開的）。它存在 public.ai_personas（RLS 零 policy），
//    由這支 function 用 service role 讀出來，呼叫模型時才放進 system prompt；前端永遠拿不到。
// 🔴 不存檔：不寫資料庫、不 console.log 任何對話內容、不記誰用過（Woody 2026-10-05 決定「完全不留」）。
//    對話歷史每一輪由前端送來，所以 lib.js 的 validateMessages 會逐則驗證。
// 驗證與 claude-proxy 同一套：x-session HMAC 簽章。
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { verifySession } from "../_shared/session.ts"
import { namedSecretKey, elevatedApiHeaders } from "../_shared/api-keys.ts"
import { validateMessages, buildRequest } from "./lib.js"
import { buildReportsAppendix, normalizeDocs, buildDocsAppendix, assemble,
         OCR_PREFIX, validOcrKey, fillOcr, OCR_SYSTEM } from "./assemble.js"
import { MODEL } from "./lib.js"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session",
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } })

// 人格檔快取在這個 instance 裡 5 分鐘：每一題都去讀一次 10 萬字的資料列沒有必要，
// 而 Woody 更新人格檔後最慢 5 分鐘生效。
let personaCache: { text: string; at: number } | null = null
const PERSONA_TTL = 5 * 60 * 1000

async function loadPersona(): Promise<string> {
  if (personaCache && Date.now() - personaCache.at < PERSONA_TTL) return personaCache.text
  const url = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || ""
  const key = namedSecretKey("kms_edge")
  const r = await fetch(`${url}/rest/v1/ai_personas?id=eq.woody&select=system`, { headers: elevatedApiHeaders(key) })
  if (!r.ok) throw new Error("persona_load_failed " + r.status)
  const rows = await r.json()
  const text = rows?.[0]?.system || ""
  if (!text) throw new Error("persona_missing")
  personaCache = { text, at: Date.now() }
  return text
}

// ── 更新（只有 Woody 本人，或本機腳本帶 secret key）──
// 🔴 按鈕只送「文件抽出來的文字」，組裝一律在這裡（assemble.js）—— 同一件事只有一份實作。
// 🔴 人格正文（woody-core）按鈕不會動：那是 Woody 審閱過的，要改仍要經他看過。
const OWNER = "C00001"

function sbUrl() { return Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || "" }
async function sbGet(path: string) {
  const r = await fetch(`${sbUrl()}/rest/v1/${path}`, { headers: elevatedApiHeaders(namedSecretKey("kms_edge")) })
  if (!r.ok) throw new Error(`db_read_failed ${r.status}`)
  return r.json()
}
async function sbUpsertPersona(id: string, system: string, version: string) {
  const r = await fetch(`${sbUrl()}/rest/v1/ai_personas`, {
    method: "POST",
    headers: { ...elevatedApiHeaders(namedSecretKey("kms_edge")), "Content-Type": "application/json",
               Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, system, version, updated_at: new Date().toISOString() }),
  })
  if (!r.ok) throw new Error(`db_write_failed ${r.status}`)
}

// 圖片文字辨識的快取：ai_personas 裡 id 以 'ocr:' 開頭的資料列（一張圖一列）
async function ocrCache(): Promise<Record<string, string>> {
  const rows = await sbGet(`ai_personas?id=like.${encodeURIComponent(OCR_PREFIX + "*")}&select=id,system`)
  const m: Record<string, string> = {}
  for (const r of rows || []) m[String(r.id).slice(OCR_PREFIX.length)] = r.system
  return m
}
// 清掉已經不在資料夾裡的圖（刪掉或換過內容）。失敗不影響彙整，只是多留幾列。
async function ocrPrune(keep: string[], cache: Record<string, string>) {
  const gone = Object.keys(cache).filter((k) => !keep.includes(k))
  for (const k of gone) {
    try {
      await fetch(`${sbUrl()}/rest/v1/ai_personas?id=eq.${encodeURIComponent(OCR_PREFIX + k)}`, {
        method: "DELETE", headers: elevatedApiHeaders(namedSecretKey("kms_edge")),
      })
    } catch { /* ignore */ }
  }
}
const OCR_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"]
async function ocrOne(claudeKey: string, key: string, mime: string, data: string): Promise<string> {
  if (!validOcrKey(key)) throw new Error("bad_key")
  if (!OCR_MIME.includes(mime)) throw new Error("bad_mime")
  if (typeof data !== "string" || !data || data.length > 7_000_000) throw new Error("bad_image")
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 12000, output_config: { effort: "low" },
      system: OCR_SYSTEM,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime, data } },
        { type: "text", text: "請抄錄這張圖。" },
      ] }],
    }),
  })
  if (!r.ok) throw new Error("upstream " + r.status)
  const j = await r.json()
  const text = (j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim()
  if (!text) throw new Error("empty")
  await sbUpsertPersona(OCR_PREFIX + key, text, "ocr")
  return text
}

async function isCliKey(req: Request): Promise<boolean> {
  const k = req.headers.get("apikey") || ""
  if (!k) return false
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")
    return Object.values(keys).some((v) => typeof v === "string" && v && v === k)
  } catch { return false }
}

async function rebuild(docsIn: unknown) {
  const coreRows = await sbGet("ai_personas?id=eq.woody-core&select=system")
  const core = coreRows?.[0]?.system || ""
  if (!core) throw new Error("core_missing")
  const rows = await sbGet("woody_reports?select=report_date,work,plan,reflections,intel,feedback,other" +
    "&author_id=eq.C00001&order=report_date.asc&limit=2000")
  let docsAppendix = ""
  let docNames: string[] = []
  let ocrMissing: string[] = []
  if (docsIn === undefined) {
    // 沒送文件 ＝ 沿用上一次的附錄二
    const d = await sbGet("ai_personas?id=eq.woody-docs&select=system")
    docsAppendix = d?.[0]?.system || ""
  } else {
    // 圖片：前端只送 { folder, name, size, ocr: true }，文字從快取補
    const cache = await ocrCache()
    const f = fillOcr(docsIn, cache)
    ocrMissing = f.missing
    await ocrPrune(f.used, cache)
    const n = normalizeDocs(f.docs)
    if (n.error) throw new Error(n.error)
    docsAppendix = buildDocsAppendix(n.docs)
    docNames = n.docs.map((x: { folder: string; name: string }) => `${x.folder}/${x.name}`)
    await sbUpsertPersona("woody-docs", docsAppendix, String(n.docs.length))
  }
  const system = assemble(core, buildReportsAppendix(rows), docsAppendix)
  const version = rows.length ? rows[rows.length - 1].report_date : ""
  await sbUpsertPersona("woody", system, version)
  personaCache = null
  return { reports: rows.length, latest: version, docs: docsIn === undefined ? null : docNames, ocrMissing, chars: system.length }
}

function todayTaipei(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  try {
    const CLAUDE_KEY = Deno.env.get("CLAUDE_API_KEY")
    if (!CLAUDE_KEY) return json({ error: "CLAUDE_API_KEY not set" }, 500)

    const who = await verifySession(req.headers.get("x-session") || "")
    if (!who && !(await isCliKey(req))) return json({ error: "unauthorized" }, 401)

    let body: any
    try { body = await req.json() } catch { return json({ error: "bad_json" }, 400) }

    if (["rebuild", "status", "ocrList", "ocr"].includes(body?.action)) {
      if (who?.empId !== OWNER && !(await isCliKey(req))) return json({ error: "forbidden" }, 403)
      if (body.action === "status") {
        const r = await sbGet("ai_personas?id=in.(woody,woody-docs)&select=id,version,updated_at")
        return json({ ok: true, rows: r })
      }
      if (body.action === "ocrList") {
        try { return json({ ok: true, keys: Object.keys(await ocrCache()) }) }
        catch (e) { return json({ error: (e as Error).message }, 500) }
      }
      if (body.action === "ocr") {
        try { const text = await ocrOne(CLAUDE_KEY, body.key, body.mime, body.data); return json({ ok: true, chars: text.length }) }
        catch (e) { return json({ error: (e as Error).message }, 502) }
      }
      try { return json({ ok: true, ...(await rebuild(body.docs)) }) }
      catch (e) { return json({ error: (e as Error).message }, 500) }
    }

    const bad = validateMessages(body?.messages)
    if (bad) return json({ error: bad }, 400)

    let persona: string
    try { persona = await loadPersona() } catch (e) { return json({ error: (e as Error).message }, 503) }

    const payload = buildRequest(persona, body.messages, todayTaipei(), String(body?.lang || ""))
    const callUpstream = (p: Record<string, unknown>, beta: boolean) =>
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_KEY,
          "anthropic-version": "2023-06-01",
          ...(beta ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
        },
        body: JSON.stringify(p),
      })
    let upstream = await callUpstream(payload, true)
    // 🔴 自動備援（fallbacks）是 beta 參數；帳號沒開通或格式改了會回 400。
    //    那時拿掉它重送一次 —— 備援只是保險，不該讓整個功能因為它壞掉。
    if (upstream.status === 400) {
      const { fallbacks: _drop, ...plain } = payload as Record<string, unknown>
      upstream = await callUpstream(plain, false)
    }

    if (!upstream.ok) {
      // 只回狀態與錯誤型別，不回上游原文（可能夾帶請求片段）
      let type = ""
      try { type = (await upstream.json())?.error?.type || "" } catch { /* ignore */ }
      return json({ error: "upstream", status: upstream.status, type }, upstream.status === 429 ? 429 : 502)
    }
    return new Response(upstream.body, {
      status: 200,
      headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
    })
  } catch (e) {
    return json({ error: "internal", message: (e as Error).message }, 500)
  }
})
