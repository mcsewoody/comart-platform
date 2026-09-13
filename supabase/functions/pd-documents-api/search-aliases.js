const LOCALES = ["zhTw", "zhCn", "en", "vi"]

const ALIAS_RULES = [
  group(/(?:\b2\s*(?:in|[-/])\s*1\b|二合一|2合1|2\s*trong\s*1)/giu,
    ["二合一", "2合1"], ["二合一", "2合1"], ["2 in 1", "2-in-1"], ["2 trong 1"]),
  group(/(?:\b3\s*(?:in|[-/])\s*1\b|三合一|3合1|3\s*trong\s*1)/giu,
    ["三合一", "3合1"], ["三合一", "3合1"], ["3 in 1", "3-in-1"], ["3 trong 1"]),
  group(/(?:\b4\s*(?:in|[-/])\s*1\b|四合一|4合1|4\s*trong\s*1)/giu,
    ["四合一", "4合1"], ["四合一", "4合1"], ["4 in 1", "4-in-1"], ["4 trong 1"]),
  group(/(?:\b5\s*(?:in|[-/])\s*1\b|五合一|5合1|5\s*trong\s*1)/giu,
    ["五合一", "5合1"], ["五合一", "5合1"], ["5 in 1", "5-in-1"], ["5 trong 1"]),
  group(/(?:\b6\s*(?:in|[-/])\s*1\b|六合一|6合1|6\s*trong\s*1)/giu,
    ["六合一", "6合1"], ["六合一", "6合1"], ["6 in 1", "6-in-1"], ["6 trong 1"]),
  group(/(?:\bwireless\s+charg(?:er|ing)\b|無線充電器?|无线充电器?|(?:bộ\s+)?sạc\s+không\s+dây|sac\s+khong\s+day)/giu,
    ["無線充電", "無線充電器"], ["无线充电", "无线充电器"], ["wireless charger", "wireless charging"], ["sạc không dây", "bộ sạc không dây", "sac khong day"]),
  group(/(?:\b(?:apple\s+)?watch\b|智慧手錶|智能手表|手錶|手表|đồng\s+hồ|dong\s+ho)/giu,
    ["手錶", "智慧手錶"], ["手表", "智能手表"], ["watch", "Apple Watch", "smartwatch"], ["đồng hồ", "đồng hồ thông minh", "dong ho"]),
  group(/(?:\bmagsafe\b|\bmagnetic\b|磁吸|nam\s+châm|hít\s+nam\s+châm|nam\s+cham)/giu,
    ["磁吸", "MagSafe"], ["磁吸", "MagSafe"], ["magnetic", "MagSafe"], ["nam châm", "hít nam châm", "nam cham"]),
  group(/(?:\bphone\s+(?:holder|mount|stand|grip)\b|手機支架|手机支架|手機架|手机架|giá\s+đỡ\s+điện\s+thoại|gia\s+do\s+dien\s+thoai)/giu,
    ["手機支架", "手機架"], ["手机支架", "手机架"], ["phone holder", "phone mount", "phone stand", "phone grip"], ["giá đỡ điện thoại", "gia do dien thoai"]),
  group(/(?:\bcar\s+(?:holder|mount)\b|車用支架|车用支架|車架|车架|giá\s+đỡ\s+ô\s*tô|gia\s+do\s+o\s*to)/giu,
    ["車用支架", "車架"], ["车用支架", "车架"], ["car mount", "car holder"], ["giá đỡ ô tô", "gia do o to"]),
  group(/(?:\bcar\s+charg(?:er|ing)\b|車用充電器?|车用充电器?|車充|车充|sạc\s+(?:ô\s*tô|xe\s+hơi)|sac\s+(?:o\s*to|xe\s*hoi))/giu,
    ["車充", "車用充電器"], ["车充", "车用充电器"], ["car charger", "car charging"], ["sạc ô tô", "sạc xe hơi", "sac o to"]),
  group(/(?:\bring\s+holder\b|手機指環架|手机指环架|指環架|指环架|vòng\s+đỡ\s+điện\s+thoại|vong\s+do\s+dien\s+thoai)/giu,
    ["手機指環架", "指環架"], ["手机指环架", "指环架"], ["ring holder", "phone ring holder"], ["vòng đỡ điện thoại", "vong do dien thoai"]),
  group(/(?:\bpower\s*bank\b|行動電源|移动电源|移動電源|充電寶|充电宝|pin\s+dự\s+phòng|pin\s+du\s+phong)/giu,
    ["行動電源", "充電寶"], ["移动电源", "充电宝"], ["power bank"], ["pin dự phòng", "pin du phong"]),
  group(/(?:\bfoldable\b|\bfolding\b|可折疊|可折叠|折疊|折叠|có\s+thể\s+gập|gập\s+gọn|co\s+the\s+gap)/giu,
    ["可折疊", "折疊"], ["可折叠", "折叠"], ["foldable", "folding"], ["có thể gập", "gập gọn", "co the gap"]),
  group(/(?:\bdesktop\b|\bdesk(?:top)?\s+stand\b|桌面|桌上|để\s+bàn|de\s+ban)/giu,
    ["桌面", "桌上"], ["桌面", "桌上"], ["desktop", "desktop stand", "desk stand"], ["để bàn", "giá đỡ để bàn", "de ban"]),
  group(/(?:\bfan\b|風扇|风扇|quạt|quat)/giu,
    ["風扇"], ["风扇"], ["fan"], ["quạt", "quat"]),
  group(/(?:\bsuction\s+cup\b|吸盤|吸盘|giác\s+hút|giac\s+hut)/giu,
    ["吸盤"], ["吸盘"], ["suction cup"], ["giác hút", "giac hut"]),
  group(/(?:\bkey\s*chain\b|鑰匙扣|钥匙扣|móc\s+khóa|moc\s+khoa)/giu,
    ["鑰匙扣"], ["钥匙扣"], ["keychain", "key chain"], ["móc khóa", "moc khoa"]),
  group(/(?:\b(?:bike|bicycle)\s+(?:holder|mount)?\b|自行車支架|自行车支架|腳踏車支架|脚踏车支架|giá\s+đỡ\s+xe\s+đạp|gia\s+do\s+xe\s+dap)/giu,
    ["自行車支架", "腳踏車支架"], ["自行车支架", "脚踏车支架"], ["bike mount", "bicycle mount"], ["giá đỡ xe đạp", "gia do xe dap"]),
  group(/(?:\bmotorcycle\s+(?:holder|mount)?\b|機車支架|机车支架|摩托車支架|摩托车支架|giá\s+đỡ\s+xe\s+máy|gia\s+do\s+xe\s+may)/giu,
    ["機車支架", "摩托車支架"], ["机车支架", "摩托车支架"], ["motorcycle mount", "motorcycle holder"], ["giá đỡ xe máy", "gia do xe may"]),
  group(/(?:\b(?:fitness|gym)\s+(?:holder|mount)?\b|健身器材支架|健身支架|giá\s+đỡ\s+tập\s+thể\s+dục|gia\s+do\s+tap\s+the\s+duc)/giu,
    ["健身器材支架", "健身支架"], ["健身器材支架", "健身支架"], ["fitness mount", "gym holder"], ["giá đỡ tập thể dục", "gia do tap the duc"]),
  group(/(?:\bear(?:phone|bud)s?\b|\bheadphones?\b|耳機|耳机|tai\s+nghe)/giu,
    ["耳機"], ["耳机"], ["earphones", "earbuds", "headphones"], ["tai nghe"]),
  group(/(?:\b(?:quotation|quote|offer)\b|報價單?|报价单?|báo\s+giá|bao\s+gia)/giu,
    ["報價單", "報價"], ["报价单", "报价"], ["quotation", "quote", "offer"], ["báo giá", "bao gia"]),
  group(/(?:\b(?:product\s+)?catalog(?:ue)?\b|產品型錄|产品型录|型錄|型录|danh\s+mục\s+sản\s+phẩm|danh\s+muc\s+san\s+pham)/giu,
    ["產品型錄", "型錄"], ["产品型录", "型录"], ["product catalog", "product catalogue", "catalog"], ["danh mục sản phẩm", "danh muc san pham"]),
  group(/(?:\bbom\b|物料清單|物料清单|材料清單|材料清单|bảng\s+kê\s+vật\s+liệu|bang\s+ke\s+vat\s+lieu)/giu,
    ["BOM", "物料清單", "材料清單"], ["BOM", "物料清单", "材料清单"], ["BOM", "bill of materials"], ["BOM", "bảng kê vật liệu", "bang ke vat lieu"]),
  group(/(?:\bdesign\s+drawing\b|設計圖|设计图|bản\s+vẽ\s+thiết\s+kế|ban\s+ve\s+thiet\s+ke)/giu,
    ["設計圖"], ["设计图"], ["design drawing"], ["bản vẽ thiết kế", "ban ve thiet ke"]),
]

