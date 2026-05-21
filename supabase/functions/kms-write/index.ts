import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const SUPABASE_URL = Deno.env.get("SB_URL") || ""
    const SERVICE_KEY  = Deno.env.get("SB_SERVICE_ROLE_KEY") || ""

    if (!SERVICE_KEY) return new Response(
      JSON.stringify({ error: "SERVICE_ROLE_KEY not set" }),
      { status: 500, headers: CORS }
    )

    // 用 service_role 建立 client，可繞過 RLS
    const sb = createClient(SUPABASE_URL, SERVICE_KEY)

    const { action, table, payload, id, filters } = await req.json()

    // 只允許 KMS 相關的資料表
    const ALLOWED_TABLES = [
      "kms_documents", "kms_doc_versions", "kms_comments",
      "kms_review_log", "kms_experts", "kms_product_lines",
      "kms_search_log"
    ]
    if (!ALLOWED_TABLES.includes(table)) {
      return new Response(JSON.stringify({ error: "table not allowed" }), { status: 403, headers: CORS })
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
