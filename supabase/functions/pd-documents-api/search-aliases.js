const ALIAS_RULES = [
  {
    pattern: /(?:\b2\s*(?:in|[-/])\s*1\b|二合一|2合1)/giu,
    values: ["2 in 1", "2-in-1", "二合一", "2合1"],
  },
  {
    pattern: /(?:\b3\s*(?:in|[-/])\s*1\b|三合一|3合1)/giu,
    values: ["3 in 1", "3-in-1", "三合一", "3合1"],
  },
  {
    pattern: /(?:\b4\s*(?:in|[-/])\s*1\b|四合一|4合1)/giu,
    values: ["4 in 1", "4-in-1", "四合一", "4合1"],
  },
  {
    pattern: /(?:\b5\s*(?:in|[-/])\s*1\b|五合一|5合1)/giu,
    values: ["5 in 1", "5-in-1", "五合一", "5合1"],
  },
  {
    pattern: /(?:\b6\s*(?:in|[-/])\s*1\b|六合一|6合1)/giu,
    values: ["6 in 1", "6-in-1", "六合一", "6合1"],
  },
  {
    pattern: /(?:\bwireless\s+charg(?:er|ing)\b|無線充電器?|无线充电器?)/giu,
    values: ["wireless charging", "wireless charger", "無線充電", "无线充电"],
  },
  {
    pattern: /(?:\b(?:apple\s+)?watch\b|智慧手錶|智能手表|手錶|手表)/giu,
    values: ["watch", "Apple Watch", "智慧手錶", "智能手表", "手錶"],
  },
  {
    pattern: /(?:\bmagsafe\b|\bmagnetic\b|磁吸)/giu,
    values: ["MagSafe", "magnetic", "磁吸"],
  },
  {
    pattern: /(?:\bphone\s+(?:holder|mount|stand)\b|手機支架|手机支架|手機架|手机架)/giu,
    values: ["phone holder", "phone mount", "手機支架", "手机支架"],
  },
  {
    pattern: /(?:\bcar\s+(?:holder|mount)\b|車用支架|车用支架|車架|车架)/giu,
    values: ["car mount", "車用支架", "车用支架", "車架"],
  },
  {
    pattern: /(?:\bring\s+holder\b|手機指環架|手机指环架|指環架|指环架)/giu,
    values: ["ring holder", "手機指環架", "手机指环架", "指環架"],
  },
  {
    pattern: /(?:\bpower\s*bank\b|行動電源|移动电源|移動電源|充電寶|充电宝)/giu,
    values: ["power bank", "行動電源", "移動電源", "移动电源", "充電寶"],
  },
  {
    pattern: /(?:\bfoldable\b|\bfolding\b|可折疊|可折叠|折疊|折叠)/giu,
    values: ["foldable", "folding", "可折疊", "可折叠", "折疊"],
  },
  {
    pattern: /(?:\bdesktop\b|\bdesk(?:top)?\s+stand\b|桌面|桌上)/giu,
    values: ["desktop", "desktop stand", "桌面", "桌上"],
  },
  {
    pattern: /(?:\bfan\b|風扇|风扇)/giu,
    values: ["fan", "風扇", "风扇"],
  },
]

function clean(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ")
}

/**
 * Expand a user's product query into a small, bounded set of common Chinese and
 * English equivalents. Original text always stays first so exact matches keep
 * their ranking advantage.
 */
export function expandSearchQueries(input, limit = 12) {
  const original = clean(String(input || ""))
  if (!original) return [""]

  let variants = [original]
  for (const rule of ALIAS_RULES) {
    const current = [...variants]
    for (const variant of current) {
      rule.pattern.lastIndex = 0
      if (!rule.pattern.test(variant)) continue
      for (const replacement of rule.values) {
        rule.pattern.lastIndex = 0
        variants.push(clean(variant.replace(rule.pattern, replacement)))
      }
    }
    variants = [...new Map(variants.map((value) => [value.toLocaleLowerCase(), value])).values()]
      .slice(0, limit)
  }
  return variants
}