const CHINESE_PAIRS = [
  "無无", "線线", "電电", "車车", "夾夹", "雙双", "桿杆", "盤盘", "摺折", "疊叠",
  "機机", "環环", "頭头", "報报", "價价", "單单", "圖图", "紙纸", "設设", "計计",
  "廠厂", "類类", "錄录", "資资", "購购", "開开", "發发", "專专", "體体", "運运",
  "動动", "錶表", "鏡镜", "鋁铝", "鎖锁", "鑰钥", "風风", "聲声", "聽听", "筆笔",
  "記记", "號号", "規规", "測测", "試试", "認认", "證证", "組组", "裝装", "數数",
  "產产", "製制", "應应", "業业", "鎮镇", "銘铭", "詳详", "頁页", "選选", "藍蓝",
  "綠绿", "銀银", "穩稳", "鋼钢", "銳锐", "鎛镈", "恆恒", "寫写", "檔档", "點点",
  "連连", "齒齿", "軸轴", "轉转", "軟软", "螢萤", "鍵键", "觸触", "顯显", "示示",
]
const TRAD_TO_SIMPLE = new Map()
const SIMPLE_TO_TRAD = new Map()
for (const pair of CHINESE_PAIRS) {
  const [traditional, simplified] = [...pair]
  TRAD_TO_SIMPLE.set(traditional, simplified)
  SIMPLE_TO_TRAD.set(simplified, traditional)
}

