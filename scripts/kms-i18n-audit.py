#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""KMS 的 i18n 字典稽核（kms/index.html 專用）。

Portal 的 scripts/i18n-audit.py 只認 Portal 的字典形狀（`key:'值'`），
KMS 用的是加引號的 key（`'btn.save':'儲存'`），所以要另外一份。

檢查兩件事，與 Portal 那支同樣的理由：
  ① 同一本字典裡有沒有重複定義 —— **後者會贏，前者是死的**。
     值相同只是冗餘；值不同就是「改了前面那份卻沒有任何效果」的陷阱。
  ② 每個 key 是不是五本都有 —— 缺的那一本 t() 會回傳 key 本身，
     而那在畫面上長得像一段正常文字，只有真的打開那一頁的人會發現。

🔴 不能用 regex 找 key：字串「值」裡面也會出現 `xxx:'` 的片段。
   這裡用掃描器 —— 遇到字串常值整段跳過，只在字串外面認 key。
"""
import re, sys, pathlib

SRC = pathlib.Path(__file__).resolve().parent.parent / 'kms' / 'index.html'
LANGS = ['zh-TW', 'zh-CN', 'en', 'vi', 'ja']


def dict_ranges(text):
    """找出 const I18N = { … } 裡五本字典各自的起訖位置。

    🔴 最後一本的結束位置必須用**大括號配對**算出來，不可以用「檔案結尾」——
       I18N 後面還有一大片程式碼，裡面的物件常值（`'x-session': …`、
       `'Authorization': …`）長得跟字典條目一模一樣，會被當成 key 而產生
       一堆誤報，把真正的問題蓋掉。（第一版就是這樣，2026-09-21 當場修掉。）
    """
    m = re.search(r'\nconst I18N = \{', text)
    if not m:
        sys.exit('找不到 const I18N = {')
    # 從開頭的 { 起算，跳過字串常值，找到配對的 }
    i = text.index('{', m.start())
    depth, j, n = 0, i, len(text)
    while j < n:
        c = text[j]
        if c == "'" or c == '"' or c == '`':
            q, j = c, j + 1
            while j < n and text[j] != q:
                if text[j] == '\\':
                    j += 1
                j += 1
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                break
        j += 1
    end = j
    starts = []
    for lang in LANGS:
        mm = re.search(r"\n  '" + re.escape(lang) + r"': \{", text[i:end])
        if not mm:
            sys.exit('找不到字典：' + lang)
        starts.append((lang, i + mm.end()))
    out = []
    for k, (lang, a) in enumerate(starts):
        b = starts[k + 1][1] if k + 1 < len(starts) else end
        out.append((lang, a, b))
    return out


def scan(seg):
    """回傳 [(key, value)]，只認「字串常值後面接冒號」的位置。"""
    out, i, n = [], 0, len(seg)
    while i < n:
        if seg[i] == "'":
            j = i + 1
            while j < n and seg[j] != "'":
                if seg[j] == '\\':
                    j += 1
                j += 1
            lit = seg[i + 1:j]
            k = j + 1
            while k < n and seg[k] in ' \t\n':
                k += 1
            if k < n and seg[k] == ':' and lit not in LANGS:
                m = k + 1
                while m < n and seg[m] in ' \t\n':
                    m += 1
                val = ''
                if m < n and seg[m] == "'":
                    e = m + 1
                    while e < n and seg[e] != "'":
                        if seg[e] == '\\':
                            e += 1
                        e += 1
                    val = seg[m + 1:e]
                out.append((lit, val))
            i = j + 1
        else:
            i += 1
    return out


def main():
    text = SRC.read_text(encoding='utf-8')
    sets, bad = {}, False
    for lang, a, b in dict_ranges(text):
        pairs = scan(text[a:b])
        seen = {}
        for k, v in pairs:
            if k in seen:
                bad = True
                same = seen[k] == v
                print(('⚠  ' if same else '🔴 ') + f'{lang}：「{k}」定義兩次'
                      + ('（值相同，冗餘）' if same else ' —— 值不同，前面那份是死的'))
                if not same:
                    print(f'     前（死的）: {seen[k][:60]}')
                    print(f'     後（生效）: {v[:60]}')
            seen[k] = v
        sets[lang] = set(seen)
        print(f'{lang:>6}: {len(seen)} key')

    base = set().union(*sets.values())
    for lang, ks in sets.items():
        miss = base - ks
        if miss:
            bad = True
            print(f'🔴 {lang} 缺 {len(miss)} 個 key（畫面會直接顯示 key 名稱）: {sorted(miss)}')

    print('---')
    print('⚠ 有問題（見上）' if bad else '✅ 五本字典完全對齊，無重複、無缺漏')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
