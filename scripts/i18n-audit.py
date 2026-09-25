# 多語字典稽核：逐字典檢查，而不是全域計數。
#
#   python3 scripts/i18n-audit.py                    # Portal（index.html 的 I18N）
#   python3 scripts/i18n-audit.py board              # Board（board/index.html 的 B_I18N ＋ PL_I18N）
#   python3 scripts/i18n-audit.py quotation          # 報價系統（quotation/index.html 的 UI）
#   python3 scripts/i18n-audit.py admin              # Admin（ADMIN_I18N，key 帶引號）
#   python3 scripts/i18n-audit.py kms                # KMS（I18N，key 帶引號）
#
# 🔴 為什麼要有這支：全域計數會放過一種錯誤 —— 10 份分佈成 (0,0,0,2,3)，
#    總數對、分佈全錯。2026-09-08 的 lc_rule1_t 就是這樣：en／繁中／簡中各 0 份，
#    畫面上直接顯示 key 名稱，而我的「共 5 份」檢查通過了。
#
# 🔴 不能用 regex 找 key：字串「值」裡面也會出現 xxx:' 這種片段（英文的
#    "load failed: '"、越南語的 "i:'"），那會產生一堆誤報把真的問題蓋掉。
#    這裡改成掃描器 —— 遇到字串常值就整段跳過，只在字串外面認 key。
#
# 🔴 字典的邊界一律用大括號配對算，不要用「下一個 lang: {」或「檔案結尾」。
#    kms-i18n-audit.py 第一版就是用檔案結尾算最後一本，把 I18N 後面程式碼裡的
#    物件常值全都當成 key，噴出一堆誤報把真正的問題蓋掉。
import io, re, sys

TARGETS = {
    'portal': ('index.html',       ['I18N']),
    'board':  ('board/index.html', ['B_I18N', 'PL_I18N']),
    'quotation': ('quotation/index.html', ['UI']),
    'admin':  ('admin/index.html', ['ADMIN_I18N']),
    'kms':    ('kms/index.html', ['I18N']),
}
name = (sys.argv[1] if len(sys.argv) > 1 else 'portal').lower()
if name not in TARGETS:
    sys.exit('用法：python3 scripts/i18n-audit.py [%s]' % '|'.join(TARGETS))
path, varnames = TARGETS[name]
s = io.open(path, encoding='utf-8').read()

KEY = re.compile(r"""\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\{""")


def skip_string(t, j):
    """j 指著開頭的引號，回傳字串結束後的位置。"""
    q = t[j]; j += 1; n = len(t)
    while j < n and t[j] != q:
        j += 2 if t[j] == '\\' else 1
    return j + 1


def lang_segments(t, start):
    """start 指著 `const VAR = {` 的那個 {。回傳 {語言: 內容}，邊界由大括號配對決定。"""
    out, j, depth, n = {}, start + 1, 0, len(t)
    while j < n:
        c = t[j]
        if c in '\'"`':
            j = skip_string(t, j); continue
        if depth == 0:
            if c == '}':
                return out                      # 整個 VAR 結束
            m = KEY.match(t, j - 1) or KEY.match(t, j)
            if m and t[j - 1] in ',{\n \t' or (m and j == start + 1):
                lg = m.group(1) or m.group(2) or m.group(3)
                body = m.end()                  # 指到語言字典的 { 之後
                k, d = body, 1
                while k < n and d:
                    ch = t[k]
                    if ch in '\'"`': k = skip_string(t, k); continue
                    if ch == '{': d += 1
                    elif ch == '}': d -= 1
                    k += 1
                out[lg] = t[body:k - 1]
                j = k; continue
        j += 1
    return out


IDENT = re.compile(r"""(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_-]*))""")


def keys_of(seg):
    """掃描一本字典，回傳 {key: 出現次數}。巢狀物件整段跳過（只認最外層的 key）。"""
    out, j, n = {}, 0, len(seg)
    while j < n:
        c = seg[j]
        if c in '\'"`':
            k = skip_string(seg, j)
            m = IDENT.match(seg, j)
            after = seg[k:k + 2].lstrip()
            if m and after.startswith(':') and not after.startswith('::'):
                key = m.group(1) or m.group(2)
                if key is not None:
                    out[key] = out.get(key, 0) + 1
            j = k; continue
        if c == '{':                            # 巢狀物件（值），整段跳過
            d = 1; j += 1
            while j < n and d:
                if seg[j] in '\'"`': j = skip_string(seg, j); continue
                if seg[j] == '{': d += 1
                elif seg[j] == '}': d -= 1
                j += 1
            continue
        m = IDENT.match(seg, j)
        if m and m.group(3):
            after = seg[m.end():m.end() + 2].lstrip()
            if after.startswith(':'):
                out[m.group(3)] = out.get(m.group(3), 0) + 1
            j = m.end(); continue
        j += 1
    return out


bad, total = 0, 0
for var in varnames:
    i = s.index('const %s = {' % var)
    segs = lang_segments(s, s.index('{', i))
    assert segs, '%s 的語言字典找不到（格式改了？）' % var
    per = {n: keys_of(seg) for n, seg in segs.items()}
    allk = set().union(*(set(d) for d in per.values()))
    total += len(allk)
    for n, d in per.items():                   # ① 同一本字典裡重複定義（後者贏，前者是死的）
        dup = sorted(k for k, v in d.items() if v > 1)
        if dup:
            bad += len(dup); print('重複定義  %-8s %-6s : %s' % (var, n, ', '.join(dup)))
    for k in sorted(allk):                     # ② 缺漏（t() 會回傳 key 本身，畫面上直接看到）
        miss = [n for n in segs if per[n].get(k, 0) == 0]
        if miss:
            bad += 1; print('缺漏      %-8s %-26s 缺: %s' % (var, k, ', '.join(miss)))
    print('%-8s 字典 %s，共 %d 個 key' % (var, list(segs), len(allk)))
print('---')
print(('❌ 有 %d 個問題' % bad) if bad else '✅ %s：字典完全對齊，無重複、無缺漏（共 %d 個 key）' % (name, total))
sys.exit(1 if bad else 0)
