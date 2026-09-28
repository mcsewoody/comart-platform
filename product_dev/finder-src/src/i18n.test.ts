import { describe, expect, it } from "vitest";
import { DICT, LANGS, t } from "./i18n";
import {
  DATE_TYPES, KIND_KEYS, MATCH_KEYS, SKIP_REASONS,
  dateTypeLabel, kindOptionLabel, kindOptions, skipReasonLabel,
} from "./lib/document-labels";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { confirmationLabelKeys } from "./lib/utils";

/* ═══════════════════════════════════════════════════════════
   🔴 這支測試存在的原因：2.33 有兩個 key 是**動態組出來的** ——
        kindLabel:  tr(`k_${kind}`)
        matchLabel: tr(`m_${reason}`)
      我當時用 grep 找「用到但沒定義」的 key，regex 只比對 `t(` 沒比對 `tr(`，
      就把 k_cad / k_image / k_document 與 11 個 m_* 判成孤兒刪掉，搜尋結果的
      命中原因與文件類型整片變成 `m_keyword` 這種 key 名稱，而且上線了。

      動態組 key 靠肉眼掃描不可靠，所以改成用「標籤清單」來驗：只要有人往
      KIND_KEYS / MATCH_KEYS 加值而忘了補字典，這裡就會紅。
   ═══════════════════════════════════════════════════════════ */

const BASE = "zh-TW" as const;

describe("i18n 字典完整性", () => {
  it("五種語言的 key 完全一致", () => {
    const base = Object.keys(DICT[BASE]).sort();
    for (const [lang] of LANGS) {
      expect({ lang, keys: Object.keys(DICT[lang]).sort() }).toEqual({ lang, keys: base });
    }
  });

  it("沒有任何語言留下空字串", () => {
    for (const [lang] of LANGS) {
      const blank = Object.entries(DICT[lang]).filter(([, value]) => !value.trim());
      expect({ lang, blank }).toEqual({ lang, blank: [] });
    }
  });
});

describe("動態組出來的 key 都要有對應字典", () => {
  it("kindLabel 的 k_* 全部存在", () => {
    const missing = KIND_KEYS.filter((kind) => !(`k_${kind}` in DICT[BASE]));
    expect(missing).toEqual([]);
  });

  it("matchLabel 的 m_* 全部存在，而且回傳的不是 key 本身", () => {
    for (const reason of MATCH_KEYS) {
      const key = `m_${reason}`;
      expect(key in DICT[BASE]).toBe(true);
      expect(t(key)).not.toBe(key);
    }
    expect(t("m_default")).not.toBe("m_default");
  });

  it("狀態徽章的 cf_* 全部存在", () => {
    for (const key of Object.values(confirmationLabelKeys)) {
      expect(t(key)).not.toBe(key);
    }
  });
});

/* ═══════════════════════════════════════════════════════════
   🔴 2.36 修掉的第二次同類事故：標籤表存的是 key，呼叫端得自己記得包 `t()`。
      文件詳情頁的類型徽章與「文件類型」欄位、跳過清單匯出的 CSV 三處忘了包，
      畫面與報表就直接印出 `k_cad2`、`sk_oversized`。五種語言全錯，上線了。

      i18n.test.ts 原本只驗「key 在字典裡查得到」—— 這兩個 bug 的 key 全都
      查得到，所以測試全綠。真正的問題是**呼叫端**，不是字典。

      所以改成兩層：
        1. document-labels.ts 只導出「已經翻好的字串」，沒有東西可以忘記包
        2. 下面的來源掃描確保標籤表不會又長回各頁自己家裡
   ═══════════════════════════════════════════════════════════ */
describe("標籤 helper 回傳的是文案，不是 key", () => {
  it("kindOptionLabel / kindOptions 兩個資料庫的每個類型都翻得出來", () => {
    for (const dataset of ["mfg", "buy"] as const) {
      for (const [value, label] of kindOptions(dataset)) {
        expect({ dataset, value, label }).toEqual({ dataset, value, label: kindOptionLabel(dataset, value) });
        expect(label).not.toMatch(/^k_/);
        expect(label.trim()).not.toBe("");
      }
    }
  });

  it("字典裡沒有的類型原樣回傳，不會變成空字串", () => {
    expect(kindOptionLabel("mfg", "brand_new_kind")).toBe("brand_new_kind");
  });

  it("skipReasonLabel 六個原因都翻得出來", () => {
    for (const reason of SKIP_REASONS) {
      expect(skipReasonLabel(reason)).not.toMatch(/^sk_/);
      expect(skipReasonLabel(reason).trim()).not.toBe("");
    }
  });

  it("dateTypeLabel 六種日期型態都翻得出來，null 有預設文案", () => {
    for (const type of DATE_TYPES) {
      expect(dateTypeLabel(type)).not.toMatch(/^dt_/);
    }
    expect(dateTypeLabel(null)).not.toBe("d_unidentified");
    expect(dateTypeLabel("unknown_type")).toBe("unknown_type");
  });
});

describe("標籤表只能住在 document-labels.ts", () => {
  /* 掃真的原始碼，不靠人記得：只要有人又在頁面裡開一張「值是 i18n key」的
     對照表，就會在這裡紅掉，而不是等使用者在畫面上看到 key 名稱。*/
  /* vitest 的 cwd 是 finder-src（vite.config.ts 所在）。*/
  const SRC = join(process.cwd(), "src");

  function sourceFiles(directory: string): string[] {
    return readdirSync(join(SRC, directory), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(join(directory, entry.name))
        : /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")
          ? [join(directory, entry.name)]
          : [],
    );
  }

  it("pages / components / auth 裡沒有任何值是 i18n key 的對照表", () => {
    const offenders: Array<{ file: string; line: string }> = [];
    for (const directory of ["pages", "components", "auth"]) {
      for (const file of sourceFiles(directory)) {
        readFileSync(join(SRC, file), "utf8").split("\n").forEach((line) => {
          /* 形如 `something: "k_bom"` 或 `["cad", "k_cad2"]`：值是字典 key 的對照表。
             單純呼叫 t("k_bom") 不算，那已經翻好了。*/
          const table = line.match(/(?:[:,]\s*|\[\s*)"(k|m|sk|dt|cf)_[a-z0-9_]+"/);
          if (table && !/\bt\w*\(\s*"/.test(line)) offenders.push({ file, line: line.trim().slice(0, 120) });
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
