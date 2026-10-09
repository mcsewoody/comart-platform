// wr-translate 的純邏輯（node --test 測得到）
export const LANGS = { en: "English", vi: "Vietnamese (Tiếng Việt)", "zh-CN": "Simplified Chinese (简体中文, mainland usage)" }
export const SECTION_KEYS = ["work", "plan", "reflections", "intel", "feedback", "other"]

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
// 指紋只看「要翻的內容」，順序固定；空段落也算進去（從有變空也要重翻）
export function sourceOf(row) {
  const o = {}; for (const k of SECTION_KEYS) o[k] = String(row?.[k] || "").trim(); return o
}
export function footerSource(f) {
  const okr = Array.isArray(f?.okr) ? f.okr.map((x) => String(x).slice(0, 500)).slice(0, 20) : []
  const learn = Array.isArray(f?.learn) ? f.learn.map((x) => String(x).slice(0, 500)).slice(0, 20) : []
  const o = {}; okr.forEach((x, i) => { o["okr_" + i] = x }); learn.forEach((x, i) => { o["learn_" + i] = x }); return o
}
export function parseTag(text, tag) {
  const m = String(text || "").match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"))
  return m ? m[1].replace(/^\n+|\n+$/g, "") : null
}
