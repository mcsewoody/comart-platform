import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifySession } from "../_shared/session.ts"
import { namedSecretKey } from "../_shared/api-keys.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-session",
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CURRENCIES = new Set(["USD", "NTD", "CNY", "HKD", "VND"])
const STATUS = new Set(["available", "in_use", "maintenance", "lost", "retired"])
const PURPOSES = new Set(["borrow", "product_test", "production", "maintenance", "other", "return"])
const CONDITIONS = new Set(["normal", "used", "damaged", "missing_accessory"])

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}
function text(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max) }
function nullable(value: unknown, max = 500) { const v = text(value, max); return v || null }
function dateValue(value: unknown) { const v = text(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null }
function isAdmin(sess: any, user: any) { return sess.role === "admin" && user.role === "admin" }
function activeUser(row: any) { return row && row.active !== false && row.status !== "disabled" && row.status !== "resigned" && row.role !== "inactive" }
function displayName(row: any) { return row?.name_zh || row?.name_en || row?.emp_id || "" }
function canSeeIdentifier(asset: any, sess: any) { return sess.role === "admin" || asset.custodian_emp_id === sess.empId }
function maskId(value: unknown) { const v = text(value, 100); return v ? `••••${v.slice(-4)}` : null }
function safeSpec(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40)
    .map(([k, v]) => [text(k, 80), text(v, 300)]).filter(([k, v]) => k && v))
}
function safeAliases(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(v => text(v, 80)).filter(Boolean))].slice(0, 40)
}
function outputText(response: any) {
  if (typeof response?.output_text === "string") return response.output_text
  for (const item of response?.output || []) for (const content of item?.content || []) {
    if (content?.type === "output_text" && typeof content.text === "string") return content.text
  }
  return ""
}
function escapeLike(v: string) { return v.replaceAll("%", "\\%").replaceAll("_", "\\_") }

async function audit(sb: any, sess: any, action: string, assetId: string | null, before: any, after: any, reason?: string, transferId?: string) {
  const { error } = await sb.from("pd_device_audit_log").insert({
    asset_id: assetId, transfer_id: transferId || null, action, actor_emp_id: sess.empId,
    before_data: before || null, after_data: after || null, reason: reason || null,
  })
  if (error) console.error("pd_device audit failed", error)
}

async function notify(sb: any, toEmpIds: string[], from: string, title: string, body: string, link = "/product_dev/devices/") {
  const ids = [...new Set(toEmpIds.filter(Boolean))]
  if (!ids.length) return
  const rows = ids.map(empId => ({ to_user: empId, from_user: from, title, body, link, is_read: false }))
  const { error } = await sb.from("notifications").insert(rows)
  if (error) console.error("pd_device notification failed", error)
  const resendKey = Deno.env.get("RESEND_API_KEY") || ""
  if (!resendKey) return
  const { data: users } = await sb.from("users").select("emp_id,email").in("emp_id", ids)
  for (const user of users || []) {
    if (!user.email) continue
    fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("PD_DEVICE_EMAIL_FROM") || "COMART Platform <noreply@comart.com.tw>",
        to: [user.email], subject: title,
        html: `<p>${body.replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c] || c))}</p><p><a href="https://platform.comart.com.tw/product_dev/devices/">開啟手機與配件</a></p>`,
      }),
    }).catch(error => console.error("pd_device email failed", error))
  }
}

async function signedFiles(sb: any, asset: any) {
  const paths = [asset.image_storage_path, asset.receipt_storage_path].filter(Boolean)
  if (!paths.length) return { imageUrl: null, receiptUrl: null }
  const { data } = await sb.storage.from("pd-device-files").createSignedUrls(paths, 300)
  const map = new Map((data || []).map((x: any) => [x.path, x.signedUrl]))
  return { imageUrl: map.get(asset.image_storage_path) || null, receiptUrl: map.get(asset.receipt_storage_path) || null }
}

function presentAsset(asset: any, sess: any, files: any = {}) {
  const reveal = canSeeIdentifier(asset, sess)
  return {
    id: asset.id, assetCode: asset.asset_code, typeCode: asset.type_code,
    originalName: asset.original_name, brand: asset.brand, model: asset.model,
    officialModelCode: asset.official_model_code,
    manufacturerSerial: reveal ? asset.manufacturer_serial : maskId(asset.manufacturer_serial),
    imei1: reveal ? asset.imei1 : maskId(asset.imei1), imei2: reveal ? asset.imei2 : maskId(asset.imei2),
    identifiersMasked: !reveal, color: asset.color, specifications: asset.specifications || {}, aliases: asset.aliases || [],
    status: asset.status, approvalStatus: asset.approval_status, missingFields: asset.missing_fields || [],
    custodianEmpId: asset.custodian_emp_id, custodianOriginalName: asset.custodian_original_name,
    custodianName: asset.custodian ? displayName(asset.custodian) : asset.custodian_original_name,
    custodianConfirmedAt: asset.custodian_confirmed_at, ownershipUnit: asset.ownership_unit,
    currentLocation: asset.current_location, expectedAvailableDate: asset.expected_available_date,
    conditionNote: asset.condition_note, purchaseAmount: asset.purchase_amount,
    purchaseCurrency: asset.purchase_currency, purchaseCountry: asset.purchase_country,
    purchaseVendor: asset.purchase_vendor, purchaseDate: asset.purchase_date,
    warrantyExpiresOn: asset.warranty_expires_on, imageSourceUrl: asset.image_source_url,
    imageSourceName: asset.image_source_name, imageRetrievedAt: asset.image_retrieved_at,
    imageUrl: files.imageUrl || null, receiptUrl: files.receiptUrl || null,
    sourceNote: asset.source_note, activatedAt: asset.activated_at, approvedAt: asset.approved_at,
    lostAt: asset.lost_at, lostReason: asset.lost_reason, lostNote: asset.lost_note,
    retiredAt: asset.retired_at, retirementReason: asset.retirement_reason, retirementNote: asset.retirement_note,
    createdAt: asset.created_at, createdBy: asset.created_by, updatedAt: asset.updated_at, updatedBy: asset.updated_by,
  }
}

