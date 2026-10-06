// AI Woody：system prompt 的組裝（純函式，node --test 可測）。
//
// 組成 ＝ 人格正文（ai_personas 'woody-core'，Woody 審閱過，按鈕不會動它）
//      ＋ 附錄一：Woody 本人在週報裡寫過的全部文字（從 woody_reports 即時撈）
//      ＋ 附錄二：AI Woody 資料夾的「必讀資料」「好文分享」全文（'woody-docs'）
//
// 🔴 組裝邏輯只有這一份。按鈕（瀏覽器）與 scripts/ai-woody-push.py（本機）都只負責
//    「把文件抽成文字送過來」，組裝一律在 edge function 做 —— 兩邊各寫一份必然分岔。

// 段落開頭像「振慈：」「Kayla:」「李立的心得思考：」「芳杏分享：」→ 同仁寫的。
// 🔴 一定要有冒號：「本週怡芳的分享，是我上週就想…」是 Woody 自己的引言，不是同仁的。
const STAFF = /^(?:本週|本周)?([一-鿿A-Za-z][一-鿿A-Za-z&、．·\s]{0,10}?)(?:的)?(?:分享|心得思考|心得反饋|心得|週報|周報|情報分享)?\s*[：:]/;
const NOT_NAMES = new Set(["原文", "摘錄", "摘自", "全文", "文章出處", "延伸閱讀", "注意", "舉例", "Ps", "ps", "PS", "結論",
  "問", "答", "重點", "公式", "心得", "說明", "例", "註", "備註", "補充", "提醒", "來源", "出處",
  "學習工具一", "The Last", "Ex", "實例", "方法", "請重讀", "同場加碼", "同場加映", "交代事項", "迎接",
  "一", "二", "三", "四", "五", "Q", "A", "Woody", "woody", "心得思考", "視野情報", "團隊回饋", "核心觀點",
  "客戶", "摘錄重點", "管理心得", "總結", "小結", "Henry 週報"]);
const WOODY_MARK = /^(→|=>|ð|-->|Woody\s*[:：→])/;

export function isStaff(p) {
  const m = STAFF.exec(p);
  if (!m || p.startsWith("http")) return false;
  const name = m[1].trim();
  if (NOT_NAMES.has(name) || /^(Q|A)\d/.test(name) || /^\d/.test(name)) return false;
  return name.length <= 10;
}

export function tagParagraphs(text) {
  const out = [];
  let staff = false;
  for (const para of String(text).trim().split(/\n\s*\n/)) {
    let p = para.trim();
    if (!p) continue;
    if (WOODY_MARK.test(p)) {
      staff = false;
      p = p.replace(/^(ð|=>)\s*/, "→ ");
    } else if (isStaff(p)) {
      staff = true;
    }
    out.push((staff ? "〔同仁分享〕" : "") + p);
  }
  return out.join("\n\n");
}

export function woodyComments(r) {
  const cs = [];
  for (const k of ["intel", "feedback"]) {
    for (const ln of String(r[k] || "").split("\n")) {
      const m = /^(→|=>|ð|Woody\s*[:：])\s*(.+)/.exec(ln.trim());
      if (m && m[2].length >= 4) cs.push(m[2].trim());
    }
  }
  return cs;
}

export function buildReportsAppendix(rows) {
  const parts = [
    "# 附錄一：Woody 本人在週報裡寫過的文字" + (rows.length ? `（${rows[0].report_date} ～ ${rows[rows.length - 1].report_date}）` : ""),
    "以下依日期排列，是引用時的原文依據。標示〔同仁分享〕的段落是同仁寫的，不是 Woody 的話；" +
      "可以說「某某分享過……」，但不可當成 Woody 的觀點，也不可評價該同仁。" +
      "「對同仁的回應」是 Woody 對同仁週報的簡短回覆。",
    "",
  ];
  for (const r of rows) {
    const refl = String(r.reflections || "").trim();
    const other = String(r.other || "").trim();
    const cs = woodyComments(r);
    if (!(refl || other || cs.length)) continue;
    parts.push("## " + r.report_date);
    if (r.work) parts.push("本週工作：" + String(r.work).replace(/\n/g, "／"));
    if (r.plan) parts.push("下週計畫：" + String(r.plan).replace(/\n/g, "／"));
    if (other) parts.push("開場與交代：\n" + other);
    if (refl) parts.push("心得思考：\n" + tagParagraphs(refl));
    if (cs.length) parts.push("對同仁的回應：\n" + cs.map((c) => "・" + c).join("\n"));
    parts.push("");
  }
  return parts.join("\n");
}

