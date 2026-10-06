import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifySession } from "../_shared/session.ts"
import { namedSecretKey } from "../_shared/api-keys.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session",
}

// 過渡旗標：true = 暫時放行未帶 session 的請求（部署新前端期間），
// 前端上線後改 false 再部署。原本此函式完全無驗證，任何人可寫 KMS 表（2026-07-20 修復）
const GRACE = false

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const SUPABASE_URL = Deno.env.get("SB_URL") || ""
    const SERVICE_KEY = namedSecretKey("kms_edge")

    if (!SERVICE_KEY) return new Response(
      JSON.stringify({ error: "SERVICE_ROLE_KEY not set" }),
      { status: 500, headers: CORS }
    )

    // 用 service_role 建立 client，可繞過 RLS
    const sb = createClient(SUPABASE_URL, SERVICE_KEY)

    const { action, table, payload, id, filters, session } = await req.json()

    // 驗證登入 session（HMAC 簽章，auth-verify 簽發）
    const verified = await verifySession(String(session || req.headers.get("x-session") || ""))
    if (!verified && !GRACE) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS })
    }

    // 只允許 KMS 相關的資料表
    const ALLOWED_TABLES = [
      "kms_documents", "kms_doc_versions", "kms_comments",
      "kms_review_log", "kms_experts", "kms_product_lines",
      "kms_search_log", "kms_snapshots", "kms_categories"
    ]
    if (!ALLOWED_TABLES.includes(table)) {
      return new Response(JSON.stringify({ error: "table not allowed" }), { status: 403, headers: CORS })
    }

    // 🔴「Woody 推薦閱讀」分類會直接進 AI Woody 的知識（當成 Woody 推崇的觀念引用），
    //    所以只有 Woody 本人能把文件放進來、改裡面的文件、或把文件移出去。
    //    前端只是把選項藏起來；這裡才是牆（kms-write 用 service role，什麼都寫得進去）。
    if (table === "kms_documents") {
      const deny = await woodyReadsDenied(sb, verified, action, payload, id, filters)
      if (deny) return new Response(JSON.stringify({ error: deny }), { status: 403, headers: CORS })
    }

    let result, error

    if (action === "insert") {
      const res = await sb.from(table).insert(payload).select()
      result = res.data; error = res.error

    } else if (action === "update") {
      const res = await sb.from(table).update(payload).eq("id", id).select()
      result = res.data; error = res.error

    } else if (action === "delete") {
      if (id) {
        const res = await sb.from(table).delete().eq("id", id)
        result = res.data; error = res.error
      } else if (filters) {
        let q = sb.from(table).delete()
        for (const [col, val] of Object.entries(filters)) {
          q = q.eq(col, val)
        }
        const res = await q
        result = res.data; error = res.error
      }

    } else if (action === "upsert") {
      const res = await sb.from(table).upsert(payload).select()
      result = res.data; error = res.error

    } else {
      return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: CORS })
    }

    if (error) return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: CORS }
    )

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS })
  }
})

const WOODY_READS = "woody_reads"
const WOODY = "C00001"
// 回傳拒絕原因；放行回 null。查詢失敗一律拒絕（fail-closed）。
async function woodyReadsDenied(sb: any, who: any, action: string, payload: any, id: any, filters: any): Promise<string | null> {
  if (who?.empId === WOODY) return null
  const rows = Array.isArray(payload) ? payload : [payload]
  if ((action === "insert" || action === "upsert" || action === "update") &&
      rows.some((r: any) => r && r.category === WOODY_READS)) return "woody_reads_owner_only"
  // 既有文件：update／upsert／delete 碰到的那一筆原本在這個分類裡，也不行
  let ids: string[] = []
  if (id) ids = [String(id)]
  else if (action === "upsert") ids = rows.map((r: any) => r?.id).filter(Boolean).map(String)
  else if (action === "delete" && filters) {
    // 用 filter 刪 kms_documents：判斷不了範圍，一律不准
    return "woody_reads_owner_only"
  }
  if (!ids.length) return null
  const { data, error } = await sb.from("kms_documents").select("id").in("id", ids).eq("category", WOODY_READS)
  if (error) return "woody_reads_check_failed"
  return data && data.length ? "woody_reads_owner_only" : null
}
