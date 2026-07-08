// 共用模組：密碼雜湊（PBKDF2）與簽章 session token（HMAC-SHA256）。
// 由 auth-verify 與未來需要「驗證真實角色」的 function（如 kms 機密文件讀取）共用。
// SESSION_HMAC_SECRET 只存在 Supabase Secrets（伺服器端），前端永遠拿不到，
// 這是簽章能被信任的唯一原因 —— 任何人都能偽造未簽章的 JSON，但無法偽造簽章。

const SECRET = Deno.env.get("SESSION_HMAC_SECRET") || "";

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(): Promise<CryptoKey> {
  if (!SECRET) throw new Error("SESSION_HMAC_SECRET not set");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// payload 簽章：回傳 "<base64url(JSON)>.<base64url(HMAC簽章)>"
export async function signSession(payload: Record<string, unknown>): Promise<string> {
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey();
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64urlEncode(new Uint8Array(sigBuf))}`;
}

// 驗證簽章並回傳 payload；簽章不符或已過期回傳 null（呼叫端應視為未登入/最低權限）
export async function verifySession(token: string): Promise<Record<string, any> | null> {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sigB64] = token.split(".");
  try {
    const key = await hmacKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(sigB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number, keylen = 32): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, keylen * 8);
  return new Uint8Array(bits);
}

// 新密碼一律用 PBKDF2（隨機鹽、21 萬輪），格式自描述：pbkdf2$<輪數>$<鹽>$<雜湊>
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210000;
  const hash = await pbkdf2Hash(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

// 相容舊格式（SHA-256 + 固定鹽值的原始 hex）：只用於驗證既有帳號的第一次登入，
// 一旦驗證通過會立刻在 setPassword 流程被換成 pbkdf2 格式，此分支之後會逐漸零使用。
export async function verifyPassword(password: string, stored: string, legacySalt: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const salt = b64urlDecode(parts[2]);
    const expected = b64urlDecode(parts[3]);
    const actual = await pbkdf2Hash(password, salt, iterations, expected.length);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password + legacySalt));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === stored;
}
