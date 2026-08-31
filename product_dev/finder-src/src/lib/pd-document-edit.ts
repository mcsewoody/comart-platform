export function parseDocumentList(value: string, limit = 30) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of value.split(/[\n,，、]+/)) {
    const item = part.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

export function documentListText(items: string[]) {
  return items.join("、");
}
