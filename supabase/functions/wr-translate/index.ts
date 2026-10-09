// wr-translate：Woody 週報的閱讀譯文（English／Tiếng Việt／简体中文），翻一次存起來（board v1.99，2026-10-09 Woody）
//
// 🔴 譯文只在這裡產生、只由這裡寫進 woody_report_tr（service role）。同仁的瀏覽器只能「要」譯文，
//    不能「給」譯文 —— 否則任何人都能偽造 Woody 週報的越南文版給越南同仁看。
// 🔴 快取鍵是 (report_id, lang) ＋ 原文指紋 hash：Woody 改了中文，指紋變了，下次閱讀自動重翻。
// 🔴 翻譯規則直接引用 shared/translate.js（全平台同一份），不在這裡複製一份（CLAUDE.md：各存一份必然分岔）。
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { verifySession } from "../_shared/session.ts"
import { namedSecretKey, elevatedApiHeaders } from "../_shared/api-keys.ts"
import "../../../shared/translate.js"
import { LANGS, SECTION_KEYS, sha256, sourceOf, footerSource, parseTag } from "./lib.js"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session",
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } })
const sbUrl = () => Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || ""
const sbHdr = () => elevatedApiHeaders(namedSecretKey("kms_edge"))
const MODEL = "claude-opus-5-5"
const CT = (globalThis as any).ComartTranslate

async function sbGet(path: string) {
  const r = await fetch(`${sbUrl()}/rest/v1/${path}`, { headers: sbHdr() })
  if (!r.ok) throw new Error("db_read_failed " + r.status)
  return await r.json()
}
async function isCliKey(req: Request): Promise<boolean> {
  const k = req.headers.get("apikey") || ""
  if (!k) return false
  try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")).some((v) => typeof v === "string" && v && v === k) }
  catch { return false }
}
async function liveUser(empId: string) {
  const rows = await sbGet(`users?emp_id=eq.${encodeURIComponent(empId)}&select=emp_id,active,status`)
  const u = rows?.[0]
  return u && u.active !== false && u.status !== "disabled" && u.status !== "resigned" ? u : null
}

const INTRO = "You translate Woody Liu's weekly report. Woody is the CEO of COMART, a Taiwanese OEM/ODM maker of mobile and automotive " +
  "accessories with factories in China and Vietnam. He writes this report to all staff every week in Traditional Chinese, in the first " +
  "person, in a direct, plain-spoken style. Readers are COMART colleagues."
const EXTRA = (lang: string) =>
  "- Keep Woody's first-person voice, directness and tone strength; do not turn it into corporate boilerplate.\n" +
  "- The input is one section of the report. It may contain lists, URLs, book titles and quotes or ideas from named colleagues " +
  "(keep who said what).\n" +
  (lang === "zh-CN"
    ? "- Target is Simplified Chinese: convert the script and use mainland wording only where the regional term differs; otherwise do not rewrite.\n"
    : "") +
  (lang === "vi" ? "- Woody is writing to his staff: address readers as a group consistently (e.g. \"các bạn\"), and never mix registers.\n" : "")
const OUTPUT = "Output only the translation inside <t></t>. No notes, no explanations."

async function claude(system: string, user: string, maxTokens: number): Promise<string> {
  const key = Deno.env.get("CLAUDE_API_KEY") || ""
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, output_config: { effort: "low" }, system, messages: [{ role: "user", content: user }] }),
  })
  if (!r.ok) throw new Error("upstream " + r.status)
  const j = await r.json()
  return (j.content || []).map((b: any) => b.text || "").join("")
}

// 一段一個請求、並行：一份週報兩三千字，整份一次翻要 60 秒以上；分段並行約十幾到二十幾秒，一段失敗也只重試那一段
async function translateSections(src: Record<string, string>, lang: string) {
  const system = CT.sys(INTRO, EXTRA(lang), OUTPUT)
  const out: Record<string, string> = {}
  await Promise.all(Object.entries(src).map(async ([k, v]) => {
    if (!v) { out[k] = ""; return }
    let last = ""
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await claude(system, `Translate into ${LANGS[lang as keyof typeof LANGS]}:\n\n<src>\n${v}\n</src>`,
        Math.min(16000, v.length * 6 + 600))
      const t = parseTag(text, "t"); last = text
      if (t && t.trim()) { out[k] = t; return }
    }
    throw new Error("empty_translation " + k + " " + last.slice(0, 80))
  }))
  return out
}

async function cached(reportId: string, lang: string, hash: string) {
  const rows = await sbGet(`woody_report_tr?report_id=eq.${encodeURIComponent(reportId)}&lang=eq.${encodeURIComponent(lang)}&select=hash,sections`)
  return rows?.[0]?.hash === hash ? rows[0].sections : null
}
async function store(reportId: string, lang: string, hash: string, sections: Record<string, string>) {
  const r = await fetch(`${sbUrl()}/rest/v1/woody_report_tr?on_conflict=report_id,lang`, {
    method: "POST",
    headers: { ...sbHdr(), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ report_id: reportId, lang, hash, sections, model: MODEL, created_at: new Date().toISOString() }),
  })
  if (!r.ok) console.warn("[wr-translate] cache write failed", r.status)   // 寫不進快取不影響這一次回傳，只是下次要再翻
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method" }, 405)
  // 本機腳本帶專案 secret key（那把鑰匙本來就有全權）可直接呼叫，用來測試與預先翻譯
  if (!(await isCliKey(req))) {
    const who = await verifySession(req.headers.get("x-session") || "")
    if (!who?.empId) return json({ error: "unauthorized" }, 401)
    try { if (!await liveUser(String(who.empId))) return json({ error: "inactive" }, 403) }
    catch { return json({ error: "db_error" }, 500) }
  }
  let body: any
  try { body = await req.json() } catch { return json({ error: "bad_json" }, 400) }
  const lang = String(body?.lang || "")
  if (!(lang in LANGS)) return json({ error: "bad_lang" }, 400)
  if (!CT?.sys) return json({ error: "rules_not_loaded" }, 500)   // 沒有翻譯規則寧可失敗（shared/translate.js 的原則）

  try {
    // 週報固定的「OKR 原則／知識學習平台」：內容由頁面送來，但譯文仍是這裡產生、以內容指紋為鍵 ——
    // 有人送別的內容只會存到另一個指紋，正常頁面永遠不會拿到它
    if (body.footer) {
      const src = footerSource(body.footer)
      if (!Object.keys(src).length) return json({ error: "bad_footer" }, 400)
      const hash = await sha256(JSON.stringify(src))
      const hit = await cached("__footer__", lang, hash)
      if (hit) return json({ sections: hit, cached: true })
      const sections = await translateSections(src, lang)
      await store("__footer__", lang, hash, sections)
      return json({ sections, cached: false })
    }
    const id = String(body?.id || "")
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "bad_id" }, 400)
    const rows = await sbGet(`woody_reports?id=eq.${encodeURIComponent(id)}&select=id,${SECTION_KEYS.join(",")}`)
    const row = rows?.[0]
    if (!row) return json({ error: "not_found" }, 404)
    const src = sourceOf(row)
    const hash = await sha256(JSON.stringify(src))
    const hit = await cached(id, lang, hash)
    if (hit) return json({ sections: hit, cached: true })
    const sections = await translateSections(src, lang)
    await store(id, lang, hash, sections)
    return json({ sections, cached: false })
  } catch (e) {
    return json({ error: "translate_failed", detail: String((e as Error).message).slice(0, 300) }, 502)
  }
})