export const DOC_FOLDERS = ["必讀資料", "好文分享"];
export const MAX_DOC_CHARS = 200000;      // 單份上限（超過截斷並註明）
export const MAX_DOCS_TOTAL = 800000;     // 全部文件上限

// docs：[{ folder, name, text }]。只收兩個子資料夾的檔案；順序固定（資料夾、檔名），
// 同樣的輸入永遠組出同樣的文字 —— 那是 prompt 快取命中的前提。
export function normalizeDocs(docs) {
  if (!Array.isArray(docs)) return { error: "docs_required" };
  const out = [];
  let total = 0;
  for (const d of docs) {
    if (!d || typeof d !== "object") return { error: "bad_doc" };
    const folder = String(d.folder || "");
    const name = String(d.name || "").slice(0, 200);
    let text = String(d.text || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!DOC_FOLDERS.includes(folder) || !name || !text) continue;
    if (text.length > MAX_DOC_CHARS) text = text.slice(0, MAX_DOC_CHARS) + "\n（以下過長，已截斷）";
    total += text.length;
    if (total > MAX_DOCS_TOTAL) return { error: "docs_too_large" };
    out.push({ folder, name, text });
  }
  out.sort((a, b) => DOC_FOLDERS.indexOf(a.folder) - DOC_FOLDERS.indexOf(b.folder) || a.name.localeCompare(b.name, "zh-Hant"));
  return { docs: out };
}

export function buildDocsAppendix(docs) {
  if (!docs.length) return "";
  const parts = [
    "# 附錄二：Woody 指定的必讀資料與推薦文章（AI Woody 資料夾）",
    "這些是 Woody 最推崇的觀念，可以引用來回答，但要說出處與作者（例如「何飛鵬在〈權力之外的力量〉裡講過……」）。" +
      "除了 COMART Dos & Don'ts 與標明「Woody 補充」的段落之外，文章內容不是 Woody 自己的經歷或原創，不可用「我」說成 Woody 的事。",
    "",
  ];
  for (const d of docs) {
    parts.push(`## 〔${d.folder}〕${d.name}`);
    parts.push(d.text);
    parts.push("");
  }
  return parts.join("\n");
}

export function assemble(core, reportsAppendix, docsAppendix) {
  return [String(core).trim(), reportsAppendix, docsAppendix].filter(Boolean).join("\n\n---\n\n");
}

// ── 圖片文章（掃描的雜誌頁、手機截圖）──
// 文字辨識很貴（一張圖一次 Opus），所以結果存成 ai_personas 的獨立資料列 'ocr:<資料夾>/<檔名>|<大小>'，
// 下次按「更新」只辨識新放進來的圖。一張圖一列，三張並行辨識也不會互相蓋掉。
// 檔案換了內容（大小不同）就是另一個 key，會重新辨識。
export const OCR_PREFIX = "ocr:";
export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif"];
export function isImageName(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return !!m && IMAGE_EXT.includes(m[1]);
}
export function ocrKey(folder, name, size) {
  return `${folder}/${name}|${Number(size) || 0}`;
}
export function validOcrKey(key) {
  const k = String(key || "");
  if (k.length > 260) return false;
  const m = k.match(/^(.+?)\/(.+)\|(\d+)$/);
  return !!m && DOC_FOLDERS.includes(m[1]) && isImageName(m[2]);
}
// docs 裡 { folder, name, size, ocr: true }（沒有 text）的項目，用快取補上文字。
// 回傳補好的 docs、找不到快取的檔名、以及這次用到的 key（用來清掉已經不在資料夾裡的舊快取）。
export function fillOcr(docs, cache) {
  const out = [], missing = [], used = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    if (d && d.ocr === true) {
      const k = ocrKey(d.folder, d.name, d.size);
      used.push(k);
      if (cache[k]) out.push({ folder: d.folder, name: d.name, text: cache[k] });
      else missing.push(d.name);
    } else out.push(d);
  }
  return { docs: out, missing, used };
}

export const OCR_SYSTEM =
  "你是逐字抄錄員。把圖片裡的文章完整抄成文字，不摘要、不改寫、不加評論、不翻譯。\n" +
  "- 直排文字由右至左、由上而下讀；多欄版面依閱讀順序接起來。\n" +
  "- 第一段先寫三行：「標題：…」「作者：…」「出處：…」（例如刊物名稱、期數、日期；看不出來就寫「不詳」）。\n" +
  "- 之後空一行，接著是全文，保留原本的分段。頁首頁尾、頁碼、部落格網址、圖說不用抄。\n" +
  "- 看不清楚的字用「□」代替，不要猜。\n" +
  "- 圖片裡沒有文章（例如照片）就只回「（無文字）」。";
