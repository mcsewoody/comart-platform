# Portal i18n 稽核：逐字典檢查，而不是全域計數。
#
# 🔴 為什麼要有這支：全域計數會放過一種錯誤 —— 10 份分佈成 (0,0,0,2,3)，
#    總數對、分佈全錯。2026-09-08 的 lc_rule1_t 就是這樣：en／繁中／簡中各 0 份，
#    畫面上直接顯示 key 名稱，而我的「共 5 份」檢查通過了。
#
# 🔴 不能用 regex 找 key：字串「值」裡面也會出現 xxx:' 這種片段（英文的
#    "load failed: '"、越南語的 "i:'"），那會產生一堆誤報把真的問題蓋掉。
#    這裡改成掃描器 —— 遇到字串常值就整段跳過，只在字串外面認 key。
import io, re, sys

s = io.open('index.html', encoding='utf-8').read()
i = s.index('const I18N = {')
marks = [(m.group(1).strip("'"), i + m.start())
         for m in re.finditer(r"\n  (en|'zh-TW'|'zh-CN'|vi|ja): \{", s[i:])]
m2 = re.search(r"\n  \}\n  \};", s[marks[-1][1]:])
assert m2, 'I18N 的結尾找不到（格式改了？）'
tail = marks[-1][1] + m2.start()
bounds = [(marks[k][0], marks[k][1], (marks[k + 1][1] if k + 1 < len(marks) else tail))
          for k in range(len(marks))]
# 從開頭那個 { 之後才開始掃，否則字典自己的名字（en: {）會被當成一個 key
segs = {n: s[s.index('{', a) + 1:b] for n, a, b in bounds}

IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

def keys_of(seg):
    """掃描一本字典，回傳 {key: 出現次數}。遇到 ' 就跳到字串結尾。"""
    out, j, n = {}, 0, len(seg)
    while j < n:
        c = seg[j]
        if c == "'":                       # 字串常值：整段跳過（含 \' 轉義）
            j += 1
            while j < n and seg[j] != "'":
                j += 2 if seg[j] == '\\' else 1
            j += 1
            continue
        m = IDENT.match(seg, j)
        if m:
            k = m.group(0)
            after = seg[m.end():m.end() + 2].lstrip()
            if after.startswith(':'):
                out[k] = out.get(k, 0) + 1
            j = m.end()
            continue
        j += 1
    return out

per = {n: keys_of(seg) for n, seg in segs.items()}
allk = set().union(*(set(d) for d in per.values()))

bad = 0
for n, d in per.items():                   # ① 同一本字典裡重複定義（後者贏，前者是死的）
    dup = sorted(k for k, v in d.items() if v > 1)
    if dup:
        bad += len(dup); print('重複定義  %-6s : %s' % (n, ', '.join(dup)))
for k in sorted(allk):                     # ② 缺漏（t() 會回傳 key 本身，畫面上直接看到）
    miss = [n for n in segs if per[n].get(k, 0) == 0]
    if miss:
        bad += 1; print('缺漏      %-26s 缺: %s' % (k, ', '.join(miss)))
print('---')
print('字典 %s，共 %d 個 key' % (list(segs), len(allk)))
print(('❌ 有 %d 個問題' % bad) if bad else '✅ 五本字典完全對齊，無重複、無缺漏')
sys.exit(1 if bad else 0)
