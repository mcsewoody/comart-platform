import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifySession } from "../_shared/session.ts"
import { namedSecretKey } from "../_shared/api-keys.ts"
import { expandSearchQueries } from "./search-aliases.js"
import { resolveProductFinderAccess } from "./access-control.js"
import { deleteColumns, editColumns, summaryColumns } from "./document-columns.js"
import { tombstoneDecision, tombstonePublic } from "./tombstone.js"
import { dispatchInputs, parseAnalysisRequest } from "./analysis-request.js"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-session",
}

type Dataset = "mfg" | "buy"
type Session = { empId: string; role: string }

const DEEP_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "pdf", "ppt", "pptx", "xls", "xlsx", "doc", "docx",
])
const ALLOWED_EXTENSIONS = new Set([
  ...DEEP_EXTENSIONS, "stp", "step", "dwg", "dxf", "iges", "igs", "mp4", "mov",
])
const CAD_EXTENSIONS = new Set(["stp", "step", "dwg", "dxf", "iges", "igs"])
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"])
const DOCUMENT_KINDS: Record<Dataset, Set<string>> = {
  mfg: new Set(["design_drawing", "bom", "cad", "image", "presentation", "document", "other"]),
  buy: new Set(["catalog", "quotation", "image", "presentation", "document", "cad", "other"]),
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

async function productFinderAccess(sb: any, sess: Session) {
  const { data, error } = await sb.from("pd_uploaders")
    .select("emp_id,active,can_sync").eq("emp_id", sess.empId).maybeSingle()
  if (error) throw error
  return resolveProductFinderAccess(sess.role, data)
}

async function fetchSyncRows(sb: any, dataset: Dataset) {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(tableFor(dataset))
      .select("id,relative_path,sha256,byte_size,storage_path")
      .order("relative_path").range(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  return rows
}

/* 🔴 刪除紀錄查詢失敗一律「不放行」（fail-closed）：放行的話，資料庫一抖動，
   刪掉的文件就趁那幾秒被匯入回來 —— 而那正是這張表存在的理由。
   上傳失敗只是「這個檔這次沒傳上去」，下一批會再試。 */
async function findTombstone(sb: any, dataset: Dataset, sha256: string) {
  const { data, error } = await sb.from("pd_deleted_documents")
    .select("sha256,relative_path,title,deleted_at,deleted_by_name")
    .eq("dataset", dataset).eq("sha256", sha256).maybeSingle()
  if (error) throw new Error(`tombstone_lookup_failed: ${error.message}`)
  return data || null
}

const EMPTY_QUEUE = { queued: 0, processing: 0, retryableFailed: 0, blockedFailed: 0, completed: 0 }

/* 🔴 一次 RPC 拿兩個資料庫的五個分組。舊版是每個資料庫各 5 個 count(*)、
   共 10 次往返，而前端在分析頁每 15 秒 poll 一次 —— pd_mfg_jobs 929 列卻
   累積了 10,603 次 seq scan。count(*) filter (...) 讓五組共用同一次掃描。*/
async function analysisQueueStatus(sb: any) {
  const { data, error } = await sb.rpc("pd_analysis_queue_status")
  if (error) throw error
  const byDataset: Record<string, typeof EMPTY_QUEUE> = { mfg: { ...EMPTY_QUEUE }, buy: { ...EMPTY_QUEUE } }
  for (const row of data || []) {
    byDataset[row.dataset] = {
      queued: Number(row.queued || 0),
      processing: Number(row.processing || 0),
      retryableFailed: Number(row.retryable_failed || 0),
      blockedFailed: Number(row.blocked_failed || 0),
      completed: Number(row.completed || 0),
    }
  }
  return byDataset
}

function tableFor(dataset: Dataset) {
  return dataset === "mfg" ? "pd_mfg_documents" : "pd_buy_documents"
}

function jobTableFor(dataset: Dataset) {
  return dataset === "mfg" ? "pd_mfg_jobs" : "pd_buy_jobs"
}

function bucketFor(dataset: Dataset, kind: "source" | "preview" | "thumbnail") {
  return `pd_${dataset}_${kind}`
}

function normalizeRelativePath(value: string) {
  const path = value.replaceAll("\\", "/").replace(/^\/+/, "")
  return path.startsWith("products/") ? path.slice("products/".length) : path
}

function datasetFromPath(path: string): Dataset | null {
  if (path.startsWith("OwnProduct/")) return "mfg"
  if (path.startsWith("Outsourcing/")) return "buy"
  return null
}

function extensionOf(name: string) {
  const parts = name.toLowerCase().split(".")
  return parts.length > 1 ? parts.pop() || "" : ""
}

function pathParts(relativePath: string) {
  return relativePath.split("/").filter(Boolean)
}

function cleanTextList(value: unknown, limit: number, itemLimit = 100) {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const item = String(raw || "").trim()
    if (!item || item.length > itemLimit || seen.has(item)) continue
    seen.add(item)
    result.push(item)
    if (result.length >= limit) break
  }
  return result
}

function meaningfulKeywords(relativePath: string) {
  const ignored = new Set([
    "ownproduct", "outsourcing", "history", "customer", "文件", "圖檔", "图档",
    "既有設計", "既有提案與報價", "既有提案", "無logo", "无logo",
  ])
  const words: string[] = []
  for (const part of pathParts(relativePath)) {
    const stem = part.replace(/\.[^.]+$/, "")
    for (const word of stem.split(/[\s_／/()（）\-]+/)) {
      const clean = word.trim()
      if (clean.length >= 2 && !ignored.has(clean.toLowerCase())) words.push(clean)
    }
  }
  return [...new Set(words)].slice(0, 24)
}

function classify(dataset: Dataset, relativePath: string, extension: string) {
  const lower = relativePath.toLowerCase()
  const title = pathParts(relativePath).at(-1) || relativePath
  const genericImage = IMAGE_EXTENSIONS.has(extension) && (
    /^(image\s*\d*|img[_-]?\d+|[abc]\s*\(\d+\)|截圖|截图|微信圖片|微信图片|wechat)/i
      .test(title.replace(/\.[^.]+$/, ""))
  )
  const isReference = /(history|既有設計|既有提案|customer)/i.test(relativePath)
  let documentKind = "other"
  if (CAD_EXTENSIONS.has(extension)) documentKind = "cad"
  else if (IMAGE_EXTENSIONS.has(extension)) documentKind = "image"
  else if (/\bbom\b|物料|成本|cost/i.test(lower)) documentKind = dataset === "mfg" ? "bom" : "quotation"
  else if (/報價|报价|quotation|quote|估價|估价/i.test(lower)) documentKind = dataset === "mfg" ? "bom" : "quotation"
  else if (/型錄|型录|catalog|catalogue/i.test(lower)) documentKind = "catalog"
  else if (["ppt", "pptx"].includes(extension)) documentKind = "presentation"
  else if (["pdf", "ai"].includes(extension) && dataset === "mfg") documentKind = "design_drawing"
  else if (["doc", "docx", "xls", "xlsx", "pdf"].includes(extension)) documentKind = "document"

  const parts = pathParts(relativePath)
  const keywords = meaningfulKeywords(relativePath)
  const rankWeight = genericImage ? 0.35 : isReference ? 0.65 : 1
  if (dataset === "mfg") {
    const sourceFactory = parts[1] || null
    const categoryPath = parts.slice(2, -1)
    return {
      title, document_kind: documentKind, source_factory: sourceFactory,
      category_path: categoryPath, keywords,
      is_reference: isReference, rank_weight: rankWeight,
      search_text: [title, relativePath, sourceFactory, ...categoryPath, ...keywords].filter(Boolean).join(" "),
    }
  }
  const supplierName = parts.length >= 3 ? parts[1] : "待確認廠商"
  const productPath = parts.length >= 3 ? parts.slice(2, -1) : []
  return {
    title, document_kind: documentKind, supplier_name: supplierName,
    product_path: productPath, keywords,
    is_reference: isReference, rank_weight: rankWeight,
    search_text: [title, relativePath, supplierName, ...productPath, ...keywords].filter(Boolean).join(" "),
  }
}

/* 🔴 300 秒對「列表縮圖」夠用（圖片馬上就載完了），對另外兩個場景不夠：
     - 詳情頁：開著讀完一份規格書再按下載，很容易超過 5 分鐘 → 網址已失效
     - syncUrls：一次發 50 個來源檔的網址，單檔上限 50 MB，五分鐘下載不完
   所以分成兩級。 */
const SIGN_TTL_LIST = 900
const SIGN_TTL_FILE = 3600

async function signPaths(sb: any, bucket: string, paths: string[], ttl = SIGN_TTL_LIST) {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return new Map<string, string>()
  const { data, error } = await sb.storage.from(bucket).createSignedUrls(unique, ttl)
  if (error) return new Map<string, string>()
  return new Map((data || []).flatMap((item: any) =>
    item.signedUrl ? [[item.path, item.signedUrl] as [string, string]] : []
  ))
}

function summary(row: Record<string, any>, dataset: Dataset, thumbnailUrl: string | null) {
  return {
    id: row.id,
    dataset,
    title: row.title,
    relativePath: row.relative_path,
    sourceFactory: row.source_factory || null,
    supplierName: row.supplier_name || null,
    pathLabels: row.category_path || row.product_path || [],
    documentKind: row.document_kind,
    extension: row.extension,
    byteSize: Number(row.byte_size || 0),
    keywords: row.keywords || [],
    summary: row.summary_zh_tw || "",
    isReference: Boolean(row.is_reference),
    analysisStatus: row.analysis_status,
    thumbnailUrl,
    updatedAt: row.updated_at,
    sourceModifiedAt: row.source_modified_at || null,
    primaryDocumentDate: row.primary_document_date || null,
    primaryDateType: row.primary_date_type || null,
    primaryDateEvidence: row.primary_date_evidence || null,
    primaryDateLocation: row.primary_date_location || null,
    revisionLabel: row.revision_label || null,
    revisionEvidence: row.revision_evidence || null,
    revisionLocation: row.revision_location || null,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const verified = await verifySession(req.headers.get("x-session") || "")
  if (!verified?.empId) return json({ error: "unauthorized" }, 401)
  const sess: Session = {
    empId: String(verified.empId),
    role: String(verified.role || "user"),
  }
  const url = Deno.env.get("SB_URL") || ""
  const key = namedSecretKey("cpf_worker")
  if (!url || !key) return json({ error: "server_misconfigured" }, 500)
  const sb = createClient(url, key)
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || "")

  const { data: user } = await sb.from("users")
    .select("emp_id,name_en,name_zh,email,role,active")
    .eq("emp_id", sess.empId).maybeSingle()
  if (!user || user.active === false || user.role === "inactive") {
    return json({ error: "account_inactive" }, 403)
  }

  let uploadAllowed = false
  let syncAllowed = false
  try {
    const access = await productFinderAccess(sb, sess)
    uploadAllowed = access.canUpload
    syncAllowed = access.canSync
  } catch (error) {
    console.error("Product Finder uploader lookup failed", error)
    return json({ error: "uploader_access_unavailable" }, 500)
  }

  /* 🔴 bootstrap 只回 profile。2.37 之前還回了 counts 與 suppliers ——
     前端**一個都沒讀過**（api.ts 連 bootstrap 方法都沒有，AuthProvider 只取
     profile），卻讓每一次開頁都多兩個 count(*) 加一次 pd_buy_documents 全表
     select("supplier_name")。而且那份清單就算有人要用也是壞的：沒帶 range，
     Supabase 預設 1000 列會靜默截斷，供應商會少。
     真的需要供應商下拉時請另開一支 distinct 的 RPC，不要把它加回這裡。*/
  if (action === "bootstrap") {
    return json({
      profile: {
        id: user.emp_id,
        email: user.email || `${user.emp_id}@comart.com.tw`,
        displayName: user.name_zh || user.name_en || user.emp_id,
        role: sess.role === "admin" ? "admin" : sess.role === "dcc" ? "editor" : "viewer",
        active: true,
        canUpload: uploadAllowed,
        canSync: syncAllowed,
      },
    })
  }

  if (action === "analysisStatus") {
    if (!uploadAllowed) return json({ error: "forbidden" }, 403)
    try {
      const { mfg, buy } = await analysisQueueStatus(sb)
      return json({ configured: Boolean(Deno.env.get("PD_GITHUB_TOKEN")), mfg, buy })
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "analysis_status_failed" }, 500)
    }
  }

  if (action === "startAnalysis") {
    if (!uploadAllowed) return json({ error: "forbidden" }, 403)
    /* 🔴 workflow 早就吃 max_batches 這個 input 了（1–20），只是這裡一直沒送，
       所以按一次最多處理 `limit` 份（上限 50）—— 一次匯入幾百份要按很多次。
       上傳完自動觸發之後更需要它：沒有人會在背後幫忙多按幾次。
       驗證抽到 analysis-request.js，測試會比對 workflow 自己的範圍檢查 ——
       兩邊分岔的話 edge function 放行的值會讓 GitHub job 在第一步 exit 1，
       而使用者只看到「已啟動分析」然後什麼都沒發生。*/
    const parsed = parseAnalysisRequest(body)
    if (!parsed.ok) return json({ error: parsed.error }, 400)
    const { dataset: requestedDataset, limit, maxBatches } = parsed
    const token = Deno.env.get("PD_GITHUB_TOKEN") || ""
    if (!token) return json({ error: "AI 啟動尚未完成一次性後端授權" }, 503)
    const owner = Deno.env.get("PD_GITHUB_OWNER") || "mcsewoody"
    const repository = Deno.env.get("PD_GITHUB_REPOSITORY") || "comart-platform"
    const workflow = Deno.env.get("PD_GITHUB_WORKFLOW") || "pd-document-worker.yml"
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "comart-product-finder",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: dispatchInputs(parsed),
        }),
      },
    )
    if (!response.ok) {
      const detail = await response.text()
      console.error("GitHub workflow dispatch failed", response.status, detail.slice(0, 1000))
      return json({ error: `AI 工作器啟動失敗 (${response.status})` }, 502)
    }
    return json({ accepted: true, dataset: requestedDataset, limit, maxBatches }, 202)
  }

  if (action === "uploaders") {
    if (sess.role !== "admin") return json({ error: "forbidden" }, 403)
    const [users, allowed] = await Promise.all([
      sb.from("users").select("emp_id,name_en,name_zh,email,role,active,status").order("emp_id"),
      sb.from("pd_uploaders").select("emp_id,active,can_sync"),
    ])
    if (users.error || allowed.error) return json({ error: (users.error || allowed.error).message }, 500)
    const access = new Map((allowed.data || []).map((item: any) => [item.emp_id, item]))
    return json({ items: (users.data || []).map((item: any) => ({
      id: item.emp_id,
      email: item.email || `${item.emp_id}@comart.com.tw`,
      displayName: item.name_zh || item.name_en || item.emp_id,
      platformRole: item.role,
      platformActive: item.active !== false && item.role !== "inactive",
      platformStatus: item.status || null,
      uploadAllowed: item.active !== false && item.role !== "inactive" && (item.role === "admin" || access.get(item.emp_id)?.active === true),
      syncAllowed: item.active !== false && item.role !== "inactive" && access.get(item.emp_id)?.can_sync === true,
    })) })
  }

  if (action === "setUploader") {
    if (sess.role !== "admin") return json({ error: "forbidden" }, 403)
    const empId = String(body.empId || "").trim()
    const permission = String(body.permission || "")
    const allowed = Boolean(body.allowed)
    if (!new Set(["upload", "sync"]).has(permission)) return json({ error: "invalid_permission" }, 400)
    const { data: target } = await sb.from("users").select("emp_id,role,active").eq("emp_id", empId).maybeSingle()
    if (!target || target.active === false || target.role === "inactive") return json({ error: "invalid_uploader" }, 400)
    if (permission === "upload" && target.role === "admin" && !allowed) return json({ error: "admin_upload_access_required" }, 400)
    const { data: current, error: accessError } = await sb.from("pd_uploaders")
      .select("active,can_sync").eq("emp_id", empId).maybeSingle()
    if (accessError) return json({ error: accessError.message }, 500)
    const { error } = await sb.from("pd_uploaders").upsert({
      emp_id: empId,
      active: target.role === "admin" ? true : permission === "upload" ? allowed : current?.active === true,
      can_sync: permission === "sync" ? allowed : current?.can_sync === true,
      granted_by: sess.empId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "emp_id" })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  if (action === "syncManifest") {
    if (!syncAllowed) return json({ error: "sync_forbidden" }, 403)
    try {
      const [mfg, buy] = await Promise.all([fetchSyncRows(sb, "mfg"), fetchSyncRows(sb, "buy")])
      return json({ items: [
        ...mfg.map((row: any) => ({ id: row.id, dataset: "mfg", relativePath: row.relative_path, sha256: row.sha256, byteSize: Number(row.byte_size || 0) })),
        ...buy.map((row: any) => ({ id: row.id, dataset: "buy", relativePath: row.relative_path, sha256: row.sha256, byteSize: Number(row.byte_size || 0) })),
      ] })
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "sync_manifest_failed" }, 500)
    }
  }

  if (action === "syncUrls") {
    if (!syncAllowed) return json({ error: "sync_forbidden" }, 403)
    const requested = Array.isArray(body.items) ? body.items : []
    if (!requested.length || requested.length > 50) return json({ error: "invalid_sync_batch" }, 400)
    const items: any[] = []
    for (const targetDataset of ["mfg", "buy"] as Dataset[]) {
      const ids = [...new Set(requested.filter((item: any) => item?.dataset === targetDataset).map((item: any) => String(item.id || "")).filter(Boolean))]
      if (!ids.length) continue
      const { data, error } = await sb.from(tableFor(targetDataset))
        .select("id,relative_path,sha256,byte_size,storage_path").in("id", ids)
      if (error) return json({ error: error.message }, 500)
      const urls = await signPaths(sb, bucketFor(targetDataset, "source"), (data || []).map((row: any) => row.storage_path), SIGN_TTL_FILE)
      for (const row of data || []) {
        const url = urls.get(row.storage_path)
        if (url) items.push({ id: row.id, dataset: targetDataset, relativePath: row.relative_path, sha256: row.sha256, byteSize: Number(row.byte_size || 0), url })
      }
    }
    if (items.length) await sb.from("pd_transfer_audit").insert(items.map((item: any) => ({
      emp_id: sess.empId, action: "download_request", dataset: item.dataset,
      document_id: item.id, relative_path: item.relativePath, sha256: item.sha256,
    })))
    return json({ items })
  }

  const dataset: Dataset = body.dataset === "buy" ? "buy" : "mfg"
  const table = tableFor(dataset)

  if (action === "search") {
    const started = performance.now()
    const query = String(body.query || "").trim()
    const expandedQueries = expandSearchQueries(query, 12)
    const kind = String(body.kind || "")
    const includeReference = Boolean(body.includeReference)
    const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 100)
    const offset = Math.max(Number(body.offset) || 0, 0)
    const rpc = dataset === "mfg"
      ? "pd_mfg_search_documents_multilingual"
      : "pd_buy_search_documents_multilingual"
    const args = dataset === "mfg"
      ? {
          p_queries: expandedQueries, p_kind: kind, p_include_reference: includeReference,
          p_limit: limit, p_offset: offset,
        }
      : {
          p_queries: expandedQueries, p_supplier: String(body.supplier || ""), p_kind: kind,
          p_include_reference: includeReference, p_limit: limit, p_offset: offset,
        }
    const { data: candidates, error: rankError } = await sb.rpc(rpc, args)
    if (rankError) return json({ error: rankError.message }, 500)
    const rankedCandidates = candidates || []
    const total = Number(rankedCandidates[0]?.total_count || 0)
    const ids = rankedCandidates.map((item: any) => item.document_id)
    if (!ids.length) return json({ items: [], total, elapsedMs: Math.round(performance.now() - started) })
    /* 🔴 不能 select("*")：那會把 extracted_text 與 search_text（分析完成後最多
       各 300 KB）整份撈出來再丟掉 —— summary() 一個欄位都沒用到。
       下面的 document／updateDocument 端點是真的需要 extracted_text，那幾處要留。*/
    const { data: rows, error } = await sb.from(table)
      .select(summaryColumns(dataset))
      .in("id", ids)
    if (error) return json({ error: error.message }, 500)
    const byId = new Map((rows || []).map((row: any) => [row.id, row]))
    const rankedRows = rankedCandidates.flatMap((rank: any) => {
      const row = byId.get(rank.document_id)
      return row ? [row] : []
    })
    const thumbPaths = rankedRows.filter((row: any) => row.thumbnail_path).map((row: any) => row.thumbnail_path)
    const imagePaths = rankedRows.filter((row: any) => IMAGE_EXTENSIONS.has(row.extension)).map((row: any) => row.storage_path)
    const [thumbs, images] = await Promise.all([
      signPaths(sb, bucketFor(dataset, "thumbnail"), thumbPaths),
      signPaths(sb, bucketFor(dataset, "source"), imagePaths),
    ])
    const items = rankedCandidates.flatMap((rank: any) => {
      const row: any = byId.get(rank.document_id)
      if (!row) return []
      const thumbnail = row.thumbnail_path ? thumbs.get(row.thumbnail_path) : images.get(row.storage_path)
      return [{ ...summary(row, dataset, thumbnail || null), score: Number(rank.score), matchReason: rank.match_reason }]
    })
    return json({ items, total, elapsedMs: Math.round(performance.now() - started) })
  }

  if (action === "document") {
    const { data: row, error } = await sb.from(table).select("*").eq("id", String(body.id || "")).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!row) return json({ item: null })
    const [source, preview, thumbnail] = await Promise.all([
      signPaths(sb, bucketFor(dataset, "source"), [row.storage_path], SIGN_TTL_FILE),
      signPaths(sb, bucketFor(dataset, "preview"), row.preview_path ? [row.preview_path] : [], SIGN_TTL_FILE),
      signPaths(sb, bucketFor(dataset, "thumbnail"), row.thumbnail_path ? [row.thumbnail_path] : []),
    ])
    const sourceUrl = source.get(row.storage_path) || null
    const previewUrl = row.preview_path
      ? preview.get(row.preview_path) || null
      : (IMAGE_EXTENSIONS.has(row.extension) || row.extension === "pdf") ? sourceUrl : null
    return json({ item: { ...summary(row, dataset, thumbnail.get(row.thumbnail_path) || null), sourceUrl, previewUrl, extractedText: row.extracted_text || "" } })
  }

  if (action === "deleteDocument") {
    if (sess.role !== "admin" || user.role !== "admin") return json({ error: "forbidden" }, 403)
    const id = String(body.id || "")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: "invalid_document_id" }, 400)
    }
    /* 🔴 不要 select("*")：extracted_text 與 search_text 分析完成後各可到 300 KB，
       這裡只需要三個路徑加兩個稽核欄位。*/
    const { data: current, error: readError } = await sb.from(table)
      .select(deleteColumns()).eq("id", id).maybeSingle()
    if (readError) return json({ error: readError.message }, 500)
    if (!current) return json({ error: "document_not_found" }, 404)

    /* 🔴 順序是「先資料列、後檔案」，不能反過來。
       反過來的話中間失敗會留下「資料列還在、檔案沒了」—— 文件照樣出現在搜尋
       結果裡，點進去才壞，而且沒有任何人會發現。
       這個順序失敗只會在 storage 留下孤兒 bytes：看不見、可事後清、不會騙人。*/
    /* 🔴 先記「刻意刪除」再刪資料列（2.39）。記不下來就不刪：
       沒有這一筆，任何一台電腦的下一次批次匯入都會把它匯入回來，
       而那正是使用者按下刪除時最不想要的結果。 */
    const { error: tombError } = await sb.from("pd_deleted_documents").upsert({
      dataset, sha256: current.sha256, relative_path: current.relative_path || "",
      title: current.title || "", deleted_by: sess.empId,
      deleted_by_name: user.name_zh || user.name_en || user.emp_id || sess.empId,
      deleted_at: new Date().toISOString(),
    }, { onConflict: "dataset,sha256" })
    if (tombError) return json({ error: `tombstone_write_failed: ${tombError.message}` }, 500)

    const editDelete = await sb.from("pd_document_edits").delete().eq("dataset", dataset).eq("document_id", id)
    if (editDelete.error) return json({ error: editDelete.error.message }, 500)
    const { error: deleteError } = await sb.from(table).delete().eq("id", id)
    if (deleteError) return json({ error: deleteError.message }, 500)

    /* 🔴 pd_transfer_audit 的舊紀錄**保留**。2.37 之前這裡會把該文件的稽核歷史
       整批 delete 掉再補一筆 delete —— 會被刪掉的稽核紀錄不是稽核紀錄，
       「誰在什麼時候下載過這份圖」正是刪檔之後最需要查的東西。
       這張表沒有 FK 到文件，所以文件刪掉之後紀錄仍然留著（刻意的）。*/
    const { error: auditError } = await sb.from("pd_transfer_audit").insert({
      emp_id: sess.empId, action: "delete", dataset, document_id: id,
      relative_path: current.relative_path, sha256: current.sha256,
    })
    if (auditError) console.error("Document deletion audit failed", auditError)

    const orphaned: string[] = []
    for (const [kind, path] of [
      ["preview", current.preview_path], ["thumbnail", current.thumbnail_path], ["source", current.storage_path],
    ] as Array<["source" | "preview" | "thumbnail", string | null]>) {
      if (!path) continue
      const { error } = await sb.storage.from(bucketFor(dataset, kind)).remove([path])
      if (error) {
        orphaned.push(`${kind}:${path}`)
        console.error("Storage delete failed after row removal", kind, path, error.message)
      }
    }
    return json({ ok: true, relativePath: current.relative_path, orphanedStoragePaths: orphaned })
  }

  if (action === "updateDocument") {
    if (!uploadAllowed) return json({ error: "forbidden" }, 403)
    const id = String(body.id || "")
    const patch = body.patch && typeof body.patch === "object" ? body.patch : {}
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: "invalid_document_id" }, 400)
    }
    const title = String(patch.title || "").trim()
    const documentKind = String(patch.documentKind || "").trim()
    const sourceParty = String(patch.sourceParty || "").trim()
    const pathLabels = cleanTextList(patch.pathLabels, 20)
    const keywords = cleanTextList(patch.keywords, 30, 80)
    const summaryText = String(patch.summary || "").trim()
    const primaryDocumentDate = patch.primaryDocumentDate ? String(patch.primaryDocumentDate) : null
    const revisionLabel = String(patch.revisionLabel || "").trim()
    if (!title || title.length > 300 || !DOCUMENT_KINDS[dataset].has(documentKind) ||
        sourceParty.length > 200 || pathLabels === null || keywords === null || summaryText.length > 2000 ||
        (primaryDocumentDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(primaryDocumentDate)) || revisionLabel.length > 100) {
      return json({ error: "invalid_document_patch" }, 400)
    }
    /* 🔴 不要 select("*")：search_text 分析完成後最多 300 KB，而這裡是整份重拼的，
       舊值一個字都用不到。extracted_text 反而一定要撈（下面用它重建 search_text）。*/
    const { data: current, error: readError } = await sb.from(table)
      .select(editColumns(dataset)).eq("id", id).maybeSingle()
    if (readError) return json({ error: readError.message }, 500)
    if (!current) return json({ error: "document_not_found" }, 404)
    const update: Record<string, unknown> = {
      title,
      document_kind: documentKind,
      keywords,
      summary_zh_tw: summaryText,
      is_reference: Boolean(patch.isReference),
      primary_document_date: primaryDocumentDate,
      primary_date_type: primaryDocumentDate ? "manual" : null,
      primary_date_evidence: primaryDocumentDate ? `人工設定：${sess.empId}` : null,
      primary_date_location: null,
      revision_label: revisionLabel || null,
      revision_evidence: revisionLabel ? `人工設定：${sess.empId}` : null,
      revision_location: null,
      updated_at: new Date().toISOString(),
      search_text: [
        title, current.relative_path, sourceParty, ...pathLabels, ...keywords,
        summaryText, primaryDocumentDate, revisionLabel, String(current.extracted_text || "").slice(0, 300000),
      ].filter(Boolean).join(" "),
    }
    if (dataset === "mfg") {
      update.source_factory = sourceParty || null
      update.category_path = pathLabels
    } else {
      if (!sourceParty) return json({ error: "supplier_required" }, 400)
      update.supplier_name = sourceParty
      update.product_path = pathLabels
    }
    const beforeData = {
      title: current.title,
      documentKind: current.document_kind,
      sourceParty: current.source_factory || current.supplier_name || "",
      pathLabels: current.category_path || current.product_path || [],
      keywords: current.keywords || [],
      summary: current.summary_zh_tw || "",
      isReference: Boolean(current.is_reference),
      primaryDocumentDate: current.primary_document_date || null,
      revisionLabel: current.revision_label || "",
    }
    const afterData = { title, documentKind, sourceParty, pathLabels, keywords, summary: summaryText, isReference: Boolean(patch.isReference), primaryDocumentDate, revisionLabel }
    const { error: updateError } = await sb.from(table).update(update).eq("id", id)
    if (updateError) return json({ error: updateError.message }, 500)
    const { error: auditError } = await sb.from("pd_document_edits").insert({
      dataset, document_id: id, edited_by: sess.empId, before_data: beforeData, after_data: afterData,
    })
    if (auditError) console.error("Document edit audit failed", auditError)
    return json({ ok: true })
  }

  if (action === "checkHashes") {
    if (!uploadAllowed && !syncAllowed) return json({ error: "forbidden" }, 403)
    const hashes = [...new Set(
      (Array.isArray(body.hashes) ? body.hashes : [])
        .map((value: unknown) => String(value).toLowerCase())
        .filter((value: string) => /^[a-f0-9]{64}$/.test(value)),
    )]
    if (!hashes.length || hashes.length > 100) {
      return json({ error: "invalid_hash_batch" }, 400)
    }
    const { data, error } = await sb.from(table).select("sha256").in("sha256", hashes)
    if (error) return json({ error: error.message }, 500)
    const existing = (data || []).map((row: any) => row.sha256)
    // 曾刪除的指紋另外回報，讓盤點畫面說得出「略過了哪些、為什麼」
    const { data: tombs, error: tombError } = await sb.from("pd_deleted_documents")
      .select("sha256,relative_path,title,deleted_at,deleted_by_name")
      .eq("dataset", dataset).in("sha256", hashes)
    if (tombError) return json({ error: `tombstone_lookup_failed: ${tombError.message}` }, 500)
    const existingSet = new Set(existing)
    const deleted = (tombs || []).filter((row: any) => !existingSet.has(row.sha256)).map(tombstonePublic)
    return json({ existing, deleted })
  }

  if (action === "initUpload") {
    if (!uploadAllowed) return json({ error: "forbidden" }, 403)
    const relativePath = normalizeRelativePath(String(body.relativePath || ""))
    const actualDataset = datasetFromPath(relativePath)
    const name = pathParts(relativePath).at(-1) || ""
    const extension = extensionOf(name)
    const byteSize = Number(body.byteSize || 0)
    const sha256 = String(body.sha256 || "").toLowerCase()
    if (actualDataset !== dataset || !ALLOWED_EXTENSIONS.has(extension)) {
      return json({ error: "unsupported_path_or_file" }, 400)
    }
    if (byteSize <= 0 || byteSize > 52428800 || !/^[a-f0-9]{64}$/.test(sha256)) {
      return json({ error: "invalid_file_metadata" }, 400)
    }
    const { data: existing } = await sb.from(table).select("id,title").eq("sha256", sha256).maybeSingle()
    if (existing) return json({ duplicate: true, documentId: existing.id, title: existing.title })
    const restore = body.restore === true
    let tomb: any = null
    try { tomb = await findTombstone(sb, dataset, sha256) } catch (e) { return json({ error: (e as Error).message }, 500) }
    const decision = tombstoneDecision(tomb, { restore, isAdmin: sess.role === "admin" && user.role === "admin" })
    if (decision === "blocked") return json({ duplicate: false, deleted: true, tombstone: tombstonePublic(tomb) })
    if (decision === "restore_forbidden") return json({ error: "restore_forbidden" }, 403)
    const storagePath = `${sha256.slice(0, 2)}/${sha256}/source.${extension}`
    const { data, error } = await sb.storage.from(bucketFor(dataset, "source")).createSignedUploadUrl(storagePath)
    if (error && /resource already exists/i.test(error.message)) {
      return json({ duplicate: false, storageExists: true, storagePath })
    }
    if (error) return json({ error: error.message }, 400)
    return json({
      duplicate: false,
      storagePath,
      signedUrl: data.signedUrl,
      signedToken: data.token,
    })
  }

  if (action === "completeUpload") {
    if (!uploadAllowed) return json({ error: "forbidden" }, 403)
    const relativePath = normalizeRelativePath(String(body.relativePath || ""))
    if (datasetFromPath(relativePath) !== dataset) return json({ error: "bad_dataset_path" }, 400)
    const name = pathParts(relativePath).at(-1) || ""
    const extension = extensionOf(name)
    const sha256 = String(body.sha256 || "").toLowerCase()
    const storagePath = String(body.storagePath || "")
    const byteSize = Number(body.byteSize || 0)
    const expectedStoragePath = `${sha256.slice(0, 2)}/${sha256}/source.${extension}`
    if (!ALLOWED_EXTENSIONS.has(extension) || !/^[a-f0-9]{64}$/.test(sha256) ||
        byteSize <= 0 || byteSize > 52428800 || storagePath !== expectedStoragePath) {
      return json({ error: "invalid_upload_completion" }, 400)
    }
    /* 🔴 completeUpload 也要擋：initUpload 之後、完成之前，那份可能剛好被刪掉；
       而且只擋 initUpload 等於相信前端一定會先呼叫它。 */
    const restore = body.restore === true
    let tomb: any = null
    try { tomb = await findTombstone(sb, dataset, sha256) } catch (e) { return json({ error: (e as Error).message }, 500) }
    const decision = tombstoneDecision(tomb, { restore, isAdmin: sess.role === "admin" && user.role === "admin" })
    if (decision === "blocked") return json({ duplicate: false, deleted: true, tombstone: tombstonePublic(tomb) })
    if (decision === "restore_forbidden") return json({ error: "restore_forbidden" }, 403)
    const auditAction = tomb ? "restore" : "upload"

    const classified = classify(dataset, relativePath, extension)
    const analysisStatus = DEEP_EXTENSIONS.has(extension) ? "queued" : "metadata_only"
    const payload = {
      ...classified,
      relative_path: relativePath,
      extension,
      mime_type: String(body.mimeType || "application/octet-stream"),
      byte_size: byteSize,
      sha256,
      storage_path: storagePath,
      source_modified_at: body.lastModified ? new Date(Number(body.lastModified)).toISOString() : null,
      analysis_status: analysisStatus,
      uploaded_by: sess.empId,
      uploaded_by_name: user.name_zh || user.name_en || user.emp_id,
    }
    const { data: row, error } = await sb.from(table).insert(payload).select("id").single()
    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await sb.from(table).select("id").eq("sha256", sha256).maybeSingle()
        return json({ duplicate: true, documentId: existing?.id || null })
      }
      return json({ error: error.message }, 400)
    }
    if (tomb) {
      // 還原成功才移除刪除紀錄；移除失敗不影響文件本身（它已經存在，之後會被當成重複）
      const { error: clearError } = await sb.from("pd_deleted_documents").delete().eq("dataset", dataset).eq("sha256", sha256)
      if (clearError) console.error("Tombstone clear failed after restore", dataset, sha256, clearError.message)
    }
    /* 🔴 這個 insert 的錯誤原本沒有人看。失敗的話文件的 analysis_status 停在
       'queued'，但佇列裡沒有對應的工作 —— worker 永遠不會撿到它，畫面上
       **永遠顯示「等待內容分析」**，而它在等的東西根本不存在。
       這種壞法沒有人會回報（看起來只是「還沒輪到」），所以寧可退回
       metadata_only：至少檔名與路徑仍然搜尋得到，而且狀態是誠實的。*/
    if (analysisStatus === "queued") {
      const { error: jobError } = await sb.from(jobTableFor(dataset)).insert({ document_id: row.id })
      if (jobError) {
        console.error("Analysis job enqueue failed", dataset, row.id, jobError.message)
        await sb.from(table).update({ analysis_status: "metadata_only" }).eq("id", row.id)
        await sb.from("pd_transfer_audit").insert({
          emp_id: sess.empId, action: auditAction, dataset, document_id: row.id,
          relative_path: relativePath, sha256,
        })
        return json({ duplicate: false, documentId: row.id, analysisStatus: "metadata_only", enqueueFailed: true })
      }
    }
    await sb.from("pd_transfer_audit").insert({
      emp_id: sess.empId, action: auditAction, dataset, document_id: row.id,
      relative_path: relativePath, sha256,
    })
    return json({ duplicate: false, documentId: row.id, analysisStatus })
  }

  return json({ error: "unknown_action" }, 400)
})
