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
import { validateMessages, buildRequest, normalizeMode, OWNER_MODES, MODEL, INTRO_RULES, parseIntro, introUserText } from "./lib.js"
import { pickQuestions, publicQuestion, validateAnswers, gradeRequestText, parseGrades, examTotal, judgeRequestText, parseJudge, EXAM_N, EXAM_PASS } from "./exam.js"
import { buildReportsAppendix, normalizeDocs, buildDocsAppendix, assemble, kmsToDocs, KMS_CATEGORY } from "./assemble.js"

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
// 🔴 文件來源是 KMS「Woody 推薦閱讀」分類（伺服器自己讀），組裝一律在這裡（assemble.js）。
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

// 本機腳本（scripts/ai-woody-push.py）帶專案的 secret key 呼叫：那把鑰匙本來就有全權
async function isCliKey(req: Request): Promise<boolean> {
  const k = req.headers.get("apikey") || ""
  if (!k) return false
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")
    return Object.values(keys).some((v) => typeof v === "string" && v && v === k)
  } catch { return false }
}


// ── 入職考試 ＆ 一致性檢查（2026-10-08）──
async function sbWrite(method: string, path: string, body: unknown, prefer = "return=minimal") {
  const r = await fetch(`${sbUrl()}/rest/v1/${path}`, {
    method,
    headers: { ...elevatedApiHeaders(namedSecretKey("kms_edge")), "Content-Type": "application/json", Prefer: prefer },
    body: body == null ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`db_write_failed ${r.status}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}
// 姓名、部門、角色一律重新查資料庫（簽章裡沒有姓名，角色也可能已經變了）
async function liveUser(empId: string) {
  const rows = await sbGet(`users?emp_id=eq.${encodeURIComponent(empId)}&select=emp_id,name_zh,name_en,dept,site,role,active,status`)
  const u = rows?.[0]
  if (!u || u.active === false || u.status === "disabled" || u.status === "resigned") return null
  return u
}
async function claudeText(claudeKey: string, body: Record<string, unknown>): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error("upstream " + r.status)
  const j = await r.json()
  return (j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("")
}
const UUID_RE = /^[0-9a-f-]{36}$/i
const GRADER_SYS = "你是 COMART 入職考試的評分老師。評分標準是 Woody（執行長）訂的公司價值觀與工作守則，題目附有評分要點。公正、具體、一致；不因文筆或字數加減分。"

// KMS「Woody 推薦閱讀」單篇導讀：讀文件 → 產生五語 → 寫回 kms_documents.wr_intro（service role）
async function makeIntro(claudeKey: string, id: string, force: boolean) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("bad_id")
  const rows = await sbGet(`kms_documents?id=eq.${id}&category=eq.${KMS_CATEGORY}&select=id,title,body,tags,wr_intro`)
  const doc = rows?.[0]
  if (!doc) throw new Error("not_found")
  if (doc.wr_intro && !force) return { skipped: true, intro: doc.wr_intro }
  const persona = await loadPersona()
  const call = () => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 8000, output_config: { effort: "low" },
      system: [
        { type: "text", text: persona, cache_control: { type: "ephemeral" } },
        { type: "text", text: INTRO_RULES },
      ],
      messages: [{ role: "user", content: introUserText(doc) }],
    }),
  })
  let intro = null
  for (let i = 0; i < 2 && !intro; i++) {      // 少一種語言就再試一次
    const r = await call()
    if (!r.ok) throw new Error("upstream " + r.status)
    const j = await r.json()
    intro = parseIntro((j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join(""))
  }
  if (!intro) throw new Error("incomplete")
  const w = await fetch(`${sbUrl()}/rest/v1/kms_documents?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...elevatedApiHeaders(namedSecretKey("kms_edge")), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ wr_intro: intro, wr_intro_at: new Date().toISOString() }),
  })
  if (!w.ok) throw new Error("db_write_failed " + w.status)
  return { skipped: false, intro }
}

