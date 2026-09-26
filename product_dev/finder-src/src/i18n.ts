/* ═══════════════════════════════════════════════════════════
   Finder 的 i18n

   🔴 與其他系統共用 localStorage['comart-lang']（en / zh-TW / zh-CN / vi / ja）。
      在 Portal 切語言，這裡下次載入就跟著換。

   🔴 元件要跟著重畫，所以用 useSyncExternalStore 訂閱 —— 不要把語言塞進
      React context 再到處包 Provider：這個 app 有很多非元件的呼叫點
      （lib/api.ts 丟錯誤訊息、utils 的標籤表），它們也要拿得到當下語言。
      所以真正的事實來源是這個模組的 module state，hook 只是讓元件訂閱它。

   🔴 `t()` 找不到 key 時回退繁中，再找不到才回傳 key 本身 ——
      畫面上看到 key 名稱就是漏翻的訊號（scripts/i18n-audit.py 會抓）。
   ═══════════════════════════════════════════════════════════ */
import { useSyncExternalStore } from "react";

export const LANGS = [
  ["zh-TW", "繁中"],
  ["zh-CN", "简中"],
  ["en", "EN"],
  ["vi", "VI"],
  ["ja", "日本語"],
] as const;

export type Lang = (typeof LANGS)[number][0];

const STORAGE_KEY = "comart-lang";

type Dict = Record<string, string>;

export const DICT: Record<Lang, Dict> = {
  "zh-TW": {
    nav_mfg: "自製品文件",
    nav_buy: "外購品文件",
    nav_manual_upload: "手動上傳",
    nav_tools: "文件工具",
    nav_aria: "主要導覽",
    skip_main: "跳到主要內容",
    menu_open: "開啟選單",
    menu_close: "關閉選單",
    lib_title: "文件庫",
    side_note: "一個結果代表一份原始文件。自製品與外購品完全分開搜尋。",
  },
  "zh-CN": {
    nav_mfg: "自制品文件",
    nav_buy: "外购品文件",
    nav_manual_upload: "手动上传",
    nav_tools: "文件工具",
    nav_aria: "主要导航",
    skip_main: "跳到主要内容",
    menu_open: "打开菜单",
    menu_close: "关闭菜单",
    lib_title: "文件库",
    side_note: "一个结果代表一份原始文件。自制品与外购品完全分开搜索。",
  },
  en: {
    nav_mfg: "In-house documents",
    nav_buy: "Purchased documents",
    nav_manual_upload: "Manual upload",
    nav_tools: "Document tools",
    nav_aria: "Main navigation",
    skip_main: "Skip to main content",
    menu_open: "Open menu",
    menu_close: "Close menu",
    lib_title: "Document library",
    side_note: "Each result is exactly one source document. In-house and purchased items are searched entirely separately.",
  },
  vi: {
    nav_mfg: "Tài liệu hàng tự sản xuất",
    nav_buy: "Tài liệu hàng mua ngoài",
    nav_manual_upload: "Tải lên thủ công",
    nav_tools: "Công cụ tài liệu",
    nav_aria: "Điều hướng chính",
    skip_main: "Bỏ qua đến nội dung chính",
    menu_open: "Mở menu",
    menu_close: "Đóng menu",
    lib_title: "Thư viện tài liệu",
    side_note: "Mỗi kết quả là đúng một tài liệu gốc. Hàng tự sản xuất và hàng mua ngoài được tìm riêng hoàn toàn.",
  },
  ja: {
    nav_mfg: "自社製品の文書",
    nav_buy: "外部購入品の文書",
    nav_manual_upload: "手動アップロード",
    nav_tools: "文書ツール",
    nav_aria: "メインナビゲーション",
    skip_main: "メインコンテンツへスキップ",
    menu_open: "メニューを開く",
    menu_close: "メニューを閉じる",
    lib_title: "文書ライブラリ",
    side_note: "1 件の結果が 1 つの原本に対応します。自社製品と外部購入品は完全に分けて検索します。",
  }
};

let current: Lang = "zh-TW";
const listeners = new Set<() => void>();

function isLang(v: string): v is Lang {
  return LANGS.some(([code]) => code === v);
}

/** 沒設定過語言時依所屬中心猜一次（同 board 的 bInitLang）。 */
export function initLang(site?: string) {
  let stored = "";
  try {
    stored = localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    /* Safari 封鎖儲存時 getItem 會 throw，不可中斷啟動 */
  }
  if (isLang(stored)) current = stored;
  else current = ({ TW: "zh-TW", CN: "zh-CN", VN: "vi" } as Record<string, Lang>)[site ?? ""] ?? "zh-TW";
  document.documentElement.lang = current;
}

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  if (next === current || !isLang(next)) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 同上 */
  }
  // 越南文要靠這個屬性才換得到有越南文字集的字型（styles.css 的 html[lang="vi"]）
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

export function subscribeLang(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function t(key: string, params?: Record<string, string | number>) {
  let value = DICT[current][key] ?? DICT["zh-TW"][key] ?? key;
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.split(`{${name}}`).join(String(replacement));
    }
  }
  return value;
}

/** 元件用：語言一換就重畫。回傳的就是上面的 t()。 */
export function useT() {
  useSyncExternalStore(subscribeLang, getLang, getLang);
  return t;
}
