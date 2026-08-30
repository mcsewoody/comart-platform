import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifySession } from "../_shared/session.ts"
import { namedSecretKey } from "../_shared/api-keys.ts"

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

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

function canEdit(sess: Session) {
  return sess.role === "admin" || sess.role === "dcc"
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

async function signPaths(sb: any, bucket: string, paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return new Map<string, string>()
  const { data, error } = await sb.storage.from(bucket).createSignedUrls(unique, 300)
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

  if (action === "bootstrap") {
    const [mfg, buy, suppliers] = await Promise.all([
      sb.from("pd_mfg_documents").select("id", { count: "exact", head: true }),
      sb.from("pd_buy_documents").select("id", { count: "exact", head: true }),
      sb.from("pd_buy_documents").select("supplier_name").order("supplier_name"),
    ])
    return json({
      profile: {
        id: user.emp_id,
        email: user.email || `${user.emp_id}@comart.com.tw`,
        displayName: user.name_zh || user.name_en || user.emp_id,
        role: sess.role === "admin" ? "admin" : sess.role === "dcc" ? "editor" : "viewer",
        active: true,
      },
      counts: { mfg: mfg.count || 0, buy: buy.count || 0 },
      suppliers: [...new Set((suppliers.data || []).map((item: any) => item.supplier_name).filter(Boolean))],
    })
  }

  const dataset: Dataset = body.dataset === "buy" ? "buy" : "mfg"
  const table = tableFor(dataset)

  if (action === "search") {
    const started = performance.now()
    const query = String(body.query || "").trim()
    const kind = String(body.kind || "")
    const includeReference = Boolean(body.includeReference)
    const rpc = dataset === "mfg" ? "pd_mfg_search_documents" : "pd_buy_search_documents"
    const args = dataset === "mfg"
      ? { p_query: query, p_kind: kind, p_include_reference: includeReference, p_limit: 100 }
      : {
          p_query: query, p_supplier: String(body.supplier || ""), p_kind: kind,
          p_include_reference: includeReference, p_limit: 100,
        }
    const { data: ranked, error: rankError } = await sb.rpc(rpc, args)
    if (rankError) return json({ error: rankError.message }, 500)
    const ids = (ranked || []).map((item: any) => item.document_id)
    if (!ids.length) return json({ items: [], total: 0, elapsedMs: Math.round(performance.now() - started) })
    const { data: rows, error } = await sb.from(table).select("*").in("id", ids)
    if (error) return json({ error: error.message }, 500)
    const byId = new Map((rows || []).map((row: any) => [row.id, row]))
    const thumbPaths = (rows || []).filter((row: any) => row.thumbnail_path).map((row: any) => row.thumbnail_path)
    const imagePaths = (rows || []).filter((row: any) => IMAGE_EXTENSIONS.has(row.extension)).map((row: any) => row.storage_path)
    const [thumbs, images] = await Promise.all([
      signPaths(sb, bucketFor(dataset, "thumbnail"), thumbPaths),
      signPaths(sb, bucketFor(dataset, "source"), imagePaths),
    ])
    const items = (ranked || []).flatMap((rank: any) => {
      const row: any = byId.get(rank.document_id)
      if (!row) return []
      const thumbnail = row.thumbnail_path ? thumbs.get(row.thumbnail_path) : images.get(row.storage_path)
      return [{ ...summary(row, dataset, thumbnail || null), score: Number(rank.score), matchReason: rank.match_reason }]
    })
    return json({ items, total: items.length, elapsedMs: Math.round(performance.now() - started) })
  }

  if (action === "document") {
    const { data: row, error } = await sb.from(table).select("*").eq("id", String(body.id || "")).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!row) return json({ item: null })
    const [source, preview, thumbnail] = await Promise.all([
      signPaths(sb, bucketFor(dataset, "source"), [row.storage_path]),
      signPaths(sb, bucketFor(dataset, "preview"), row.preview_path ? [row.preview_path] : []),
      signPaths(sb, bucketFor(dataset, "thumbnail"), row.thumbnail_path ? [row.thumbnail_path] : []),
    ])
    const sourceUrl = source.get(row.storage_path) || null
    const previewUrl = row.preview_path
      ? preview.get(row.preview_path) || null
      : (IMAGE_EXTENSIONS.has(row.extension) || row.extension === "pdf") ? sourceUrl : null
    return json({ item: { ...summary(row, dataset, thumbnail.get(row.thumbnail_path) || null), sourceUrl, previewUrl, extractedText: row.extracted_text || "" } })
  }

  if (action === "initUpload") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const relativePath = normalizeRelativePath(String(body.relativePath || ""))
    const actualDataset = datasetFromPath(relativePath)
    const name = pathParts(relativePath).at(-1) || ""
    const extension = extensionOf(name)
    const byteSize = Number(body.byteSize || 0)
    const sha256 = String(body.sha256 || "").toLowerCase()
    if (actualDataset !== dataset || !ALLOWED_EXTENSIONS.has(extension)) {
      return json({ error: "unsupported_path_or_file" }, 400)
    }
    if (byteSize <= 0 || byteSize > 524288000 || !/^[a-f0-9]{64}$/.test(sha256)) {
      return json({ error: "invalid_file_metadata" }, 400)
    }
    const { data: existing } = await sb.from(table).select("id,title").eq("sha256", sha256).maybeSingle()
    if (existing) return json({ duplicate: true, documentId: existing.id, title: existing.title })
    const storagePath = `${sha256.slice(0, 2)}/${sha256}/source.${extension}`
    const { data, error } = await sb.storage.from(bucketFor(dataset, "source")).createSignedUploadUrl(storagePath)
    if (error && /resource already exists/i.test(error.message)) {
      return json({ duplicate: false, storageExists: true, storagePath })
    }
    if (error) return json({ error: error.message }, 400)
    return json({ duplicate: false, storagePath, signedUrl: data.signedUrl })
  }

  if (action === "completeUpload") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const relativePath = normalizeRelativePath(String(body.relativePath || ""))
    if (datasetFromPath(relativePath) !== dataset) return json({ error: "bad_dataset_path" }, 400)
    const name = pathParts(relativePath).at(-1) || ""
    const extension = extensionOf(name)
    const sha256 = String(body.sha256 || "").toLowerCase()
    const storagePath = String(body.storagePath || "")
    const byteSize = Number(body.byteSize || 0)
    const expectedStoragePath = `${sha256.slice(0, 2)}/${sha256}/source.${extension}`
    if (!ALLOWED_EXTENSIONS.has(extension) || !/^[a-f0-9]{64}$/.test(sha256) ||
        byteSize <= 0 || byteSize > 524288000 || storagePath !== expectedStoragePath) {
      return json({ error: "invalid_upload_completion" }, 400)
    }
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
    }
    const { data: row, error } = await sb.from(table).insert(payload).select("id").single()
    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await sb.from(table).select("id").eq("sha256", sha256).maybeSingle()
        return json({ duplicate: true, documentId: existing?.id || null })
      }
      return json({ error: error.message }, 400)
    }
    if (analysisStatus === "queued") {
      await sb.from(jobTableFor(dataset)).insert({ document_id: row.id })
    }
    return json({ duplicate: false, documentId: row.id, analysisStatus })
  }

  return json({ error: "unknown_action" }, 400)
})
