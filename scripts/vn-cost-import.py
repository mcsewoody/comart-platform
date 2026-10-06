#!/usr/bin/env python3
"""把越南廠同仁做的「越南廠報價查詢.html」裡內嵌的 DATA 匯入 vn_part_costs／vn_cost_meta。

用法：python3 scripts/vn-cost-import.py <越南廠報價查詢.html>

🔴 那份 HTML 內嵌全部料工費，絕不能進版控（已列在 .gitignore）；這支腳本本身不含任何數字。
🔴 整批取代：先 upsert 這次的全部料號，再刪掉這次沒有的料號（停產的不該留著報價）。
（第二階段會改成在報價系統上傳 ERP Excel；在那之前用這支。）
"""
import json, re, subprocess, sys, urllib.parse, urllib.request

SB = 'https://tcvlnpgpuphdalzvmoyo.supabase.co'
COLS = ['pn', 'nm', 'cat', 'lots', 'q', 'mat', 'lab', 'oh', 'pr', 'lmon', 'lmat', 'llab', 'loh', 'lpr',
        'umin', 'umax', 'cv', 'lot', 'mo']


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
    with urllib.request.urlopen(r, timeout=120) as res:
        t = res.read()
        return json.loads(t) if t else None


def main():
    html = open(sys.argv[1], encoding='utf-8').read()
    data = json.loads(re.search(r'const DATA=(\{.*?\});\n', html, re.S).group(1))
    parts, meta = data['parts'], data['meta']
    rows = [{c: p.get(c) for c in COLS} for p in parts]
    assert len({r['pn'] for r in rows}) == len(rows), 'duplicate pn'
    key = secret_key()
    for i in range(0, len(rows), 200):
        call('POST', 'vn_part_costs?on_conflict=pn', key, rows[i:i + 200], 'resolution=merge-duplicates,return=minimal')
    have = {r['pn'] for r in call('GET', 'vn_part_costs?select=pn&limit=100000', key)}
    gone = sorted(have - {r['pn'] for r in rows})
    for i in range(0, len(gone), 100):
        q = ','.join('"%s"' % g.replace('"', '') for g in gone[i:i + 100])
        call('DELETE', 'vn_part_costs?pn=in.(' + urllib.parse.quote(q) + ')', key)
    call('POST', 'vn_cost_meta', key, {'id': 'current', 'meta': meta, 'source': sys.argv[1].split('/')[-1]},
         'resolution=merge-duplicates,return=minimal')
    print(f"匯入 {len(rows)} 個料號（{meta.get('firstmon')}～{meta.get('lastmon')}），移除 {len(gone)} 個舊料號")


if __name__ == '__main__':
    main()
