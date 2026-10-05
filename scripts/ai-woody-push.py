#!/usr/bin/env python3
"""組出 AI Woody 的 system prompt 並上傳到 public.ai_personas（id='woody'）。

用法：
  python3 scripts/ai-woody-push.py            # 組好並上傳
  python3 scripts/ai-woody-push.py --dry-run  # 只組，寫到 .local/woody/ai-woody-system.txt 給人看

內容 ＝ .local/woody/ai-woody-persona.md（人格檔，Woody 審閱過的那一份）
     ＋ 附錄：Woody 本人在週報裡寫過的全部文字（從資料庫即時撈 woody_reports）。

🔴 人格檔與附錄都不進版控（repo 公開）。這支腳本只負責組裝與上傳。
🔴 附錄裡同仁的分享會標成〔同仁分享〕，模型才不會把同仁的話當成 Woody 說的。
"""
import json, os, re, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERSONA = os.path.join(ROOT, '.local/woody/ai-woody-persona.md')
OUT = os.path.join(ROOT, '.local/woody/ai-woody-system.txt')
SB = 'https://tcvlnpgpuphdalzvmoyo.supabase.co'


def secret_key():
    out = subprocess.run(['supabase', 'projects', 'api-keys', '--project-ref', 'tcvlnpgpuphdalzvmoyo',
                          '--reveal', '-o', 'json'], capture_output=True, text=True, check=True).stdout
    return [k['api_key'] for k in json.loads(out) if k.get('type') == 'secret' and k.get('name') == 'default'][0]


def req(method, path, key, body=None, extra=None):
    h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    h.update(extra or {})
    r = urllib.request.Request(SB + path, data=body, method=method, headers=h)
    with urllib.request.urlopen(r) as res:
        t = res.read()
        return json.loads(t) if t else None


# 段落開頭像「振慈：」「Kayla:」「李立的心得思考：」「芳杏分享：」→ 同仁寫的。
# 🔴 一定要有冒號：「本週怡芳的分享，是我上週就想…」是 Woody 自己的話（引言），不是同仁的。
STAFF = re.compile(r'^(?:本週|本周)?([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z&、．·\s]{0,10}?)'
                   r'(?:的)?(?:分享|心得思考|心得反饋|心得|週報|周報|情報分享)?\s*[：:]')
# 冒號前面是這些詞的，是 Woody 自己的段落標記，不是人名
NOT_NAMES = {'原文', '摘錄', '摘自', '全文', '文章出處', '延伸閱讀', '注意', '舉例', 'Ps', 'ps', 'PS', '結論',
             '問', '答', '重點', '公式', '心得', '說明', '例', '註', '備註', '補充', '提醒', '來源', '出處',
             '學習工具一', 'The Last', 'Ex', '實例', '方法', '請重讀', '同場加碼', '同場加映', '交代事項', '迎接',
             '一', '二', '三', '四', '五', 'Q', 'A', 'Woody', 'woody', '心得思考', '視野情報', '團隊回饋', '核心觀點',
             '客戶', '摘錄重點', '管理心得', '總結', '小結', 'Henry 週報'}
WOODY_MARK = re.compile(r'^(→|=>|ð|-->|Woody\s*[:：→])')


def is_staff(p):
    m = STAFF.match(p)
    if not m or p.startswith('http'):
        return False
    name = m.group(1).strip()
    if name in NOT_NAMES or re.match(r'^(Q|A)\d', name) or re.match(r'^\d', name):
        return False
    return len(name) <= 10


def tag_paragraphs(text):
    out, staff = [], False
    for para in re.split(r'\n\s*\n', text.strip()):
        p = para.strip()
        if not p:
            continue
        if WOODY_MARK.match(p):
            staff = False
            p = re.sub(r'^(ð|=>)\s*', '→ ', p)
        elif is_staff(p):
            staff = True
        # 同仁的段落後面接著的延續段落（沒有新的名字開頭）也算同仁的，直到出現 Woody 的標記
        out.append(('〔同仁分享〕' if staff else '') + p)
    return '\n\n'.join(out)


def woody_comments(r):
    cs = []
    for k in ('intel', 'feedback'):
        for ln in (r.get(k) or '').split('\n'):
            t = ln.strip()
            m = re.match(r'^(→|=>|ð|Woody\s*[:：])\s*(.+)', t)
            if m and len(m.group(2)) >= 4:
                cs.append(m.group(2).strip())
    return cs


def build(rows):
    parts = ['# 附錄：Woody 本人在週報裡寫過的文字（2021-09-12 ～ 2026-10-04）',
             '以下依日期排列，是引用時的原文依據。標示〔同仁分享〕的段落是同仁寫的，不是 Woody 的話；'
             '可以說「某某分享過……」，但不可當成 Woody 的觀點，也不可評價該同仁。'
             '「對同仁的回應」是 Woody 對同仁週報的簡短回覆。', '']
    for r in rows:
        refl = (r.get('reflections') or '').strip()
        other = (r.get('other') or '').strip()
        cs = woody_comments(r)
        if not (refl or other or cs):
            continue
        parts.append('## ' + r['report_date'])
        if r.get('work'):
            parts.append('本週工作：' + r['work'].replace('\n', '／'))
        if r.get('plan'):
            parts.append('下週計畫：' + r['plan'].replace('\n', '／'))
        if other:
            parts.append('開場與交代：\n' + other)
        if refl:
            parts.append('心得思考：\n' + tag_paragraphs(refl))
        if cs:
            parts.append('對同仁的回應：\n' + '\n'.join('・' + c for c in cs))
        parts.append('')
    return '\n'.join(parts)


def main():
    dry = '--dry-run' in sys.argv
    key = secret_key()
    rows = req('GET', '/rest/v1/woody_reports?select=report_date,work,plan,reflections,intel,feedback,other'
                      '&author_id=eq.C00001&order=report_date.asc&limit=2000', key)
    persona = open(PERSONA, encoding='utf-8').read()
    # 人格檔末尾那段「附錄（不在這份審閱稿裡）」是給審閱者看的說明，送給模型時換成真的附錄
    persona = re.split(r'\n## 附錄（上線時一併提供給模型', persona)[0].rstrip()
    system = persona + '\n\n---\n\n' + build(rows)
    open(OUT, 'w', encoding='utf-8').write(system)
    print(f'週報 {len(rows)} 份，system prompt {len(system):,} 字 → {OUT}')
    if dry:
        return
    version = rows[-1]['report_date'] if rows else ''
    req('POST', '/rest/v1/ai_personas', key,
        json.dumps({'id': 'woody', 'system': system, 'version': version, 'updated_at': 'now()'}).encode(),
        {'Prefer': 'resolution=merge-duplicates,return=minimal'})
    print('已上傳 ai_personas.woody（ai-woody 最慢 5 分鐘內生效）')


if __name__ == '__main__':
    main()
