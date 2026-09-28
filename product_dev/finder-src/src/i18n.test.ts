import { describe, expect, it } from "vitest";
import { DICT, LANGS, t } from "./i18n";
import { KIND_KEYS, MATCH_KEYS } from "./lib/document-labels";
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
