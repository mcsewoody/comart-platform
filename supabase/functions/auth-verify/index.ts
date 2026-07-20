// 密碼驗證改到伺服器端：密碼雜湊（不論新舊格式）永遠不會回傳給前端，
// 徹底解決「anon key 或任何權限設定失誤都可能讓密碼雜湊外洩」的問題根源
// （2026-07-08 資安事件：舊架構讓前端直接讀 pwd_hash 自行比對）。
//
// 同時簽發簽章 session（HMAC，密鑰只存在 Supabase Secrets），讓後續其他
// function（如 KMS 機密文件存取）能真正驗證「這個人的角色是不是真的」，
// 而不是像過去單純相信前端宣稱的 role 欄位。
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { signSession, verifySession, verifyPassword, hashPassword } from "../_shared/session.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token, x-session",
}

const LEGACY_SALT = "::COMART-QS-2024" // 對照前端 PWD_SALT，僅用於驗證舊格式雜湊
// 過渡旗標：true = adminSetPassword 仍接受舊固定權杖（部署新前端期間），
// 前端上線後改 false 再部署（固定權杖前端可見，形同無防護，2026-07-20 廢除）
const GRACE = false
const LEGACY_ADMIN_TOKEN = "COMART-ADMIN-2026"
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8h，比照前端既有 SESSION_TTL

const USER_FIELDS =
  "id,emp_id,name_en,name_zh,role,dept,site,email,mobile,ext,title_en,title_zh,active,must_change_pwd"

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const SUPABASE_URL = Deno.env.get("SB_URL") || ""
    const SERVICE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") || ""
    if (!SERVICE_KEY) return json({ ok: false, reason: "server_misconfigured" }, 500)
    const sb = createClient(SUPABASE_URL, SERVICE_KEY)

    const body = await req.json().catch(() => ({}))
    const action = body.action

    // ── 登入：驗證帳密，回傳使用者資料（不含雜湊）+ 簽章 session ──
    if (action === "login") {
      const empId = String(body.empId || "").trim().toUpperCase()
      const password = String(body.password || "")
      if (!empId || !password) return json({ ok: false, reason: "bad_request" }, 400)

      const { data: rows, error } = await sb.from("users").select(USER_FIELDS + ",pwd_hash").eq("emp_id", empId).limit(1)
      if (error) return json({ ok: false, reason: "server_error" }, 500)
      const row = rows?.[0]
      if (!row) return json({ ok: false, reason: "not_found" })
      // role='inactive' 與 active=false 一視同仁擋登入（歷史資料兩種標法並存）
      if (row.active === false || String(row.role || "") === "inactive") return json({ ok: false, reason: "inactive" })

      const valid = await verifyPassword(password, row.pwd_hash || "", LEGACY_SALT)
      if (!valid) return json({ ok: false, reason: "bad_password" })

      const { pwd_hash: _drop, ...profile } = row
      const exp = Date.now() + SESSION_TTL_MS
      const session = await signSession({ empId: row.emp_id, role: row.role, site: row.site, exp })

      return json({ ok: true, user: profile, mustChangePwd: !!row.must_change_pwd, session, exp })
    }

    // ── 使用者自行改密碼：需先驗證目前密碼，證明是本人 ──
    if (action === "setPassword") {
      const empId = String(body.empId || "").trim().toUpperCase()
      const currentPassword = String(body.currentPassword || "")
      const newPassword = String(body.newPassword || "")
      if (!empId || !currentPassword || !newPassword) return json({ ok: false, reason: "bad_request" }, 400)
      if (newPassword.length < 8) return json({ ok: false, reason: "password_too_short" }, 400)

      const { data: rows, error } = await sb.from("users").select("emp_id,pwd_hash,active").eq("emp_id", empId).limit(1)
      if (error) return json({ ok: false, reason: "server_error" }, 500)
      const row = rows?.[0]
      if (!row || row.active === false) return json({ ok: false, reason: "not_found" })

      const valid = await verifyPassword(currentPassword, row.pwd_hash || "", LEGACY_SALT)
      if (!valid) return json({ ok: false, reason: "bad_current_password" })

      const newHash = await hashPassword(newPassword)
      const { error: updErr } = await sb
        .from("users")
        .update({ pwd_hash: newHash, must_change_pwd: false, updated_at: new Date().toISOString() })
        .eq("emp_id", empId)
      if (updErr) return json({ ok: false, reason: "server_error" }, 500)

      return json({ ok: true })
    }

    // ── 管理員設定/重設他人密碼（使用者管理頁）：驗證簽章 session 的真實 admin 角色 ──
    if (action === "adminSetPassword") {
      const verified = await verifySession(String(body.session || req.headers.get("x-session") || ""))
      const legacyOk = GRACE && (req.headers.get("x-admin-token") || body.adminToken || "") === LEGACY_ADMIN_TOKEN
      if (verified?.role !== "admin" && !legacyOk) return json({ ok: false, reason: "forbidden" }, 403)

      const empId = String(body.empId || "").trim().toUpperCase()
      const newPassword = String(body.newPassword || "")
      const requireChange = body.requireChange !== false
      if (!empId || !newPassword) return json({ ok: false, reason: "bad_request" }, 400)
      if (newPassword.length < 8) return json({ ok: false, reason: "password_too_short" }, 400)

      const newHash = await hashPassword(newPassword)
      const { error: updErr } = await sb
        .from("users")
        .update({ pwd_hash: newHash, must_change_pwd: requireChange, updated_at: new Date().toISOString() })
        .eq("emp_id", empId)
      if (updErr) return json({ ok: false, reason: "server_error" }, 500)

      return json({ ok: true })
    }

    return json({ ok: false, reason: "unknown_action" }, 400)
  } catch (e) {
    return json({ ok: false, reason: "exception", message: String((e as Error)?.message || e) }, 500)
  }
})