function group(pattern, zhTw, zhCn, en, vi) {
  return { pattern, localized: { zhTw, zhCn, en, vi } }
}

function clean(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ")
}

function convertChinese(value, mapping) {
  return [...value].map((character) => mapping.get(character) || character).join("")
}

function matches(rule, value) {
  rule.pattern.lastIndex = 0
  return rule.pattern.test(value)
}

function replace(rule, value, replacement) {
  rule.pattern.lastIndex = 0
  const contextualReplacement = /[\u3400-\u9fff]/u.test(replacement) ? replacement : ` ${replacement} `
  return clean(value.replace(rule.pattern, contextualReplacement))
}

function unique(values, limit) {
  return [...new Map(values.filter(Boolean).map((value) => [value.toLocaleLowerCase(), value])).values()]
    .slice(0, limit)
}

/**
 * Expand a product-document query into a bounded set of Traditional Chinese,
 * Simplified Chinese, English and Vietnamese equivalents. The original query
 * always stays first, and complete same-language variants are generated before
 * individual aliases so multi-term searches remain precise.
 */
export function expandSearchQueries(input, limit = 12) {
  const original = clean(String(input || ""))
  if (!original) return [""]

  const variants = [
    original,
    convertChinese(original, TRAD_TO_SIMPLE),
    convertChinese(original, SIMPLE_TO_TRAD),
  ]
  const matched = ALIAS_RULES.filter((rule) => matches(rule, original))

  for (const locale of LOCALES) {
    let translated = original
    for (const rule of matched) translated = replace(rule, translated, rule.localized[locale][0])
    variants.push(translated)
  }

  for (const rule of matched) {
    const values = LOCALES.flatMap((locale) => rule.localized[locale])
    for (const value of values) variants.push(replace(rule, original, value))
  }

  return unique(variants, limit)
}
