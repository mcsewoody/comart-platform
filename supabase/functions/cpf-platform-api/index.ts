import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifySession } from "../_shared/session.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-session",
}

type Session = { empId: string; role: string; site?: string }

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

async function signPaths(
  sb: any,
  bucket: string,
  paths: Array<string | null | undefined>,
) {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))]
  if (!unique.length) return new Map<string, string>()
  const { data, error } = await sb.storage.from(bucket).createSignedUrls(unique, 300)
  if (error) return new Map<string, string>()
  return new Map((data || []).flatMap((item: any) =>
    item.signedUrl ? [[item.path, item.signedUrl] as [string, string]] : []
  ))
}

async function embedQuery(query: string) {
  if (!query.trim()) return null
  const key = Deno.env.get("OPENAI_API_KEY") || ""
  if (!key) return null
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-large",
        input: query.slice(0, 4000),
        encoding_format: "float",
      }),
    })
    if (!response.ok) return null
    const result = await response.json()
    return result?.data?.[0]?.embedding || null
  } catch {
    return null
  }
}

function cpfRole(platformRole: string) {
  if (platformRole === "admin") return "admin"
  if (platformRole === "dcc") return "editor"
  return "viewer"
}

function canEdit(sess: Session) {
  return sess.role === "admin" || sess.role === "dcc"
}

function canReadSensitivity(
  sensitivity: string,
  sess: Session,
  grants: Map<string, boolean>,
  documentId: string,
) {
  if (sess.role === "admin") return true
  if (sensitivity === "general") return true
  if (sensitivity === "commercial") return sess.role === "dcc"
  return grants.get(documentId) === true
}

function scoreProduct(row: Record<string, any>, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  if ((row.model_numbers || []).some((model: string) => model.toLowerCase() === q)) return 1000
  const haystack = [
    row.name_original, row.name_zh_tw, row.name_en, row.name_vi, row.brand,
    ...(row.model_numbers || []), ...(row.functions || []), ...(row.keywords || []),
  ].filter(Boolean).join(" ").toLowerCase()
  if (haystack === q) return 500
  if (haystack.includes(q)) return 100
  const words = q.split(/\s+/).filter(Boolean)
  return words.reduce((sum, word) => sum + (haystack.includes(word) ? 8 : 0), 0)
}

function productSummary(
  row: Record<string, any>,
  categories: Map<string, any>,
  suppliers: Map<string, any[]>,
  documentCount: number,
  score = 0,
) {
  return {
    id: row.id,
    nameOriginal: row.name_original,
    nameZhTw: row.name_zh_tw,
    nameEn: row.name_en,
    nameVi: row.name_vi,
    brand: row.brand,
    modelNumbers: row.model_numbers || [],
    category: row.category_id ? categories.get(row.category_id) || null : null,
    functions: row.functions || [],
    keywords: row.keywords || [],
    suppliers: suppliers.get(row.id) || [],
    confirmationStatus: row.confirmation_status,
    thumbnailUrl: row.representative_thumbnail_path,
    documentCount,
    updatedAt: row.updated_at,
    score,
  }
}

