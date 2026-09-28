import { t as tr } from "../i18n";

/* 🔴 這兩個清單與 `k_*` / `m_*` 字典 key 是**動態拼出來**的關係
   （`tr(\`k_${kind}\`)`），所以字典裡那些 key 用 grep 搜不到字面引用。
   2.33 就是因此把它們當孤兒刪掉，列表整片顯示 key 名稱。
   src/i18n.test.ts 會逐一驗證這裡每個值都查得到字典 —— 往下面加值時，
   字典沒補齊測試就會紅。 */
export const KIND_KEYS = [
  "design_drawing", "bom", "cad", "image", "presentation",
  "document", "catalog", "quotation", "other",
] as const;

export const MATCH_KEYS = [
  "exact_filename", "filename", "keyword", "category", "factory",
  "supplier", "product_path", "path", "content", "cross_language", "recent",
] as const;

export const kindLabel = (kind: string) =>
  (KIND_KEYS as readonly string[]).includes(kind) ? tr(`k_${kind}`) : kind;

export const matchLabel = (reason: string) =>
  (MATCH_KEYS as readonly string[]).includes(reason) ? tr(`m_${reason}`) : tr("m_default");
