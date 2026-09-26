# 多語字典稽核：逐字典檢查，而不是全域計數。
#
#   python3 scripts/i18n-audit.py                    # Portal（index.html 的 I18N）
#   python3 scripts/i18n-audit.py board              # Board（board/index.html 的 B_I18N ＋ PL_I18N）
#   python3 scripts/i18n-audit.py quotation          # 報價系統（quotation/index.html 的 UI）
#   python3 scripts/i18n-audit.py admin              # Admin（ADMIN_I18N，key 帶引號）
#   python3 scripts/i18n-audit.py kms                # KMS（I18N，key 帶引號）
#   python3 scripts/i18n-audit.py pd-hub             # Product Dev 工作區首頁（PD_I18N）
#   python3 scripts/i18n-audit.py pd-devices         # Product Dev 手機與配件（DV_I18N）
#   python3 scripts/i18n-audit.py pd-finder          # Product Dev Finder（TypeScript 模組的 DICT）
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
    'pd-hub': ('product_dev/index.html', ['PD_I18N']),
    'pd-devices': ('product_dev/devices/index.html', ['DV_I18N']),
    'pd-finder': ('product_dev/finder-src/src/i18n.ts', ['DICT']),
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


def used_keys(src):
    """畫面上真的取用到的 key：data-i18n 系列屬性 ＋ t('字面值') 這類呼叫。

    🔴 只回報「用了但字典沒有」（畫面會直接顯示 key 名稱），不回報「字典有但沒用到」——
       CLAUDE.md 記載過 key 可以是組出來的（`'lc_rule'+ri+'_t'`），
       那一邊一定會誤報，而誤報會把真的問題蓋掉。"""
    # 註解要先拿掉：board 的 `// BT('key', {n:3}) —— …` 是說明文字，不是真的呼叫
    src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    src = re.sub(r'(?m)^\s*//.*$', ' ', src)
    out = set()
    for m in re.finditer(r'data-i18n(?:-ph|-title)?="([^"]+)"', src):
        out.add(m.group(1))
    for m in re.finditer(r"\b(?:t|BT|PT|DT|BTZ)\(\s*'([A-Za-z0-9_.\-]+)'", src):
        k = m.group(1)
        # 組出來的 key 只抓得到前綴（`BT('site_' + s)`、`t('car.fuel.' + x)`）——
        # 那不是缺漏，報出來只會把真的問題蓋掉
        if k[-1] not in '_.-':
            out.add(k)
    return out


def assigned_keys(src):
    """字典物件之外補上的 key：`B_I18N['zh-TW'].pl_nav = '投票'` 這種寫法。"""
    return set(re.findall(r"\w+\[['\"][\w-]+['\"]\]\.(\w+)\s*=", src))


bad, total = 0, 0
defined = set()
for var in varnames:
    # 宣告的空白寫法各檔不同（`const X = {` 與 `const X={` 都有），不要寫死
    m = re.search(r'const\s+%s\s*(?::[^=]+?)?=\s*\{' % re.escape(var), s)
    assert m, '%s 的宣告找不到' % var
    segs = lang_segments(s, m.end() - 1)
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
    defined |= allk
    print('%-8s 字典 %s，共 %d 個 key' % (var, list(segs), len(allk)))

# ③ 畫面上取用了、但字典裡沒有的 key —— t() 會原樣回傳 key，
#    使用者看到的就是 `hero_h1` 這種字串，而稽核「五本字典互相對齊」永遠抓不到它。
missing = sorted(used_keys(s) - defined - assigned_keys(s))
if missing:
    bad += len(missing)
    print('未定義    %s' % ', '.join(missing))
print('---')
print(('❌ 有 %d 個問題' % bad) if bad else '✅ %s：字典完全對齊，無重複、無缺漏（共 %d 個 key）' % (name, total))
sys.exit(1 if bad else 0)