function documentSummary(row: Record<string, any>, version: Record<string, any>) {
  return {
    id: row.id,
    title: row.title,
    extension: version?.extension || "",
    documentType: row.document_type,
    sensitivity: row.sensitivity,
    processingStatus: row.processing_status,
    sourcePath: row.source_path,
    version: Number(version?.version_number || 1),
    byteSize: Number(version?.byte_size || 0),
    pageCount: version?.page_count ?? null,
    previewUrl: version?.preview_path || null,
    thumbnailUrl: version?.thumbnail_path || null,
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
    site: String(verified.site || ""),
  }

  const url = Deno.env.get("SB_URL") || ""
  const key = Deno.env.get("SB_SERVICE_ROLE_KEY") || ""
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

  const role = cpfRole(sess.role)
  if (action === "bootstrap") {
    return json({
      profile: {
        id: user.emp_id,
        email: user.email || `${user.emp_id}@comart.com.tw`,
        displayName: user.name_zh || user.name_en || user.emp_id,
        role,
        active: true,
      },
    })
  }

  const { data: grantRows } = await sb
    .from("cpf_platform_document_access_grants")
    .select("document_id,can_read")
    .eq("emp_id", sess.empId)
  const grants = new Map((grantRows || []).map((g: any) => [g.document_id, g.can_read]))

  if (action === "profiles") {
    if (sess.role !== "admin") return json({ error: "forbidden" }, 403)
    const { data, error } = await sb.from("users")
      .select("emp_id,name_en,name_zh,email,role,active").order("emp_id")
    if (error) return json({ error: error.message }, 500)
    return json({ items: (data || []).map((row: any) => ({
      id: row.emp_id,
      email: row.email || "",
      displayName: row.name_zh || row.name_en || row.emp_id,
      role: cpfRole(row.role),
      active: row.active !== false && row.role !== "inactive",
    })) })
  }

  if (action === "categories") {
    const [{ data, error }, { data: aliases }, { data: usage }] = await Promise.all([
      sb.from("cpf_categories")
      .select("id,name_zh_tw,parent_id").is("deleted_at", null).order("sort_order")
      , sb.from("cpf_category_aliases").select("category_id,alias,locale")
      , sb.from("cpf_products").select("category_id").is("deleted_at", null)
    ])
    if (error) return json({ error: error.message }, 500)
    return json({ items: (data || []).map((row: any) => ({
      id: row.id, nameZhTw: row.name_zh_tw, parentId: row.parent_id,
      aliases: (aliases || []).filter((a: any) => a.category_id === row.id).map((a: any) => a.alias),
      productCount: (usage || []).filter((p: any) => p.category_id === row.id).length,
    })) })
  }

  if (action === "suppliers") {
    const [{ data, error }, { data: aliases }, { data: usage }] = await Promise.all([
      sb.from("cpf_suppliers")
      .select("id,legal_name").is("deleted_at", null).order("legal_name")
      , sb.from("cpf_supplier_aliases").select("supplier_id,alias,locale")
      , sb.from("cpf_product_suppliers").select("supplier_id,product_id")
    ])
    if (error) return json({ error: error.message }, 500)
    return json({ items: (data || []).map((row: any) => ({
      id: row.id, name: row.legal_name,
      aliases: (aliases || []).filter((a: any) => a.supplier_id === row.id).map((a: any) => a.alias),
      productCount: new Set((usage || []).filter((p: any) => p.supplier_id === row.id).map((p: any) => p.product_id)).size,
    })) })
  }

  if (action === "createCategory" || action === "createSupplier") {
    if (sess.role !== "admin") return json({ error: "forbidden" }, 403)
    if (action === "createCategory") {
      const name = String(body.nameZhTw || "").trim()
      if (!name) return json({ error: "name_required" }, 400)
      const { data, error } = await sb.from("cpf_categories").insert({
        name_zh_tw: name,
        slug: `category-${crypto.randomUUID()}`,
      }).select("id,name_zh_tw,parent_id").single()
      if (error) return json({ error: error.message }, 400)
      return json({ item: { id: data.id, nameZhTw: data.name_zh_tw, parentId: data.parent_id } })
    }
    const name = String(body.legalName || "").trim()
    if (!name) return json({ error: "name_required" }, 400)
    const { data, error } = await sb.from("cpf_suppliers")
      .insert({ legal_name: name }).select("id,legal_name").single()
    if (error) return json({ error: error.message }, 400)
    return json({ item: { id: data.id, name: data.legal_name } })
  }

  if (action === "updateMaster") {
    if (sess.role !== "admin") return json({ error: "forbidden" }, 403)
    const kind = String(body.kind || "")
    const id = String(body.id || "")
    const name = String(body.name || "").trim()
    const aliases = [...new Set((body.aliases || []).map((item: unknown) => String(item).trim()).filter(Boolean))]
    if (!id || !name || !["category", "supplier"].includes(kind)) return json({ error: "bad_master_data" }, 400)
    const table = kind === "category" ? "cpf_categories" : "cpf_suppliers"
    const nameField = kind === "category" ? "name_zh_tw" : "legal_name"
    const aliasTable = kind === "category" ? "cpf_category_aliases" : "cpf_supplier_aliases"
    const foreignKey = kind === "category" ? "category_id" : "supplier_id"
    const { error } = await sb.from(table).update({ [nameField]: name, updated_at: new Date().toISOString() }).eq("id", id)
    if (error) return json({ error: error.message }, 400)
    await sb.from(aliasTable).delete().eq(foreignKey, id)
    if (aliases.length) {
      const { error: aliasError } = await sb.from(aliasTable).insert(aliases.map(alias => ({ [foreignKey]: id, alias })))
      if (aliasError) return json({ error: aliasError.message }, 400)
    }
    await sb.from("cpf_audit_log").insert({
      action: `platform_update_${kind}`, entity_type: kind, entity_id: id,
      details: { empId: sess.empId, platform: true, name, aliases },
    })
    return json({ ok: true })
  }

  if (action === "mergeMaster") {
    if (sess.role !== "admin") return json({ error: "forbidden" }, 403)
    const kind = String(body.kind || "")
    if (!["category", "supplier"].includes(kind)) return json({ error: "bad_master_kind" }, 400)
    const rpc = kind === "category" ? "cpf_merge_category" : "cpf_merge_supplier"
    const { data, error } = await sb.rpc(rpc, {
      p_source_id: body.sourceId, p_target_id: body.targetId, p_actor: sess.empId,
    })
    if (error) return json({ error: error.message }, 400)
    await sb.from("cpf_audit_log").insert({
      action: `platform_merge_${kind}`, entity_type: kind, entity_id: String(body.sourceId),
      details: { empId: sess.empId, platform: true, targetId: body.targetId, result: data },
    })
    return json({ result: data })
  }

  const { data: documents, error: documentError } = await sb.from("cpf_documents")
    .select("*")
  if (documentError) return json({ error: documentError.message }, 500)
  const visibleDocuments = (documents || []).filter((doc: any) =>
    canReadSensitivity(doc.sensitivity, sess, grants, doc.id)
  )
  const visibleDocumentIds = new Set(visibleDocuments.map((doc: any) => doc.id))
  const versionIds = visibleDocuments.map((doc: any) => doc.current_version_id).filter(Boolean)
  const { data: versions } = versionIds.length
    ? await sb.from("cpf_document_versions").select("*").in("id", versionIds)
    : { data: [] }
  const versionsById = new Map((versions || []).map((v: any) => [v.id, v]))

  if (action === "searchDocuments") {
    const started = performance.now()
    const query = String(body.query || "").trim()
    const filters = body.filters || {}
    const embedding = await embedQuery(query)
    const { data: rankedRows } = await sb.rpc("cpf_platform_rank_documents", {
      p_query: query, p_embedding: embedding,
    })
    const rankMap = new Map((rankedRows || []).map((row: any) => [row.document_id, Number(row.score)]))
    const rows = visibleDocuments.filter((doc: any) => {
      if (doc.deleted_at) return false
      const version: any = versionsById.get(doc.current_version_id)
      if (filters.extension && version?.extension !== filters.extension) return false
      return !query || rankMap.has(doc.id)
    }).map((doc: any) => ({
      ...documentSummary(doc, versionsById.get(doc.current_version_id) as any),
      score: rankMap.get(doc.id) || 0,
    })).sort((a: any, b: any) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100)
    const signed = await signPaths(sb, "cpf_thumbnail", rows.map((row: any) => row.thumbnailUrl))
    for (const row of rows) row.thumbnailUrl = signed.get(row.thumbnailUrl) || null
    return json({ items: rows, total: rows.length, elapsedMs: Math.round(performance.now() - started) })
  }

  if (action === "document") {
    const doc: any = visibleDocuments.find((item: any) => item.id === body.id && !item.deleted_at)
    if (!doc) return json({ item: null })
    const version: any = versionsById.get(doc.current_version_id)
    const { data: extractedItems, error: extractedItemsError } = await sb
      .from("cpf_extracted_items")
      .select("id,item_index,item_kind,name_original,name_zh_tw,family_key,parent_product_name,model_numbers,identity_signals,creation_rationale,confidence,review_status,promoted_product_id")
      .eq("document_version_id", version.id)
      .order("item_index")
    if (extractedItemsError) return json({ error: extractedItemsError.message }, 500)
    const analysisResult = version?.analysis_result && typeof version.analysis_result === "object"
      ? version.analysis_result
      : null
    const rawProducts = Array.isArray(analysisResult?.products) ? analysisResult.products : []
    const persistedByIndex = new Map(
      (extractedItems || []).map((item: any) => [Number(item.item_index), item]),
    )
    const createdProductIds = Array.isArray(analysisResult?.productIds)
      ? analysisResult.productIds.map(String) : []
    let completeProductIndex = 0
    const analysisItems = rawProducts.length
      ? rawProducts.map((item: any, index: number) => {
          const persisted: any = persistedByIndex.get(index)
          const recordKind = [
            "complete_product", "product_variant", "design_asset", "component",
            "commercial_line_item", "product_candidate",
          ].includes(item.record_kind) ? item.record_kind : "complete_product"
          const createdProductId = recordKind === "complete_product"
            ? createdProductIds[completeProductIndex++] || null
            : null
          const promotedProductId = persisted?.promoted_product_id || createdProductId
          return {
            id: persisted?.id || `analysis-${version.id}-${index}`,
            kind: recordKind,
            name: item.name_zh_tw || item.name_original || "未命名項目",
            familyKey: item.family_key || null,
            parentProductName: item.parent_product_name || null,
            modelNumbers: item.model_numbers || [],
            identitySignals: item.identity_signals || [],
            rationale: item.creation_rationale || "",
            confidence: Number(item.confidence || 0),
            reviewStatus: persisted?.review_status || "resolved",
            promotedProductId,
            actionable: Boolean(persisted) && persisted.review_status === "open",
          }
        })
      : (extractedItems || []).map((item: any) => ({
          id: item.id,
          kind: item.item_kind,
          name: item.name_zh_tw || item.name_original,
          familyKey: item.family_key,
          parentProductName: item.parent_product_name,
          modelNumbers: item.model_numbers || [],
          identitySignals: item.identity_signals || [],
          rationale: item.creation_rationale || "",
          confidence: Number(item.confidence),
          reviewStatus: item.review_status,
          promotedProductId: item.promoted_product_id,
          actionable: item.review_status === "open",
        }))
    const { data: linkedRows, error: linkedRowsError } = await sb
      .from("cpf_product_documents")
      .select("product_id")
      .eq("document_id", doc.id)
    if (linkedRowsError) return json({ error: linkedRowsError.message }, 500)
    const linkedProductIds = [...new Set((linkedRows || []).map((row: any) => row.product_id))]
    const [{ data: linkedProducts }, { data: linkedCategories }, { data: linkedSuppliers }] =
      linkedProductIds.length ? await Promise.all([
        sb.from("cpf_products").select("*").in("id", linkedProductIds).is("deleted_at", null),
        sb.from("cpf_categories").select("id,name_zh_tw,parent_id"),
        sb.from("cpf_product_suppliers")
          .select("product_id,supplier_role,confirmation_status,cpf_suppliers(id,legal_name)")
          .in("product_id", linkedProductIds),
      ]) : [{ data: [] }, { data: [] }, { data: [] }]
    const linkedCategoryMap = new Map((linkedCategories || []).map((category: any) => [
      category.id,
      { id: category.id, nameZhTw: category.name_zh_tw, parentId: category.parent_id },
    ]))
    const linkedSupplierMap = new Map<string, any[]>()
    for (const row of linkedSuppliers || []) {
      const supplier: any = (row as any).cpf_suppliers
      if (!supplier) continue
      linkedSupplierMap.set((row as any).product_id, [
        ...(linkedSupplierMap.get((row as any).product_id) || []),
        {
          id: supplier.id, name: supplier.legal_name, role: (row as any).supplier_role,
          confirmationStatus: (row as any).confirmation_status,
        },
      ])
    }
    const linkedProductItems = (linkedProducts || []).map((product: any) =>
      productSummary(product, linkedCategoryMap, linkedSupplierMap, 1)
    )
    const linkedThumbs = await signPaths(
      sb, "cpf_thumbnail", linkedProductItems.map((item: any) => item.thumbnailUrl),
    )
    for (const item of linkedProductItems) {
      item.thumbnailUrl = linkedThumbs.get(item.thumbnailUrl) || null
    }
    const policyVersion = String(analysisResult?.policyVersion || "")
    const analysisStatus = !analysisResult
      ? "not_analyzed"
      : policyVersion === "cpf-product-creation-v2" ? "current" : "legacy"
    return json({
      item: {
        ...documentSummary(doc, version),
        extractedItems: analysisItems,
        linkedProducts: linkedProductItems,
        analysis: {
          status: analysisStatus,
          policyVersion: policyVersion || null,
          summary: String(analysisResult?.summary_zh_tw || ""),
          reviewReasons: Array.isArray(analysisResult?.review_reasons)
            ? analysisResult.review_reasons.map(String) : [],
          masterProductCount: Number(
            analysisResult?.masterProductCount
              ?? rawProducts.filter((item: any) =>
                !item.record_kind || item.record_kind === "complete_product"
              ).length,
          ),
          extractedItemCount: Number(
            analysisResult?.extractedItemCount ?? (extractedItems || []).length,
          ),
        },
      },
    })
  }

  if (action === "resolveExtractedItem") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const resolution = body.resolution || {}
    const resolutionAction = String(resolution.action || "")
    if (!["create", "link", "keep"].includes(resolutionAction)) {
      return json({ error: "bad_resolution_action" }, 400)
    }
    const { data: item, error: itemError } = await sb.from("cpf_extracted_items")
      .select("id,document_version_id").eq("id", body.itemId).maybeSingle()
    if (itemError || !item) return json({ error: itemError?.message || "item_not_found" }, 404)
    const { data: itemVersion } = await sb.from("cpf_document_versions")
      .select("document_id").eq("id", item.document_version_id).maybeSingle()
    if (!itemVersion || !visibleDocumentIds.has(itemVersion.document_id)) {
      return json({ error: "forbidden_document" }, 403)
    }
    const suppliers = Array.isArray(resolution.suppliers)
      ? resolution.suppliers.slice(0, 100).map((supplier: any) => ({
          id: String(supplier.id), role: String(supplier.role || "unknown"),
        }))
      : null
    const { data, error } = await sb.rpc("cpf_resolve_extracted_item", {
      p_item_id: item.id,
      p_action: resolutionAction,
      p_product_id: resolution.productId || null,
      p_category_id: resolution.categoryId || null,
      p_supplier_links: suppliers,
      p_actor: sess.empId,
    })
    if (error) return json({ error: error.message }, 400)
    return json({ result: data })
  }

  if (action === "fileUrl") {
    let doc: any = null
    let path = ""
    let bucket = ""
    if (body.kind === "product_thumbnail") {
      const { data: product } = await sb.from("cpf_products")
        .select("id,representative_thumbnail_path").eq("id", body.productId).maybeSingle()
      if (!product?.representative_thumbnail_path) return json({ url: null })
      const { data: links } = await sb.from("cpf_product_documents")
        .select("document_id").eq("product_id", product.id)
      if (!(links || []).some((link: any) => visibleDocumentIds.has(link.document_id))) {
        return json({ error: "forbidden" }, 403)
      }
      path = product.representative_thumbnail_path
      bucket = "cpf_thumbnail"
    } else {
      doc = visibleDocuments.find((item: any) => item.id === body.documentId && !item.deleted_at)
      if (!doc) return json({ error: "forbidden" }, 403)
      const version: any = versionsById.get(doc.current_version_id)
      const extension = String(version?.extension || "").toLowerCase()
      const usesSourcePreview = ["jpg", "jpeg", "png", "pdf"].includes(extension)
      if (body.kind === "source") { path = version?.storage_path; bucket = "cpf_source" }
      if (body.kind === "preview") {
        path = usesSourcePreview ? version?.storage_path : version?.preview_path
        bucket = usesSourcePreview ? "cpf_source" : "cpf_preview"
      }
      if (body.kind === "thumbnail") { path = version?.thumbnail_path; bucket = "cpf_thumbnail" }
    }
    if (!path || !bucket) return json({ url: null })
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 300)
    if (error) return json({ error: error.message }, 500)
    await sb.from("cpf_audit_log").insert({
      action: "download",
      entity_type: body.kind === "product_thumbnail" ? "product_thumbnail" : "document",
      entity_id: String(body.productId || body.documentId),
      sensitivity: doc?.sensitivity || null,
      details: { empId: sess.empId, platform: true, kind: body.kind },
    })
    return json({ url: data.signedUrl })
  }

  const { data: products, error: productError } = await sb.from("cpf_products").select("*")
  if (productError) return json({ error: productError.message }, 500)
  const productIds = (products || []).map((p: any) => p.id)
  const [{ data: categories }, { data: productSuppliers }, { data: productDocs }] = await Promise.all([
    sb.from("cpf_categories").select("id,name_zh_tw,parent_id"),
    productIds.length
      ? sb.from("cpf_product_suppliers").select("product_id,supplier_role,confirmation_status,cpf_suppliers(id,legal_name)").in("product_id", productIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? sb.from("cpf_product_documents").select("product_id,document_id").in("product_id", productIds)
      : Promise.resolve({ data: [] }),
  ])
  const categoryMap = new Map((categories || []).map((c: any) => [c.id, {
    id: c.id, nameZhTw: c.name_zh_tw, parentId: c.parent_id,
  }]))
  const supplierMap = new Map<string, any[]>()
  for (const row of productSuppliers || []) {
    const supplier: any = (row as any).cpf_suppliers
    if (!supplier) continue
    const list = supplierMap.get((row as any).product_id) || []
    list.push({
      id: supplier.id,
      name: supplier.legal_name,
      role: (row as any).supplier_role,
      confirmationStatus: (row as any).confirmation_status,
    })
    supplierMap.set((row as any).product_id, list)
  }
  const docsByProduct = new Map<string, string[]>()
  for (const row of productDocs || []) {
    const list = docsByProduct.get((row as any).product_id) || []
    list.push((row as any).document_id)
    docsByProduct.set((row as any).product_id, list)
  }

  if (action === "searchProducts") {
    const started = performance.now()
    const query = String(body.query || "")
    const filters = body.filters || {}
    const embedding = await embedQuery(query)
    const { data: rankedRows } = await sb.rpc("cpf_platform_rank_products", {
      p_query: query, p_embedding: embedding,
    })
    const rankMap = new Map((rankedRows || []).map((row: any) => [row.product_id, Number(row.score)]))
    const ranked = (products || []).filter((product: any) => {
      if (product.deleted_at) return false
      const linked = (docsByProduct.get(product.id) || []).filter(id => visibleDocumentIds.has(id))
      if (!linked.length) return false
      if (filters.categoryId && product.category_id !== filters.categoryId) return false
      if (filters.confirmationStatus && product.confirmation_status !== filters.confirmationStatus) return false
      if (filters.supplierId && !(supplierMap.get(product.id) || []).some(s => s.id === filters.supplierId)) return false
      if (filters.uncategorized && product.category_id) return false
      if (filters.withoutSupplier && (supplierMap.get(product.id) || []).length) return false
      return !query.trim() || rankMap.has(product.id)
    }).map((product: any) => {
      const linked = (docsByProduct.get(product.id) || []).filter(id => visibleDocumentIds.has(id))
      return productSummary(product, categoryMap, supplierMap, linked.length, rankMap.get(product.id) || scoreProduct(product, query))
    }).sort((a: any, b: any) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    const items = ranked.slice(0, 100)
    const signed = await signPaths(sb, "cpf_thumbnail", items.map((item: any) => item.thumbnailUrl))
    for (const item of items) item.thumbnailUrl = signed.get(item.thumbnailUrl) || null
    return json({ items, total: ranked.length, elapsedMs: Math.round(performance.now() - started) })
  }

  if (action === "productReviewGaps") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const items = (products || []).filter((product: any) => {
      if (product.deleted_at) return false
      return (docsByProduct.get(product.id) || []).some(id => visibleDocumentIds.has(id))
    }).map((product: any) => {
      const missing: string[] = []
      if (!product.category_id) missing.push("category")
      if (!(supplierMap.get(product.id) || []).length) missing.push("supplier")
      if (!(product.model_numbers || []).length) missing.push("model")
      if (!product.representative_thumbnail_path) missing.push("thumbnail")
      const linkedCount = (docsByProduct.get(product.id) || [])
        .filter(id => visibleDocumentIds.has(id)).length
      const summary = productSummary(product, categoryMap, supplierMap, linkedCount)
      if (!summary.thumbnailUrl) {
        const sourceDocumentId = (docsByProduct.get(product.id) || [])
          .find(id => visibleDocumentIds.has(id))
        const sourceDocument: any = visibleDocuments.find((doc: any) => doc.id === sourceDocumentId)
        const sourceVersion: any = sourceDocument
          ? versionsById.get(sourceDocument.current_version_id) : null
        summary.thumbnailUrl = sourceVersion?.thumbnail_path || null
      }
      return {
        product: summary,
        missing,
      }
    }).filter((item: any) => item.missing.length)
      .sort((a: any, b: any) => b.missing.length - a.missing.length
        || b.product.updatedAt.localeCompare(a.product.updatedAt))
      .slice(0, 200)
    const signed = await signPaths(
      sb, "cpf_thumbnail", items.map((item: any) => item.product.thumbnailUrl),
    )
    for (const item of items) {
      item.product.thumbnailUrl = signed.get(item.product.thumbnailUrl) || null
    }
    return json({ items })
  }

  if (action === "batchFillProductGaps") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const requested = [...new Set((body.productIds || []).map(String))].slice(0, 200)
    const field = String(body.field || "")
    if (!requested.length || !["category", "supplier", "model"].includes(field)) {
      return json({ error: "bad_batch_request" }, 400)
    }
    const allowed = requested.filter((productId) =>
      (docsByProduct.get(productId) || []).some(documentId => visibleDocumentIds.has(documentId))
    )
    if (allowed.length !== requested.length) return json({ error: "forbidden_product" }, 403)
    const { data, error } = await sb.rpc("cpf_batch_fill_product_gaps", {
      p_product_ids: allowed,
      p_field: field,
      p_value: body.value || {},
      p_actor: sess.empId,
    })
    if (error) return json({ error: error.message }, 400)
    return json({ result: data })
  }

  if (action === "product") {
    const product: any = (products || []).find((item: any) => item.id === body.id && !item.deleted_at)
    if (!product) return json({ item: null })
    const linkedIds = (docsByProduct.get(product.id) || []).filter(id => visibleDocumentIds.has(id))
    if (!linkedIds.length) return json({ item: null })
    const [{ data: specs }, { data: evidence }, { data: quotes }] = await Promise.all([
      sb.from("cpf_specifications").select("*").eq("product_id", product.id),
      sb.from("cpf_evidence").select("*,cpf_document_versions(document_id)").eq("product_id", product.id),
      sb.from("cpf_quotes").select("*,cpf_suppliers(legal_name),cpf_quote_tiers(unit_price)").eq("product_id", product.id).eq("confirmation_status", "human_confirmed").order("quote_date", { ascending: false }).limit(1),
    ])
    const detail: any = productSummary(product, categoryMap, supplierMap, linkedIds.length)
    detail.specifications = (specs || []).map((s: any) => ({
      id: s.id, name: s.name, valueText: s.value_text, valueNumber: s.value_number,
      unit: s.unit, sourceText: s.source_text, confirmationStatus: s.confirmation_status,
    }))
    detail.evidence = (evidence || []).filter((e: any) =>
      visibleDocumentIds.has(e.cpf_document_versions?.document_id)
    ).map((e: any) => ({
      id: e.id, fieldName: e.field_name, sourceLabel: "",
      sourceLocator: e.source_locator, excerpt: e.excerpt,
      confirmationStatus: e.confirmation_status,
    }))
    detail.documents = linkedIds.map(id => {
      const doc: any = visibleDocuments.find((d: any) => d.id === id)
      return documentSummary(doc, versionsById.get(doc.current_version_id) as any)
    })
    const quote: any = quotes?.[0]
    detail.latestConfirmedQuote = quote ? {
      id: quote.id,
      supplierName: quote.cpf_suppliers?.legal_name || "",
      currency: quote.currency,
      unitPrice: Math.min(...(quote.cpf_quote_tiers || []).map((t: any) => Number(t.unit_price))),
      moq: quote.moq,
      leadTimeDays: quote.lead_time_days,
      quoteDate: quote.quote_date,
      incoterm: quote.incoterm,
    } : null
    return json({ item: detail })
  }

  if (action === "jobs") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const { data, error } = await sb.from("cpf_processing_jobs")
      .select("*,cpf_documents(title,sensitivity)").order("created_at", { ascending: false }).limit(50)
    if (error) return json({ error: error.message }, 500)
    return json({ items: (data || []).filter((row: any) =>
      canReadSensitivity(row.cpf_documents?.sensitivity, sess, grants, row.document_id)
    ).map((row: any) => ({
      id: row.id, documentTitle: row.cpf_documents?.title || "未命名文件",
      status: row.status, progress: row.progress, message: row.message,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })) })
  }

  if (action === "reviews") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const { data, error } = await sb.from("cpf_review_tasks")
      .select("*,cpf_documents(title,sensitivity)").eq("status", "open").order("created_at", { ascending: false })
    if (error) return json({ error: error.message }, 500)
    return json({ items: (data || []).filter((row: any) =>
      !row.document_id || canReadSensitivity(row.cpf_documents?.sensitivity, sess, grants, row.document_id)
    ).map((row: any) => ({
      id: row.id, type: row.review_type, title: row.title, description: row.description,
      documentTitle: row.cpf_documents?.title || "未連結文件",
      documentId: row.document_id, productId: row.product_id,
      priority: row.priority, createdAt: row.created_at,
    })) })
  }

  if (action === "mappingSuggestions") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const { data, error } = await sb.from("cpf_master_mapping_suggestions")
      .select("*,cpf_products(id,name_zh_tw,model_numbers,deleted_at),cpf_categories(id,name_zh_tw),cpf_suppliers(id,legal_name)")
      .eq("status", "pending").order("confidence", { ascending: false })
    if (error) return json({ error: error.message }, 500)
    return json({ items: (data || []).filter((row: any) => (
      row.cpf_products && !row.cpf_products.deleted_at
    )).map((row: any) => ({
      id: row.id, type: row.mapping_type, productId: row.product_id,
      productName: row.cpf_products?.name_zh_tw || "未命名產品",
      modelNumbers: row.cpf_products?.model_numbers || [],
      masterId: row.category_id || row.supplier_id,
      masterName: row.cpf_categories?.name_zh_tw || row.cpf_suppliers?.legal_name || "未命名主檔",
      supplierRole: row.supplier_role, confidence: Number(row.confidence),
      rationale: row.rationale, evidenceExcerpt: row.evidence_excerpt,
    })) })
  }

  if (action === "applyMappingSuggestions") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const ids = [...new Set((body.ids || []).map(String))].slice(0, 500)
    if (!ids.length) return json({ error: "suggestion_ids_required" }, 400)
    const { data, error } = await sb.rpc("cpf_apply_mapping_suggestions", {
      p_suggestion_ids: ids, p_actor: sess.empId,
    })
    if (error) return json({ error: error.message }, 400)
    await sb.from("cpf_audit_log").insert({
      action: "platform_apply_mapping_suggestions", entity_type: "mapping_batch",
      details: { empId: sess.empId, platform: true, ids, result: data },
    })
    return json({ result: data })
  }

  if (action === "closeReview") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const status = String(body.status)
    if (!["resolved", "dismissed"].includes(status)) return json({ error: "bad_status" }, 400)
    const { error } = await sb.from("cpf_review_tasks").update({
      status, resolved_at: new Date().toISOString(),
    }).eq("id", body.id)
    if (error) return json({ error: error.message }, 400)
    await sb.from("cpf_audit_log").insert({
      action: `platform_review_${status}`, entity_type: "review_task", entity_id: body.id,
      details: { empId: sess.empId, platform: true },
    })
    return json({ ok: true })
  }

  if (action === "batchApproveDocuments") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const requested = [...new Set((body.documentIds || []).map(String))].slice(0, 100)
    if (!requested.length) return json({ error: "document_ids_required" }, 400)
    const allowed = requested.filter((id) => visibleDocumentIds.has(id))
    if (allowed.length !== requested.length) return json({ error: "forbidden_document" }, 403)
    const { data, error } = await sb.rpc("cpf_batch_approve_documents", {
      p_document_ids: allowed,
      p_actor: sess.empId,
    })
    if (error) return json({ error: error.message }, 400)
    await sb.from("cpf_audit_log").insert({
      action: "platform_batch_approve_documents",
      entity_type: "document_batch",
      details: { empId: sess.empId, platform: true, documentIds: allowed, result: data },
    })
    return json({ result: data })
  }

  if (action === "updateProduct") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const patch = body.patch || {}
    const mapped = {
      name_original: patch.nameOriginal,
      name_zh_tw: patch.nameZhTw,
      name_en: patch.nameEn,
      name_vi: patch.nameVi,
      brand: patch.brand,
      model_numbers: patch.modelNumbers,
      functions: patch.functions,
      keywords: patch.keywords,
      category_id: patch.categoryId || null,
      confirmation_status: "human_confirmed",
      manual_overrides: {
        name_original: true, name_zh_tw: true, name_en: true, name_vi: true,
        brand: true, model_numbers: true, functions: true, keywords: true,
        category_id: true,
      },
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from("cpf_products").update(mapped).eq("id", body.id)
    if (error) return json({ error: error.message }, 400)
    if (Array.isArray(patch.suppliers)) {
      await sb.from("cpf_product_suppliers").delete().eq("product_id", body.id)
      if (patch.suppliers.length) {
        const { error: supplierError } = await sb.from("cpf_product_suppliers").insert(
          patch.suppliers.map((supplier: any) => ({
            product_id: body.id, supplier_id: supplier.id,
            supplier_role: supplier.role || "unknown",
            confirmation_status: "human_confirmed",
          })),
        )
        if (supplierError) return json({ error: supplierError.message }, 400)
      }
    }
    await sb.from("cpf_audit_log").insert({
      action: "platform_manual_update", entity_type: "product", entity_id: body.id,
      details: { empId: sess.empId, platform: true },
    })
    return json({ ok: true })
  }

  if (action === "trash") {
    if (sess.role !== "admin") return json({ error: "forbidden" }, 403)
    const items = [
      ...(products || []).filter((p: any) => p.deleted_at).map((p: any) => ({
        id: p.id, kind: "product", title: p.name_zh_tw, deletedAt: p.deleted_at,
      })),
      ...(documents || []).filter((d: any) => d.deleted_at).map((d: any) => ({
        id: d.id, kind: "document", title: d.title, deletedAt: d.deleted_at,
      })),
    ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    return json({ items })
  }

  if (action === "restore") {
    if (sess.role !== "admin") return json({ error: "forbidden" }, 403)
    const table = body.item?.kind === "product" ? "cpf_products" : "cpf_documents"
    const { error } = await sb.from(table).update({ deleted_at: null, deleted_by: null }).eq("id", body.item?.id)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if (action === "initUpload") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const name = String(body.name || "").replace(/[\/\\]/g, "_")
    const size = Number(body.byteSize || 0)
    if (!name || size <= 0 || size > 524288000) return json({ error: "invalid_file" }, 400)
    const path = `${crypto.randomUUID()}/${name}`
    const { data, error } = await sb.storage.from("cpf_source").createSignedUploadUrl(path)
    if (error) return json({ error: error.message }, 400)
    return json({ path, signedUrl: data.signedUrl })
  }

  if (action === "completeUpload") {
    if (!canEdit(sess)) return json({ error: "forbidden" }, 403)
    const sensitivity = String(body.sensitivity || "general")
    if (!["general", "commercial", "highly_confidential"].includes(sensitivity)) {
      return json({ error: "bad_sensitivity" }, 400)
    }
    const { data: object } = await sb.storage.from("cpf_source")
      .list(String(body.path).split("/")[0], { search: String(body.path).split("/").slice(1).join("/") })
    if (!object?.length) return json({ error: "upload_not_found" }, 400)
    const { data: doc, error: docError } = await sb.from("cpf_documents").insert({
      title: String(body.name), sensitivity, source_kind: "web_upload",
      source_path: String(body.path),
    }).select("id").single()
    if (docError) return json({ error: docError.message }, 400)
    const extension = String(body.name).includes(".")
      ? String(body.name).split(".").pop()?.toLowerCase() || ""
      : ""
    const { data: version, error: versionError } = await sb.from("cpf_document_versions").insert({
      document_id: doc.id, version_number: 1, storage_path: body.path,
      mime_type: body.mimeType || "application/octet-stream",
      extension, byte_size: Number(body.byteSize),
      sha256: "0".repeat(64), deep_analysis_eligible: Number(body.byteSize) <= 104857600,
    }).select("id").single()
    if (versionError) {
      await sb.from("cpf_documents").delete().eq("id", doc.id)
      return json({ error: versionError.message }, 400)
    }
    await sb.from("cpf_documents").update({ current_version_id: version.id }).eq("id", doc.id)
    await sb.from("cpf_processing_jobs").insert({
      document_id: doc.id, document_version_id: version.id,
    })
    await sb.from("cpf_audit_log").insert({
      action: "platform_upload", entity_type: "document", entity_id: doc.id,
      sensitivity, details: { empId: sess.empId, platform: true, path: body.path },
    })
    return json({ documentId: doc.id, versionId: version.id, status: "queued" })
  }

  return json({ error: "unknown_action" }, 400)
})
