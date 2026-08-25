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
import { namedSecretKey } from "../_shared/api-keys.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session",
}

const LEGACY_SALT = "::COMART-QS-2024" // 對照前端 PWD_SALT，僅用於驗證舊格式雜湊
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8h，比照前端既有 SESSION_TTL

const USER_FIELDS =
  "id,emp_id,name_en,name_zh,role,dept,site,email,mobile,ext,title_en,title_zh,active,status,must_change_pwd"

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } })
}


/* ─────────────────────── 密碼政策（2026-08-25，Woody 定案）───────────────────────
   由「最少 8 碼」改為「最少 10 碼 ＋ 禁用常見密碼」。
   既有密碼不迷溯：48 位已改過密碼的同事照常登入，下次自己改密碼時才套新規則。

   🔴 黑名單只存在這裡，前端刻意不放第二份。前端只做長度檢查（即時回饋），
      常見密碼一律由伺服器判斷、回 password_too_common —— 兩邊各存一份清單必然
      分岔，而分岔之後寬鬆的那一份就是實際生效的那一份。

   清單分兩類，第二類在實務上更常被選中：
     A. 公開洩漏清單裡的高頻密碼
     B. 從這個組織猜得出來的 —— 公司名、系統名、年份。comart2026 不會出現在
        任何公開清單上，但它正是有人會選的那一種。
   「同一字元重複」與「連續鍵盤序列」用規則擋：那是無限多組，列不完。 */
const COMMON_PASSWORDS = new Set([
  "password", "passw0rd", "password1", "password12", "password123", "password1234",
  "123456", "1234567", "12345678", "123456789", "1234567890",
  "qwerty", "qwertyuiop", "qwerty123", "qwerty1234", "asdfghjkl", "zxcvbnm",
  "letmein", "welcome", "welcome1", "welcome123", "admin", "administrator",
  "abc123", "abcd1234", "abcd123456", "a1b2c3d4", "iloveyou", "monkey", "dragon",
  "sunshine", "princess", "football", "baseball", "superman", "trustno1",
  "michael", "jennifer", "starwars", "whatever", "qazwsxedc", "1q2w3e4r",
  "1qaz2wsx", "zaq12wsx", "p@ssw0rd", "p@ssword", "pa55word", "changeme",
  "temppassword", "temp1234", "test1234", "user1234", "login123",
  // ── B：這個組織猜得出來的 ──
  "comart", "comart123", "comart1234", "comart2025", "comart2026", "comart@2026",
  "comartplatform", "comartadmin", "quotation", "quotation123",
  "taiwan123", "dongguan123", "vietnam123",
])

const SEQ_SOURCES = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop", "asdfghjkl", "zxcvbnm"]
function isSequential(low: string): boolean {
  for (const src of SEQ_SOURCES) {
    if (src.includes(low)) return true
    if (src.split("").reverse().join("").includes(low)) return true
  }
  return false
}

/* 回傳不合格的理由，合格回 null。
   empId 一併檢查：拿自己的工號當密碼是實務上最常見的一種，而它不在任何公開清單裡。 */
function passwordProblem(pw: string, empId: string): string | null {
  if (pw.length < 10) return "password_too_short"
  const low = pw.toLowerCase()
  if (COMMON_PASSWORDS.has(low)) return "password_too_common"
  if (new Set(low).size === 1) return "password_too_common"
  if (isSequential(low)) return "password_too_common"
  const id = String(empId || "").toLowerCase()
  if (id && low.includes(id)) return "password_too_common"
  // 常見密碼後面接數字或符號仍是常見密碼（password2026、qwerty!!）
  const letters = low.replace(/[^a-z]/g, "")
  if (letters.length >= 5 && COMMON_PASSWORDS.has(letters)) return "password_too_common"
  return null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const SUPABASE_URL = Deno.env.get("SB_URL") || ""
    const SERVICE_KEY = namedSecretKey("kms_edge")
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
      // 離職與停用都擋登入，但回不同的 reason —— 前端要能對當事人講清楚是哪一種
      // （status 是新的事實來源；active=false 與舊資料的 role='inactive' 仍一併擋，向下相容）
      if (String(row.status || "") === "resigned") return json({ ok: false, reason: "resigned" })
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
      { const bad = passwordProblem(newPassword, empId); if (bad) return json({ ok: false, reason: bad }, 400) }

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
      if (verified?.role !== "admin") return json({ ok: false, reason: "forbidden" }, 403)

      const empId = String(body.empId || "").trim().toUpperCase()
      const newPassword = String(body.newPassword || "")
      const requireChange = body.requireChange !== false
      if (!empId || !newPassword) return json({ ok: false, reason: "bad_request" }, 400)
      { const bad = passwordProblem(newPassword, empId); if (bad) return json({ ok: false, reason: bad }, 400) }

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
