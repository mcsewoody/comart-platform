// KMS 機密文件的「真正」角色驗證層。
//
// 背景：KMS 前端原本用 confAccess()（讀 localStorage/URL 裡未簽章的 role
// 欄位）決定要不要把機密等級 2/3 文件的內容送到瀏覽器。任何人打開開發者
// 工具把 role 改成 "admin" 就能繞過——這一層只是 UI 過濾，資料庫層級毫無
// 限制。2026-07-08 已先用 RLS 圍堵直接打 REST API 的情況（migration 019），
// 但 KMS 本身透過 Cloudflare Worker（service_role）存取時仍然是「前端說了
// 算」。這個 function 改成：用登入時簽發的 HMAC 簽章 session 驗證身分，
// 角色一律重新查資料庫當下最新值（不信任簽章裡的 role，避免權限異動有
// 延遲），機密等級的判斷完全在伺服器端進行，前端拿到的資料本身就是
// 已過濾過的，不是「拿到全部、UI 選擇性顯示」。
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifySession } from "../_shared/session.ts"
import { namedSecretKey } from "../_shared/api-keys.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const ROLE_MAX_CONF: Record<string, number> = { admin: 3, dcc: 2, user: 1 }

const LIST_FIELDS =
  "id,title,category,lang,status,stars,conf_level,product_line,customer_tag,tags,author_name,view_count,file_url,file_name,file_type,file_size,summary,summary_en,summary_zh_cn,summary_vi,summary_ja,source_url,valid_until,updated_at,created_at"
const SEARCH_FIELDS =
  "id,title,body,category,lang,status,conf_level,file_url,file_name,file_type,author_name,created_at,summary,summary_en,summary_zh_cn,summary_vi,summary_ja,tags"

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const SUPABASE_URL = Deno.env.get("SB_URL") || ""
    const SERVICE_KEY = namedSecretKey("kms_edge")
    if (!SERVICE_KEY) return json({ ok: false, reason: "server_misconfigured" }, 500)
    const sb = createClient(SUPABASE_URL, SERVICE_KEY)

    const body = await req.json().catch(() => ({}))
    const { action, session } = body

    // ── 身分：驗證簽章拿到 empId，角色一律重查資料庫最新值 ──
    let maxConf = 1
    let viewerName: string | null = null
    const verified = session ? await verifySession(session) : null
    if (verified?.empId) {
      const { data: urows } = await sb.from("users").select("role,name_en,name_zh,active").eq("emp_id", verified.empId).limit(1)
      const u = urows?.[0]
      if (u && u.active !== false) {
        maxConf = ROLE_MAX_CONF[u.role] ?? 1
        viewerName = u.name_en || u.name_zh || null
      }
    }
    const allowed = (doc: { conf_level?: number | null; author_name?: string | null }) =>
      (doc.conf_level ?? 1) <= maxConf || (!!viewerName && doc.author_name === viewerName)

    // ── list：文件清單（比照 loadDocs 原本的查詢，但機密等級由伺服器端強制）──
    if (action === "list") {
      // 允許的排序欄位白名單，避免 order 參數被用來查詢任意欄位（雖然只影響排序不影響資料範圍，仍以白名單較嚴謹）
      const SORTABLE = new Set(["updated_at", "created_at", "stars", "view_count"])
      const orderStr = typeof body.order === "string" ? body.order : "updated_at.desc"
      const sumCol = typeof body.sumCol === "string" && /^summary(_[a-z_]+)?$/.test(body.sumCol) ? body.sumCol : null
      const select = LIST_FIELDS + (sumCol ? "," + sumCol : "")
      const orderCols: Array<[string, boolean]> = []
      for (const clause of orderStr.split(",").map((c) => c.trim()).filter(Boolean)) {
        const [col, dir] = clause.split(".")
        if (SORTABLE.has(col)) orderCols.push([col, dir === "asc"])
      }
      if (orderCols.length === 0) orderCols.push(["updated_at", false])

      // PostgREST 單次查詢預設上限 1000 筆，文件數超過就會被靜默截斷（2026-07-24 發現：
      // 1060 筆文件只顯示 1000）。改用 .range() 分頁抓到底，避免未來文件數再度卡住。
      const PAGE = 1000
      const allRows: Array<{ conf_level?: number | null; author_name?: string | null; [key: string]: unknown }> = []
      for (let from = 0; ; from += PAGE) {
        let q = sb.from("kms_documents").select(select).eq("status", "published").range(from, from + PAGE - 1)
        for (const [col, ascending] of orderCols) q = q.order(col, { ascending })
        const { data, error } = await q
        if (error) return json({ ok: false, reason: "server_error", message: error.message }, 500)
        allRows.push(...(data || []))
        if (!data || data.length < PAGE) break
      }
      const rows = allRows.filter(allowed)
      return json({ ok: true, docs: rows })
    }

    // ── get：單篇文件（讀取器/編輯器共用）──
    if (action === "get") {
      const id = String(body.id || "")
      if (!id) return json({ ok: false, reason: "bad_request" }, 400)
      const { data, error } = await sb.from("kms_documents").select("*").eq("id", id).limit(1)
      if (error) return json({ ok: false, reason: "server_error", message: error.message }, 500)
      const doc = data?.[0]
      if (!doc) return json({ ok: false, reason: "not_found" })
      if (!allowed(doc)) return json({ ok: false, reason: "forbidden" }, 403)
      return json({ ok: true, doc })
    }

    // ── searchVector：向量搜尋，conf_level 限制在 SQL 層直接套用（避免機密內容
    //    連原始回應都不該出現在瀏覽器 Network 分頁）──
    if (action === "searchVector") {
      const { data, error } = await sb.rpc("match_documents", {
        query_embedding: body.embedding,
        match_threshold: body.threshold ?? 0.25,
        match_count: body.count ?? 60,
        max_conf_level: maxConf,
        viewer_name: viewerName,
      })
      if (error) return json({ ok: false, reason: "server_error", message: error.message }, 500)
      const ids = (data || []).map((r: { id: string }) => r.id)
      let metaMap: Record<string, unknown> = {}
      if (ids.length) {
        const { data: metaRows } = await sb.from("kms_documents").select(SEARCH_FIELDS).in("id", ids)
        for (const r of metaRows || []) metaMap[(r as { id: string }).id] = r
      }
      return json({ ok: true, raw: data || [], metaMap })
    }

    // ── searchKeyword：全文 ilike 搜尋，conf_level 限制直接套用在查詢條件 ──
    if (action === "searchKeyword") {
      const raw = String(body.query || "")
      // PostgREST 的 or() 語法用逗號分隔條件、括號代表巢狀，使用者輸入含這些
      // 字元會被當成語法解析而非搜尋字串本身，故先移除（一般關鍵字搜尋不需要）
      const q = raw.replace(/[,()]/g, " ").trim()
      if (!q) return json({ ok: true, rows: [] })
      const like = `%${q}%`
      const query = sb
        .from("kms_documents")
        .select(SEARCH_FIELDS)
        .eq("status", "published")
        .or(`title.ilike.${like},summary.ilike.${like},body.ilike.${like}`)
        .limit(40)
      const { data, error } = await query
      if (error) return json({ ok: false, reason: "server_error", message: error.message }, 500)
      const rows = (data || []).filter(allowed)
      return json({ ok: true, rows })
    }

    return json({ ok: false, reason: "unknown_action" }, 400)
  } catch (e) {
    return json({ ok: false, reason: "exception", message: String((e as Error)?.message || e) }, 500)
  }
})