async function rebuild() {
  const coreRows = await sbGet("ai_personas?id=eq.woody-core&select=system")
  const core = coreRows?.[0]?.system || ""
  if (!core) throw new Error("core_missing")
  const rows = await sbGet("woody_reports?select=report_date,work,plan,reflections,intel,feedback,other" +
    "&author_id=eq.C00001&order=report_date.asc&limit=2000")
  // 附錄二：KMS「Woody 推薦閱讀」分類裡已發佈的文件（只有 Woody 本人寫得進那個分類，見 kms-write／sb-proxy）
  const kms = await sbGet(`kms_documents?category=eq.${KMS_CATEGORY}&status=eq.published` +
    "&select=title,body,tags,file_name&order=created_at.asc&limit=1000")
  const n = normalizeDocs(kmsToDocs(kms))
  if (n.error) throw new Error(n.error)
  const docsAppendix = buildDocsAppendix(n.docs)
  await sbUpsertPersona("woody-docs", docsAppendix, String(n.docs.length))
  const system = assemble(core, buildReportsAppendix(rows), docsAppendix)
  const version = rows.length ? rows[rows.length - 1].report_date : ""
  await sbUpsertPersona("woody", system, version)
  personaCache = null
  return { reports: rows.length, latest: version, docs: n.docs.length, chars: system.length }
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

    // ── 入職考試：全體在職同仁 ──
    if (typeof body?.action === "string" && body.action.startsWith("exam")) {
      if (!who) return json({ error: "unauthorized" }, 401)
      const me = await liveUser(who.empId)
      if (!me) return json({ error: "inactive" }, 403)
      const a = body.action
      if (a === "examStatus") {
        const rows = await sbGet("aw_exam_bank?active=eq.true&select=id")
        return json({ ok: true, ready: (rows || []).length >= EXAM_N, pass: EXAM_PASS, n: EXAM_N })
      }
      if (a === "examStart") {
        const bank = await sbGet("aw_exam_bank?active=eq.true&select=*")
        if ((bank || []).length < EXAM_N) return json({ error: "bank_not_ready" }, 503)
        // 同一個人同時只有一份作答中；重新開始＝放棄上一份（重考會重抽題目）
        await sbWrite("PATCH", `aw_exam_attempts?emp_id=eq.${encodeURIComponent(who.empId)}&status=eq.open`, { status: "abandoned" })
        const qs = pickQuestions(bank)
        const row = await sbWrite("POST", "aw_exam_attempts", {
          emp_id: who.empId, emp_name: me.name_zh || me.name_en || who.empId, dept: me.dept || "", site: me.site || "",
          question_ids: qs.map((q: { id: string }) => q.id), lang: String(body.lang || ""),
        }, "return=representation")
        return json({ ok: true, attemptId: row?.[0]?.id, questions: qs.map(publicQuestion), pass: EXAM_PASS })
      }
      if (a === "examSubmit") {
        const id = String(body.attemptId || "")
        if (!UUID_RE.test(id)) return json({ error: "bad_attempt" }, 400)
        const att = (await sbGet(`aw_exam_attempts?id=eq.${id}&select=*`))?.[0]
        if (!att || att.emp_id !== who.empId) return json({ error: "not_found" }, 404)
        if (att.status !== "open") return json({ error: "already_submitted" }, 409)
        const bad = validateAnswers(att.question_ids, body.answers)
        if (bad) return json({ error: bad }, 400)
        const bank = await sbGet(`aw_exam_bank?id=in.(${att.question_ids.map((x: string) => `"${x}"`).join(",")})&select=*`)
        const qs = att.question_ids.map((qid: string) => bank.find((b: { id: string }) => b.id === qid)).filter(Boolean)
        const lang = String(body.lang || att.lang || "zh-TW")
        let results = null
        for (let i = 0; i < 2 && !results; i++) {
          const txt = await claudeText(CLAUDE_KEY, {
            model: MODEL, max_tokens: 8000, output_config: { effort: "medium" },
            system: GRADER_SYS,
            messages: [{ role: "user", content: gradeRequestText(qs, body.answers, lang) }],
          })
          results = parseGrades(txt, att.question_ids)
        }
        if (!results) return json({ error: "grading_failed" }, 502)
        const { total, passed } = examTotal(results)
        await sbWrite("PATCH", `aw_exam_attempts?id=eq.${id}&status=eq.open`, {
          answers: body.answers, results, total, passed, status: "graded", graded_at: new Date().toISOString(),
        })
        return json({ ok: true, total, passed, pass: EXAM_PASS,
          results: results.map((r: { id: string }) => ({ ...r, question: qs.find((q: { id: string }) => q.id === r.id)?.question || "" })) })
      }
      if (a === "examMine") {
        const rows = await sbGet(`aw_exam_attempts?emp_id=eq.${encodeURIComponent(who.empId)}&status=eq.graded` +
          "&select=id,total,passed,graded_at,question_ids,answers,results&order=graded_at.desc&limit=50")
        const ids = [...new Set((rows || []).flatMap((r: { question_ids: string[] }) => r.question_ids))]
        const bank = ids.length ? await sbGet(`aw_exam_bank?id=in.(${ids.map((x) => `"${x}"`).join(",")})&select=id,question`) : []
        const qmap = Object.fromEntries((bank || []).map((b: { id: string; question: string }) => [b.id, b.question]))
        return json({ ok: true, pass: EXAM_PASS, attempts: rows, questions: qmap })
      }
      if (a === "examAll") {
        // 全公司成績：Woody 與 admin（Woody 定案）。角色當下重查，不讀簽章
        if (who.empId !== OWNER && me.role !== "admin") return json({ error: "forbidden" }, 403)
        const rows = await sbGet("aw_exam_attempts?status=eq.graded&select=emp_id,emp_name,dept,site,total,passed,graded_at&order=graded_at.desc&limit=5000")
        return json({ ok: true, pass: EXAM_PASS, attempts: rows })
      }
      return json({ error: "unknown_action" }, 400)
    }

    // ── 一致性檢查：只有 Woody（或本機 secret key）。由 Woody 的瀏覽器逐題呼叫 evalOne，
    //    避開 edge function 的執行時間上限（20 題 × 作答＋評審 一次跑完會逾時）──
    if (typeof body?.action === "string" && body.action.startsWith("eval")) {
      if (who?.empId !== OWNER && !(await isCliKey(req))) return json({ error: "forbidden" }, 403)
      const a = body.action
      if (a === "evalStart") {
        const items = await sbGet("aw_eval_items?active=eq.true&select=id&order=id.asc")
        if (!(items || []).length) return json({ error: "items_not_ready" }, 503)
        const pv = await sbGet("ai_personas?id=in.(woody,woody-docs)&select=id,version")
        const ver = (pv || []).find((r: { id: string }) => r.id === "woody")?.version || ""
        const docs = parseInt((pv || []).find((r: { id: string }) => r.id === "woody-docs")?.version || "0", 10) || 0
        const run = await sbWrite("POST", "aw_eval_runs", { persona_version: ver, docs_count: docs, max_total: items.length * 10 }, "return=representation")
        return json({ ok: true, runId: run?.[0]?.id, items: items.map((i: { id: string }) => i.id) })
      }
      if (a === "evalOne") {
        const runId = String(body.runId || ""), itemId = String(body.itemId || "")
        if (!UUID_RE.test(runId) || !/^[A-Za-z0-9_-]{1,20}$/.test(itemId)) return json({ error: "bad_request" }, 400)
        const item = (await sbGet(`aw_eval_items?id=eq.${itemId}&select=*`))?.[0]
        if (!item) return json({ error: "not_found" }, 404)
        const persona = await loadPersona()
        const req1 = buildRequest(persona, [{ role: "user", content: item.question }], todayTaipei(), "zh-TW", "chat") as Record<string, unknown>
        delete req1.stream; delete req1.fallbacks
        const answer = (await claudeText(CLAUDE_KEY, req1)).trim()
        let judged = null
        for (let i = 0; i < 2 && !judged; i++) {
          judged = parseJudge(await claudeText(CLAUDE_KEY, {
            model: MODEL, max_tokens: 4000, output_config: { effort: "low" },
            messages: [{ role: "user", content: judgeRequestText(item, answer) }],
          }))
        }
        if (!judged) return json({ error: "judge_failed" }, 502)
        await sbWrite("POST", "aw_eval_results?on_conflict=run_id,item_id", { run_id: runId, item_id: itemId, answer, ...judged }, "resolution=merge-duplicates,return=minimal")
        return json({ ok: true, ...judged })
      }
      if (a === "evalFinish") {
        const runId = String(body.runId || "")
        if (!UUID_RE.test(runId)) return json({ error: "bad_request" }, 400)
        const res = await sbGet(`aw_eval_results?run_id=eq.${runId}&select=score`)
        const total = (res || []).reduce((n: number, r: { score: number }) => n + (r.score || 0), 0)
        await sbWrite("PATCH", `aw_eval_runs?id=eq.${runId}`, { status: "done", total, finished_at: new Date().toISOString() })
        return json({ ok: true, total })
      }
      if (a === "evalLatest") {
        const runs = await sbGet("aw_eval_runs?status=eq.done&select=*&order=created_at.desc&limit=2")
        const items = await sbGet("aw_eval_items?select=id,category,question&order=id.asc")
        const results = runs.length ? await sbGet(`aw_eval_results?run_id=in.(${runs.map((r: { id: string }) => r.id).join(",")})&select=*`) : []
        return json({ ok: true, runs, items, results })
      }
      return json({ error: "unknown_action" }, 400)
    }

    if (body?.action === "intro") {
      if (who?.empId !== OWNER && !(await isCliKey(req))) return json({ error: "forbidden" }, 403)
      try { return json({ ok: true, ...(await makeIntro(CLAUDE_KEY, String(body.id || ""), !!body.force)) }) }
      catch (e) { return json({ error: (e as Error).message }, 502) }
    }

    if (body?.action === "rebuild" || body?.action === "status") {
      if (who?.empId !== OWNER && !(await isCliKey(req))) return json({ error: "forbidden" }, 403)
      if (body.action === "status") {
        const r = await sbGet("ai_personas?id=in.(woody,woody-docs)&select=id,version,updated_at")
        return json({ ok: true, rows: r })
      }
      try { return json({ ok: true, ...(await rebuild()) }) }
      catch (e) { return json({ error: (e as Error).message }, 500) }
    }

    const bad = validateMessages(body?.messages)
    if (bad) return json({ error: bad }, 400)
    const mode = body?.mode == null ? "chat" : normalizeMode(String(body.mode))
    if (!mode) return json({ error: "bad_mode" }, 400)
    // 週報草稿只給 Woody 本人（前端只有他看得到那顆鈕，但真正的門在這裡）
    if (OWNER_MODES.includes(mode) && who?.empId !== OWNER) return json({ error: "forbidden" }, 403)

    let persona: string
    try { persona = await loadPersona() } catch (e) { return json({ error: (e as Error).message }, 503) }

    const payload = buildRequest(persona, body.messages, todayTaipei(), String(body?.lang || ""), mode)
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
