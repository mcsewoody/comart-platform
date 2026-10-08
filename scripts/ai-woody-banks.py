#!/usr/bin/env python3
"""把 Woody 審過的題庫匯入資料庫（題目內容不進版控：repo 公開）。

用法：
  python3 scripts/ai-woody-banks.py exam    # .local/woody/ai-woody-exam-bank.md → aw_exam_bank
  python3 scripts/ai-woody-banks.py eval    # .local/woody/ai-woody-eval-set.md  → aw_eval_items
  加 --dry 只解析、不寫入

整批取代：這次檔案裡沒有的題目會被停用（active=false），不刪除 —— 舊的考試紀錄還指向它們。
🔴 只在 Woody 審過之後才跑（題庫＝評分標準，未審的題目上線等於拿沒確認過的標準考同仁）。
"""
import json, os, re, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SB = 'https://tcvlnpgpuphdalzvmoyo.supabase.co'
FILES = {'exam': '.local/woody/ai-woody-exam-bank.md', 'eval': '.local/woody/ai-woody-eval-set.md'}


def secret_key():
    out = subprocess.run(['supabase', 'projects', 'api-keys', '--project-ref', 'tcvlnpgpuphdalzvmoyo',
                          '--reveal', '-o', 'json'], capture_output=True, text=True, check=True).stdout
    return [k['api_key'] for k in json.loads(out) if k.get('type') == 'secret' and k.get('name') == 'default'][0]


def call(method, path, key, body=None, prefer=None):
    h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    if prefer:
        h['Prefer'] = prefer
    r = urllib.request.Request(SB + '/rest/v1/' + path, method=method, headers=h,
                               data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r, timeout=60) as res:
        t = res.read()
        return json.loads(t) if t else None


def parse(md):
    """### E01 〔類別〕 之後的「**標籤：**」段落；清單項目以「- 」開頭。"""
    items = []
    for block in re.split(r'\n(?=### )', md):
        m = re.match(r'### ([A-Z]\d+)\s*〔(.+?)〕', block)
        if not m:
            continue
        it = {'id': m.group(1), 'category': m.group(2), 'fields': {}}
        cur = None
        for line in block.split('\n')[1:]:
            fm = re.match(r'\*\*(.+?)：\*\*\s*(.*)', line.strip())
            if fm:
                cur = fm.group(1)
                it['fields'][cur] = [fm.group(2).strip()] if fm.group(2).strip() else []
            elif cur and line.strip().startswith('- '):
                it['fields'][cur].append(line.strip()[2:].strip())
        items.append(it)
    return items


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else ''
    if kind not in FILES:
        sys.exit(__doc__)
    items = parse(open(os.path.join(ROOT, FILES[kind]), encoding='utf-8').read())
    if kind == 'exam':
        # 題目的大類（一、二、三…）決定抽題時的類別；用「〔〕」裡的小類當顯示，大類從 ## 標題取
        md = open(os.path.join(ROOT, FILES[kind]), encoding='utf-8').read()
        section = {}
        cur = ''
        for line in md.split('\n'):
            if line.startswith('## '):
                cur = re.sub(r'^##\s*[一二三四五六七八九十]+、', '', line).strip()
            m = re.match(r'### ([A-Z]\d+)', line)
            if m:
                section[m.group(1)] = cur
        rows = [{'id': i['id'], 'category': section.get(i['id']) or i['category'],
                 'question': ' '.join(i['fields'].get('情境題', [])).strip(),
                 'points': i['fields'].get('評分要點', []), 'minus': i['fields'].get('扣分', []),
                 'source': ' '.join(i['fields'].get('出處', [])).strip(), 'active': True} for i in items]
        bad = [r['id'] for r in rows if not r['question'] or not r['points']]
        table = 'aw_exam_bank'
    else:
        rows = [{'id': i['id'], 'category': i['category'],
                 'question': ' '.join(i['fields'].get('問題', [])).strip(),
                 'must': i['fields'].get('應該包含', []), 'must_not': i['fields'].get('不可以出現', []),
                 'active': True} for i in items]
        bad = [r['id'] for r in rows if not r['question'] or not r['must']]
        table = 'aw_eval_items'
    if bad:
        sys.exit(f'格式不完整（缺題目或要點）：{bad}')
    cats = sorted({r['category'] for r in rows})
    print(f'{table}：{len(rows)} 題、{len(cats)} 類 → {cats}')
    if '--dry' in sys.argv:
        print(json.dumps(rows[0], ensure_ascii=False, indent=1))
        return
    key = secret_key()
    call('POST', table + '?on_conflict=id', key, rows, 'resolution=merge-duplicates,return=minimal')
    keep = ','.join('"%s"' % r['id'] for r in rows)
    call('PATCH', f'{table}?id=not.in.({keep})', key, {'active': False}, 'return=minimal')
    print('已匯入')


if __name__ == '__main__':
    main()