async function findOfficialImage(sb: any, sess: any, asset: any) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY") || ""
  if (!openaiKey || !asset.brand || !asset.model) return { found: false, reason: "missing_configuration_or_model" }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("PD_DEVICE_IMAGE_MODEL") || "gpt-5.4-mini",
      instructions: "Find the exact official manufacturer product page. Use only the manufacturer's official domain. Never guess. Return JSON only.",
      input: `Brand: ${asset.brand}\nModel: ${asset.model}\nOfficial model code: ${asset.official_model_code || "unknown"}`,
      tools: [{ type: "web_search" }], tool_choice: "auto",
      include: ["web_search_call.action.sources"], store: false, max_output_tokens: 600,
      text: { format: { type: "json_schema", name: "official_product_page", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: { found: { type: "boolean" }, official_page_url: { type: ["string","null"] }, source_name: { type: ["string","null"] }, reason: { type: "string" } },
        required: ["found","official_page_url","source_name","reason"],
      } } },
      safety_identifier: `pd-device-${sess.empId}`,
    }),
  })
  const result = await response.json()
  if (!response.ok) return { found: false, reason: result?.error?.message || "openai_error" }
  let match: any
  try { match = JSON.parse(outputText(result)) } catch { return { found: false, reason: "invalid_model_output" } }
  if (!match?.found || !/^https:\/\//i.test(match.official_page_url || "")) return { found: false, reason: match?.reason || "not_found" }
  const page = await fetch(match.official_page_url, { headers: { "User-Agent": "Mozilla/5.0 COMART-Product-Dev/1.0" } }).catch(() => null)
  if (!page?.ok) return { found: false, reason: "official_page_unavailable", officialPageUrl: match.official_page_url }
  const html = await page.text()
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (!og?.[1]) return { found: false, reason: "official_page_has_no_image", officialPageUrl: match.official_page_url }
  const imageUrl = new URL(og[1], match.official_page_url).toString()
  const image = await fetch(imageUrl).catch(() => null)
  if (!image?.ok) return { found: false, reason: "official_image_unavailable", officialPageUrl: match.official_page_url }
  const mime = image.headers.get("content-type") || ""
  if (!/^image\/(jpeg|png|webp)/i.test(mime)) return { found: false, reason: "unsupported_official_image" }
  const bytes = new Uint8Array(await image.arrayBuffer())
  if (bytes.length > 8 * 1024 * 1024) return { found: false, reason: "official_image_too_large" }
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg"
  const path = `images/${asset.id}/official-${Date.now()}.${ext}`
  const { error } = await sb.storage.from("pd-device-files").upload(path, bytes, { contentType: mime, upsert: false })
  if (error) return { found: false, reason: error.message }
  if (asset.image_storage_path) await sb.storage.from("pd-device-files").remove([asset.image_storage_path])
  const before = { image_storage_path: asset.image_storage_path, image_source_url: asset.image_source_url }
  const patch = { image_storage_path: path, image_source_url: match.official_page_url, image_source_name: match.source_name, image_retrieved_at: new Date().toISOString(), updated_by: sess.empId }
  const { error: updateError } = await sb.from("pd_device_assets").update(patch).eq("id", asset.id)
  if (updateError) return { found: false, reason: updateError.message }
  await audit(sb, sess, "official_image_found", asset.id, before, patch)
  return { found: true, officialPageUrl: match.official_page_url }
}

serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  const verified = await verifySession(req.headers.get("x-session") || "")
  if (!verified?.empId) return json({ error: "unauthorized" }, 401)
  const sess = { empId: String(verified.empId), role: String(verified.role || "user") }
  const sbUrl = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || ""
  const key = namedSecretKey("cpf_worker")
  if (!sbUrl || !key) return json({ error: "server_misconfigured" }, 500)
  const sb = createClient(sbUrl, key)
  const { data: user } = await sb.from("users").select("emp_id,name_en,name_zh,email,role,dept,site,active,status").eq("emp_id", sess.empId).maybeSingle()
  if (!activeUser(user)) return json({ error: "account_inactive" }, 403)
  sess.role = user.role
  const body = await req.json().catch(() => ({}))
  const action = text(body.action, 60)
  const admin = isAdmin(sess, user)

  if (action === "bootstrap") {
    const [types, users, departments, sites, pending, mine, mineCustody] = await Promise.all([
      sb.from("pd_device_types").select("*").eq("active", true).order("sort_order"),
      sb.from("users").select("emp_id,name_en,name_zh,email,role,dept,site,status,active").eq("active", true).order("emp_id"),
      sb.from("departments").select("id,key,zh,en").order("key"), sb.from("sites").select("id,key,zh,en").order("key"),
      sb.from("pd_device_assets").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
      sb.from("pd_device_transfers").select("id", { count: "exact", head: true }).eq("status", "pending").eq("to_emp_id", sess.empId),
      sb.from("pd_device_assets").select("id", { count: "exact", head: true }).eq("custodian_emp_id", sess.empId).is("custodian_confirmed_at", null),
    ])
    const error = [types, users, departments, sites, pending, mine, mineCustody].find((x: any) => x.error)?.error
    if (error) return json({ error: error.message }, 500)
    return json({ profile: { empId: sess.empId, name: displayName(user), role: sess.role, site: user.site, dept: user.dept },
      types: types.data, users: users.data, departments: departments.data, sites: sites.data,
      badges: { pendingAssets: pending.count || 0, pendingForMe: (mine.count || 0) + (mineCustody.count || 0) } })
  }

  if (action === "list") {
    const query = text(body.query, 200)
    const aliasGroups = [
      ["蘋果手機","苹果手机","iphone","apple phone"],
      ["手機","手机","phone","smartphone","mobile phone"],
      ["手錶","手表","watch","smartwatch"],
      ["耳機","耳机","earphone","earphones","earbuds","headphone","headphones"],
      ["眼鏡","眼镜","glasses","smart glasses"],
      ["喇叭","音箱","speaker","speakers"],
      ["平板","平板电脑","tablet","ipad"],
      ["筆電","笔记本","筆記型電腦","laptop","notebook"],
      ["桌機","台式机","桌上型電腦","desktop"],
      ["配件","附件","accessory","accessories"],
    ]
    const normalized = query.toLowerCase().trim()
    const group = aliasGroups.find(g => g.some(x => x.toLowerCase() === normalized)) || []
    const expanded = [...new Set([query, ...group])].filter(Boolean)
    const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 100)
    const offset = Math.max(Number(body.offset) || 0, 0)
    let ids: string[] = []; let total = 0
    if (expanded.length <= 1) {
      const { data, error } = await sb.rpc("pd_device_search", { p_query: query, p_type: text(body.typeCode, 1), p_status: text(body.status, 30), p_owner: text(body.owner, 100), p_include_retired: Boolean(body.includeRetired), p_limit: limit, p_offset: offset })
      if (error) return json({ error: error.message }, 500)
      ids = (data || []).map((x: any) => x.asset_id); total = Number(data?.[0]?.total_count || 0)
    } else {
      const all = new Map<string, number>()
      for (const q of expanded) {
        const { data } = await sb.rpc("pd_device_search", { p_query: q, p_type: text(body.typeCode, 1), p_status: text(body.status, 30), p_owner: text(body.owner, 100), p_include_retired: Boolean(body.includeRetired), p_limit: 100, p_offset: 0 })
        for (const x of data || []) all.set(x.asset_id, Math.max(all.get(x.asset_id) || 0, Number(x.score || 0)))
      }
      const ranked = [...all.entries()].sort((a,b) => b[1]-a[1]); total = ranked.length; ids = ranked.slice(offset, offset+limit).map(x => x[0])
    }
    if (!ids.length) return json({ items: [], total })
    const { data: assets, error } = await sb.from("pd_device_assets").select("*,custodian:users!pd_device_assets_custodian_emp_id_fkey(emp_id,name_en,name_zh)").in("id", ids)
    if (error) return json({ error: error.message }, 500)
    const byId = new Map((assets || []).map((a: any) => [a.id, a]))
    const items = []
    for (const id of ids) { const a = byId.get(id); if (!a) continue; items.push(presentAsset(a, sess, await signedFiles(sb, a))) }
    return json({ items, total })
  }

  if (action === "detail") {
    const id = text(body.id, 40); if (!UUID.test(id)) return json({ error: "invalid_id" }, 400)
    const { data: asset, error } = await sb.from("pd_device_assets").select("*,custodian:users!pd_device_assets_custodian_emp_id_fkey(emp_id,name_en,name_zh)").eq("id", id).maybeSingle()
    if (error || !asset) return json({ error: error?.message || "not_found" }, error ? 500 : 404)
    const [transfers, repairs, checks, auditRows] = await Promise.all([
      sb.from("pd_device_transfers").select("*").eq("asset_id", id).order("requested_at", { ascending: false }),
      sb.from("pd_device_repairs").select("*").eq("asset_id", id).order("sent_on", { ascending: false }),
      sb.from("pd_device_inventory_checks").select("*").eq("asset_id", id).order("inventory_year", { ascending: false }),
      admin ? sb.from("pd_device_audit_log").select("*").eq("asset_id", id).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    ])
    return json({ item: presentAsset(asset, sess, await signedFiles(sb, asset)), transfers: transfers.data || [], repairs: repairs.data || [], inventory: checks.data || [], audit: auditRows.data || [] })
  }

  if (action === "pending") {
    const assetQuery = admin
      ? sb.from("pd_device_assets").select("*,custodian:users!pd_device_assets_custodian_emp_id_fkey(emp_id,name_en,name_zh)").eq("approval_status","pending").order("created_at")
      : sb.from("pd_device_assets").select("*,custodian:users!pd_device_assets_custodian_emp_id_fkey(emp_id,name_en,name_zh)").or(`and(approval_status.eq.pending,created_by.eq.${sess.empId}),and(custodian_emp_id.eq.${sess.empId},custodian_confirmed_at.is.null)`).order("created_at")
    const transferQuery = sb.from("pd_device_transfers").select("*,asset:pd_device_assets(asset_code,brand,model)").eq("status","pending").or(`from_emp_id.eq.${sess.empId},to_emp_id.eq.${sess.empId},requested_by.eq.${sess.empId}`).order("requested_at")
    const [assets, transfers] = await Promise.all([assetQuery, transferQuery])
    if (assets.error || transfers.error) return json({ error: (assets.error || transfers.error).message }, 500)
    return json({ assets: (assets.data || []).map((a:any)=>presentAsset(a,sess)), transfers: transfers.data || [] })
  }

  if (action === "addType") {
    if (!admin) return json({ error: "forbidden" }, 403)
    const code=text(body.code,1).toUpperCase(),nameZh=text(body.nameZh,80),nameEn=text(body.nameEn,80)
    if(!/^[A-Z]$/.test(code)||!nameZh||!nameEn)return json({error:"invalid_type"},400)
    const{data,error}=await sb.from("pd_device_types").insert({code,name_zh:nameZh,name_en:nameEn,sort_order:Number(body.sortOrder)||100,created_by:sess.empId}).select("*").single()
    if(error)return json({error:error.message},409);return json({item:data},201)
  }

  if (action === "create") {
    const typeCode = text(body.typeCode, 1), brand = text(body.brand, 120), model = text(body.model, 200)
    const ownershipUnit = text(body.ownershipUnit, 100), custodian = text(body.custodianEmpId || sess.empId, 30)
    if (!typeCode || !brand || !model || !ownershipUnit || !custodian) return json({ error: "required_fields_missing" }, 400)
    const [{ data: type }, { data: target }] = await Promise.all([
      sb.from("pd_device_types").select("code").eq("code", typeCode).eq("active", true).maybeSingle(),
      sb.from("users").select("emp_id,name_en,name_zh,site,active,status,role").eq("emp_id", custodian).maybeSingle(),
    ])
    if (!type || !activeUser(target)) return json({ error: "invalid_type_or_custodian" }, 400)
    const { data: code, error: codeError } = await sb.rpc("pd_device_allocate_code", { p_type: typeCode })
    if (codeError) return json({ error: codeError.message }, 409)
    const missing: string[] = []
    if (!nullable(body.manufacturerSerial)) missing.push("manufacturer_serial")
    if (typeCode === "P" && !nullable(body.imei1)) missing.push("imei1")
    if (body.purchaseAmount == null) missing.push("purchase_information")
    const row = {
      asset_code: code, type_code: typeCode, original_name: nullable(body.originalName, 300), brand, model,
      official_model_code: nullable(body.officialModelCode, 120), manufacturer_serial: nullable(body.manufacturerSerial, 120),
      imei1: nullable(body.imei1, 40), imei2: nullable(body.imei2, 40), color: nullable(body.color, 80),
      specifications: safeSpec(body.specifications), aliases: safeAliases(body.aliases), missing_fields: missing,
      custodian_emp_id: custodian, custodian_original_name: displayName(target),
      custodian_confirmed_at: custodian === sess.empId ? new Date().toISOString() : null,
      ownership_unit: ownershipUnit, current_location: text(body.currentLocation || target.site, 100),
      purchase_amount: body.purchaseAmount === "" || body.purchaseAmount == null ? null : Number(body.purchaseAmount),
      purchase_currency: CURRENCIES.has(text(body.purchaseCurrency, 3)) ? text(body.purchaseCurrency, 3) : null,
      purchase_country: nullable(body.purchaseCountry, 100), purchase_vendor: nullable(body.purchaseVendor, 160),
      purchase_date: dateValue(body.purchaseDate), warranty_expires_on: dateValue(body.warrantyExpiresOn),
      source_note: nullable(body.sourceNote, 1000), created_by: sess.empId, updated_by: sess.empId,
    }
    const { data: created, error } = await sb.from("pd_device_assets").insert(row).select("*").single()
    if (error) return json({ error: error.message }, 500)
    await audit(sb, sess, "create_pending", created.id, null, created)
    await notify(sb, [custodian, ...await adminIds(sb)], displayName(user), `設備 ${created.asset_code} 待確認`, `${brand} ${model} 已建立，等待確認。`)
    const imageResult = await findOfficialImage(sb, sess, created)
    return json({ item: presentAsset(created, sess), officialImage: imageResult }, 201)
  }

  if (action === "update") {
    const id = text(body.id, 40); if (!UUID.test(id)) return json({ error: "invalid_id" }, 400)
    const { data: before } = await sb.from("pd_device_assets").select("*").eq("id", id).maybeSingle()
    if (!before) return json({ error: "not_found" }, 404)
    const daily = before.custodian_emp_id === sess.empId
    if (!admin && !daily) return json({ error: "forbidden" }, 403)
    const patch: any = { updated_by: sess.empId }
    if (daily) {
      if (STATUS.has(text(body.status, 30)) && !["lost","retired"].includes(text(body.status, 30))) patch.status = text(body.status, 30)
      if ("expectedAvailableDate" in body) patch.expected_available_date = dateValue(body.expectedAvailableDate)
      if ("conditionNote" in body) patch.condition_note = nullable(body.conditionNote, 1000)
    }
    if (admin) Object.assign(patch, {
      brand: text(body.brand ?? before.brand, 120), model: text(body.model ?? before.model, 200),
      original_name: nullable(body.originalName ?? before.original_name, 300), official_model_code: nullable(body.officialModelCode ?? before.official_model_code, 120),
      manufacturer_serial: nullable(body.manufacturerSerial ?? before.manufacturer_serial, 120), imei1: nullable(body.imei1 ?? before.imei1, 40), imei2: nullable(body.imei2 ?? before.imei2, 40),
      color: nullable(body.color ?? before.color, 80), specifications: body.specifications === undefined ? before.specifications : safeSpec(body.specifications),
      aliases: body.aliases === undefined ? before.aliases : safeAliases(body.aliases), ownership_unit: text(body.ownershipUnit ?? before.ownership_unit, 100),
      current_location: nullable(body.currentLocation ?? before.current_location, 100), purchase_amount: body.purchaseAmount === undefined ? before.purchase_amount : (body.purchaseAmount === "" ? null : Number(body.purchaseAmount)),
      purchase_currency: body.purchaseCurrency === undefined ? before.purchase_currency : (CURRENCIES.has(text(body.purchaseCurrency,3)) ? text(body.purchaseCurrency,3) : null),
      purchase_country: nullable(body.purchaseCountry ?? before.purchase_country, 100), purchase_vendor: nullable(body.purchaseVendor ?? before.purchase_vendor, 160),
      purchase_date: body.purchaseDate === undefined ? before.purchase_date : dateValue(body.purchaseDate), warranty_expires_on: body.warrantyExpiresOn === undefined ? before.warranty_expires_on : dateValue(body.warrantyExpiresOn),
    })
    if (admin && body.custodianEmpId !== undefined && text(body.custodianEmpId,30) !== (before.custodian_emp_id || "")) {
      const nextId=text(body.custodianEmpId,30);const{data:next}=await sb.from("users").select("emp_id,name_en,name_zh,site,active,status,role").eq("emp_id",nextId).maybeSingle()
      if(!activeUser(next))return json({error:"invalid_custodian"},400)
      patch.custodian_emp_id=nextId;patch.custodian_original_name=displayName(next);patch.custodian_confirmed_at=nextId===sess.empId?new Date().toISOString():null
      if(!patch.current_location)patch.current_location=next.site
    }
    const { data: after, error } = await sb.from("pd_device_assets").update(patch).eq("id", id).select("*").single()
    if (error) return json({ error: error.message }, 500)
    await audit(sb, sess, "update", id, before, after)
    return json({ item: presentAsset(after, sess) })
  }

  if (action === "approve") {
    if (!admin) return json({ error: "forbidden" }, 403)
    const id = text(body.id, 40); const { data: before } = await sb.from("pd_device_assets").select("*").eq("id", id).maybeSingle()
    if (!before || before.approval_status !== "pending") return json({ error: "invalid_state" }, 409)
    const patch = { approval_status: "approved", approved_at: new Date().toISOString(), approved_by: sess.empId,
      activated_at: before.custodian_emp_id && before.custodian_confirmed_at ? new Date().toISOString() : null, updated_by: sess.empId }
    const { data: after, error } = await sb.from("pd_device_assets").update(patch).eq("id", id).select("*").single()
    if (error) return json({ error: error.message }, 500)
    await audit(sb, sess, "approve", id, before, after)
    await notify(sb, [before.created_by, before.custodian_emp_id], displayName(user), `設備 ${before.asset_code} 已核准`, `${before.brand} ${before.model} 已可使用。`)
    return json({ ok: true })
  }

  if (action === "confirmInitialCustody") {
    const id=text(body.id,40);const{data:before}=await sb.from("pd_device_assets").select("*").eq("id",id).maybeSingle()
    if(!before || before.custodian_emp_id!==sess.empId || before.custodian_confirmed_at)return json({error:"invalid_state_or_actor"},409)
    const patch={custodian_confirmed_at:new Date().toISOString(),activated_at:before.approval_status==="approved"?new Date().toISOString():before.activated_at,updated_by:sess.empId}
    const{data:after,error}=await sb.from("pd_device_assets").update(patch).eq("id",id).select("*").single();if(error)return json({error:error.message},500)
    await audit(sb,sess,"initial_custody_confirmed",id,before,after);await notify(sb,await adminIds(sb),displayName(user),`設備 ${before.asset_code} 已確認保管`,`目前保管人已確認收到設備。`);return json({ok:true})
  }

  if (action === "requestTransfer") {
    const id = text(body.assetId, 40), toEmp = text(body.toEmpId, 30), transferType = text(body.transferType, 20), purpose = text(body.purpose, 30)
    const { data: asset } = await sb.from("pd_device_assets").select("*").eq("id", id).maybeSingle()
    const { data: target } = await sb.from("users").select("*").eq("emp_id", toEmp).maybeSingle()
    if (!asset || asset.approval_status !== "approved" || !asset.activated_at || !activeUser(target)) return json({ error: "invalid_asset_or_recipient" }, 400)
    if (!admin && asset.custodian_emp_id !== sess.empId && toEmp !== sess.empId) return json({ error: "forbidden" }, 403)
    if (!new Set(["temporary","permanent"]).has(transferType) || !PURPOSES.has(purpose) || purpose === "return") return json({ error: "invalid_transfer" }, 400)
    const startsOn = transferType === "temporary" ? dateValue(body.startsOn) : null, dueOn = transferType === "temporary" ? dateValue(body.dueOn) : null
    if (transferType === "temporary" && (!startsOn || !dueOn || startsOn > dueOn)) return json({ error: "invalid_dates" }, 400)
    if (purpose === "other" && !nullable(body.purposeNote, 500)) return json({ error: "purpose_note_required" }, 400)
    let conflict = false
    if (startsOn && dueOn) {
      const { data } = await sb.from("pd_device_transfers").select("id").eq("asset_id", id).in("status", ["pending","accepted","awaiting_return"]).lte("starts_on", dueOn).gte("due_on", startsOn).limit(1)
      conflict = Boolean(data?.length)
    }
    const row = { asset_id: id, transfer_type: transferType, purpose, purpose_note: nullable(body.purposeNote,500), project_ref: nullable(body.projectRef,200), from_emp_id: asset.custodian_emp_id, to_emp_id: toEmp, requested_by: sess.empId, starts_on: startsOn, due_on: dueOn, conflict_detected: conflict,
      from_approved_at: sess.empId === asset.custodian_emp_id ? new Date().toISOString() : null,
      to_approved_at: null }
    const { data: transfer, error } = await sb.from("pd_device_transfers").insert(row).select("*").single()
    if (error) return json({ error: error.message }, 500)
    await audit(sb, sess, "transfer_requested", id, null, transfer, undefined, transfer.id)
    await notify(sb, [asset.custodian_emp_id, toEmp], displayName(user), `設備 ${asset.asset_code} 移轉待確認`, `${displayName(user)} 提出${transferType === "temporary" ? "借用" : "永久移轉"}申請。`)
    return json({ item: transfer }, 201)
  }

  if (action === "respondTransfer") {
    const id = text(body.id, 40), accept = Boolean(body.accept), condition = text(body.condition, 30)
    const { data: transfer } = await sb.from("pd_device_transfers").select("*").eq("id", id).maybeSingle()
    const isFrom = transfer?.from_emp_id === sess.empId, isTo = transfer?.to_emp_id === sess.empId
    if (!transfer || transfer.status !== "pending" || (!isFrom && !isTo)) return json({ error: "invalid_state_or_actor" }, 409)
    if (!accept && !nullable(body.rejectionReason,500)) return json({ error: "rejection_reason_required" }, 400)
    if (accept && isTo && !CONDITIONS.has(condition)) return json({ error: "condition_required" }, 400)
    const fromApproved = Boolean(transfer.from_approved_at) || (accept && isFrom)
    const toApproved = Boolean(transfer.to_approved_at) || (accept && isTo)
    const bothApproved = fromApproved && toApproved
    const patch: any = accept ? { status: bothApproved ? (transfer.transfer_type === "temporary" ? "accepted" : "completed") : "pending",
      from_approved_at: fromApproved ? (transfer.from_approved_at || new Date().toISOString()) : null,
      to_approved_at: toApproved ? (transfer.to_approved_at || new Date().toISOString()) : null,
      receiver_condition: isTo ? condition : transfer.receiver_condition, condition_note: isTo ? nullable(body.conditionNote,1000) : transfer.condition_note, responded_at: new Date().toISOString() }
      : { status: "rejected", rejection_reason: text(body.rejectionReason,500), responded_at: new Date().toISOString() }
    if (accept && bothApproved && transfer.transfer_type !== "temporary") patch.completed_at = new Date().toISOString()
    const { data: after, error } = await sb.from("pd_device_transfers").update(patch).eq("id", id).select("*").single()
    if (error) return json({ error: error.message }, 500)
    if (accept && bothApproved) {
      const assetPatch: any = { custodian_emp_id: transfer.to_emp_id, custodian_original_name: displayName(user), custodian_confirmed_at: new Date().toISOString(), status: condition === "damaged" ? "maintenance" : "in_use", updated_by: sess.empId }
      await sb.from("pd_device_assets").update(assetPatch).eq("id", transfer.asset_id)
      if (transfer.transfer_type === "return" && transfer.purpose_note?.startsWith("Return for ")) {
        await sb.from("pd_device_transfers").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", transfer.purpose_note.slice(11))
      }
    }
    await audit(sb, sess, accept ? "transfer_accepted" : "transfer_rejected", transfer.asset_id, transfer, after, patch.rejection_reason, id)
    await notify(sb, [transfer.requested_by, transfer.from_emp_id, transfer.to_emp_id], displayName(user), accept ? (bothApproved ? "設備移轉已完成確認" : "設備移轉已有一方確認") : "設備移轉已拒絕", accept ? (bothApproved ? "雙方已完成確認。" : "仍等待另一方確認。") : patch.rejection_reason)
    return json({ ok: true })
  }

  if (action === "cancelTransfer") {
    const id = text(body.id, 40); const { data: transfer } = await sb.from("pd_device_transfers").select("*").eq("id", id).maybeSingle()
    if (!transfer || transfer.status !== "pending" || (transfer.requested_by !== sess.empId && !admin)) return json({ error: "invalid_state_or_actor" }, 409)
    const { error } = await sb.from("pd_device_transfers").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id)
    if (error) return json({ error: error.message }, 500)
    await audit(sb, sess, "transfer_cancelled", transfer.asset_id, transfer, { status: "cancelled" }, undefined, id)
    return json({ ok: true })
  }

  if (action === "forceTransferApproval") {
    if (!admin) return json({ error: "forbidden" }, 403)
    const id = text(body.id, 40), reason = text(body.reason, 1000)
    if (!reason) return json({ error: "reason_required" }, 400)
    const { data: transfer } = await sb.from("pd_device_transfers").select("*").eq("id", id).maybeSingle()
    if (!transfer || transfer.status !== "pending") return json({ error: "invalid_state" }, 409)
    const { error: approvalError } = await sb.from("pd_device_forced_transfer_approvals").insert({ transfer_id: id, admin_emp_id: sess.empId, reason })
    if (approvalError) return json({ error: approvalError.code === "23505" ? "same_admin_cannot_approve_twice" : approvalError.message }, 409)
    const { data: approvals } = await sb.from("pd_device_forced_transfer_approvals").select("admin_emp_id,reason,created_at").eq("transfer_id", id)
    await audit(sb, sess, "forced_transfer_approval", transfer.asset_id, null, { approvals }, reason, id)
    if ((approvals || []).length < 2) return json({ ok: true, approvals: approvals?.length || 1, required: 2 })
    const { data: target } = await sb.from("users").select("emp_id,name_en,name_zh").eq("emp_id", transfer.to_emp_id).maybeSingle()
    const after = { status: transfer.transfer_type === "temporary" ? "accepted" : "completed", from_approved_at: new Date().toISOString(), to_approved_at: new Date().toISOString(), completed_at: transfer.transfer_type === "temporary" ? null : new Date().toISOString() }
    const { error } = await sb.from("pd_device_transfers").update(after).eq("id", id)
    if (error) return json({ error: error.message }, 500)
    await sb.from("pd_device_assets").update({ custodian_emp_id: transfer.to_emp_id, custodian_original_name: displayName(target), custodian_confirmed_at: new Date().toISOString(), status: "in_use", updated_by: sess.empId }).eq("id", transfer.asset_id)
    await audit(sb, sess, "forced_transfer_completed", transfer.asset_id, transfer, after, reason, id)
    await notify(sb, [transfer.from_emp_id, transfer.to_emp_id, transfer.requested_by], displayName(user), "設備已由兩名管理員核准移轉", reason)
    return json({ ok: true, approvals: 2, completed: true })
  }

  if (action === "requestReturn") {
    const transferId = text(body.transferId, 40); const { data: transfer } = await sb.from("pd_device_transfers").select("*").eq("id", transferId).maybeSingle()
    if (!transfer || transfer.transfer_type !== "temporary" || transfer.status !== "accepted" || transfer.to_emp_id !== sess.empId) return json({ error: "invalid_state_or_actor" }, 409)
    const { data: row, error } = await sb.from("pd_device_transfers").insert({ asset_id: transfer.asset_id, transfer_type: "return", purpose: "return", from_emp_id: sess.empId, to_emp_id: transfer.from_emp_id, requested_by: sess.empId, status: "pending", purpose_note: `Return for ${transfer.id}`, from_approved_at: new Date().toISOString() }).select("*").single()
    if (error) return json({ error: error.message }, 500)
    await sb.from("pd_device_transfers").update({ status: "awaiting_return" }).eq("id", transferId)
    await audit(sb, sess, "return_requested", transfer.asset_id, transfer, row, undefined, row.id)
    await notify(sb, [transfer.from_emp_id], displayName(user), "設備歸還待確認", "借用人已提出歸還，請確認實際收到與設備狀況。")
    return json({ item: row }, 201)
  }

  if (action === "addRepair") {
    const assetId = text(body.assetId,40), sentOn = dateValue(body.sentOn), reason = text(body.reason,1000)
    const { data: asset } = await sb.from("pd_device_assets").select("*").eq("id",assetId).maybeSingle()
    if (!asset || (!admin && asset.custodian_emp_id !== sess.empId) || !sentOn || !reason) return json({ error: "invalid_repair" },400)
    const currency = CURRENCIES.has(text(body.currency,3)) ? text(body.currency,3) : null
    const row = { asset_id:assetId,sent_on:sentOn,reason,vendor:nullable(body.vendor,160),currency,cost:body.cost==null||body.cost===""?null:Number(body.cost),returned_on:dateValue(body.returnedOn),result:nullable(body.result,1000),created_by:sess.empId }
    const { data: repair,error }=await sb.from("pd_device_repairs").insert(row).select("*").single(); if(error)return json({error:error.message},500)
    await sb.from("pd_device_assets").update({status:row.returned_on?"available":"maintenance",updated_by:sess.empId}).eq("id",assetId)
    await audit(sb,sess,"repair_recorded",assetId,null,repair); return json({item:repair},201)
  }

  if (action === "markLost" || action === "retire" || action === "restore") {
    const id=text(body.id,40); const {data:before}=await sb.from("pd_device_assets").select("*").eq("id",id).maybeSingle()
    if(!before || !admin)return json({error:"forbidden_or_not_found"},403)
    let patch:any={updated_by:sess.empId}; let act=action
    if(action==="markLost"){
      const d=dateValue(body.date),reason=text(body.reason,500),note=text(body.note,1000); if(!d||!reason||!note)return json({error:"lost_fields_required"},400)
      patch={...patch,status:"lost",lost_at:d,lost_reason:reason,lost_note:note}
    } else if(action==="retire"){
      const d=dateValue(body.date),reason=text(body.reason,30),note=text(body.note,1000); if(!d||!["scrapped","sold","donated","irreparable","other"].includes(reason)||!note)return json({error:"retirement_fields_required"},400)
      patch={...patch,status:"retired",retired_at:d,retirement_reason:reason,retirement_note:note}
    } else patch={...patch,status:"available",lost_at:null,lost_reason:null,lost_note:null,retired_at:null,retirement_reason:null,retirement_note:null}
    const {data:after,error}=await sb.from("pd_device_assets").update(patch).eq("id",id).select("*").single(); if(error)return json({error:error.message},500)
    await audit(sb,sess,act,id,before,after,text(body.note,1000)); return json({ok:true})
  }

  if (action === "inventoryConfirm") {
    const assetId=text(body.assetId,40),year=Number(body.year),result=text(body.result,20)
    const {data:asset}=await sb.from("pd_device_assets").select("*").eq("id",assetId).maybeSingle()
    if(!asset || asset.custodian_emp_id!==sess.empId || !Number.isInteger(year) || !["held","abnormal","missing"].includes(result))return json({error:"invalid_inventory"},400)
    const row={asset_id:assetId,inventory_year:year,result,note:nullable(body.note,1000),confirmed_by:sess.empId,confirmed_at:new Date().toISOString()}
    const {data:check,error}=await sb.from("pd_device_inventory_checks").upsert(row,{onConflict:"asset_id,inventory_year"}).select("*").single();if(error)return json({error:error.message},500)
    if(result==="missing")await sb.from("pd_device_assets").update({status:"lost",lost_at:new Date().toISOString().slice(0,10),lost_reason:"inventory_missing",lost_note:row.note,updated_by:sess.empId}).eq("id",assetId)
    await audit(sb,sess,"inventory_confirmed",assetId,null,check);return json({item:check})
  }

  if (action === "uploadFile") {
    const assetId=text(body.assetId,40),kind=text(body.kind,20),name=text(body.name,160),mime=text(body.mime,80),base64=String(body.base64||"")
    const {data:asset}=await sb.from("pd_device_assets").select("*").eq("id",assetId).maybeSingle()
    if(!asset || (!admin && asset.created_by!==sess.empId && asset.custodian_emp_id!==sess.empId) || !["image","receipt","condition"].includes(kind))return json({error:"forbidden"},403)
    if(!/^image\/(jpeg|png|webp)$/.test(mime) && !(kind==="receipt"&&mime==="application/pdf"))return json({error:"unsupported_file"},400)
    let bytes:Uint8Array;try{const bin=atob(base64);bytes=Uint8Array.from(bin,c=>c.charCodeAt(0))}catch{return json({error:"invalid_file"},400)}
    if(bytes.length>8*1024*1024)return json({error:"file_too_large"},413)
    const ext=name.split(".").pop()?.replace(/[^a-z0-9]/gi,"").toLowerCase() || (mime.includes("png")?"png":mime.includes("pdf")?"pdf":"jpg")
    const path=`${kind}s/${assetId}/${crypto.randomUUID()}.${ext}`;const{error}=await sb.storage.from("pd-device-files").upload(path,bytes,{contentType:mime,upsert:false});if(error)return json({error:error.message},500)
    const field=kind==="receipt"?"receipt_storage_path":"image_storage_path";const old=asset[field]
    if(old)await sb.storage.from("pd-device-files").remove([old])
    const patch:any={[field]:path,updated_by:sess.empId};if(kind==="image")Object.assign(patch,{image_source_url:null,image_source_name:"使用者上傳",image_retrieved_at:new Date().toISOString()})
    const{error:updateError}=await sb.from("pd_device_assets").update(patch).eq("id",assetId);if(updateError)return json({error:updateError.message},500)
    await audit(sb,sess,`${kind}_uploaded`,assetId,{[field]:old},patch);return json({ok:true})
  }

  if (action === "findOfficialImage") {
    const id=text(body.id,40);const{data:asset}=await sb.from("pd_device_assets").select("*").eq("id",id).maybeSingle()
    if(!asset || (!admin && asset.created_by!==sess.empId))return json({error:"forbidden"},403)
    return json(await findOfficialImage(sb,sess,asset))
  }

  if (action === "findMissingImages") {
    if(!admin)return json({error:"forbidden"},403)
    const limit=Math.min(Math.max(Number(body.limit)||3,1),5)
    const{data,error}=await sb.from("pd_device_assets").select("*").is("image_storage_path",null).not("brand","is",null).not("model","is",null).order("asset_code").limit(limit)
    if(error)return json({error:error.message},500)
    const results=[];for(const asset of data||[])results.push({assetCode:asset.asset_code,...await findOfficialImage(sb,sess,asset)})
    return json({items:results})
  }

  if (action === "deletePending") {
    const id=text(body.id,40);const{data:asset}=await sb.from("pd_device_assets").select("*").eq("id",id).maybeSingle()
    if(!asset || !admin || asset.approval_status!=="pending" || asset.activated_at)return json({error:"only_unactivated_pending_can_be_deleted"},409)
    const paths=[asset.image_storage_path,asset.receipt_storage_path].filter(Boolean);if(paths.length)await sb.storage.from("pd-device-files").remove(paths)
    const{error}=await sb.from("pd_device_assets").delete().eq("id",id);if(error)return json({error:error.message},500)
    return json({ok:true})
  }

  if (action === "adminAudit") {
    if(!admin)return json({error:"forbidden"},403)
    const{data,error}=await sb.from("pd_device_audit_log").select("*").order("created_at",{ascending:false}).limit(200);if(error)return json({error:error.message},500)
    return json({items:data||[]})
  }

  return json({ error: "unknown_action" }, 400)
})

async function adminIds(sb:any){const{data}=await sb.from("users").select("emp_id").eq("role","admin").eq("active",true);return(data||[]).map((u:any)=>u.emp_id)}
