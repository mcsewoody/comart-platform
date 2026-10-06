#!/usr/bin/env python3
"""AI Woody 的人格檔上傳與重新彙整（本機版；Portal 上 Woody 另有一顆「更新 AI Woody」按鈕做同一件事）。

用法：
  python3 scripts/ai-woody-push.py            # 上傳人格正文 ＋ 重新彙整（週報 ＋ AI Woody 資料夾）
  python3 scripts/ai-woody-push.py --core     # 只上傳人格正文（.local/woody/ai-woody-persona.md）
  python3 scripts/ai-woody-push.py --rebuild  # 只重新彙整

組成（由 edge function ai-woody 的 assemble.js 組裝，這裡不重寫那段邏輯）：
  人格正文（ai_personas 'woody-core'，Woody 審閱過）
  ＋ 附錄一：Woody 本人在週報裡寫過的全部文字（edge function 即時從 woody_reports 撈）
  ＋ 附錄二：AI Woody/必讀資料、AI Woody/好文分享 的全文（這支腳本在本機抽成文字送過去）

🔴 人格正文與 AI Woody 資料夾都不進版控（repo 公開）。
🔴 組裝只有 assemble.js 一份；這支腳本與 Portal 的按鈕都只負責「抽文字、送出去」。
   文字抽取兩邊工具不同（這裡用 textutil／pypdf，瀏覽器用 mammoth／pdf.js），結果可能有些微差異，那是可接受的。
"""
import json, logging, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERSONA = os.path.join(ROOT, '.local/woody/ai-woody-persona.md')
DOC_ROOT = os.path.join(ROOT, 'AI Woody')
FOLDERS = ['必讀資料', '好文分享']
SB = 'https://tcvlnpgpuphdalzvmoyo.supabase.co'


def secret_key():
    out = subprocess.run(['supabase', 'projects', 'api-keys', '--project-ref', 'tcvlnpgpuphdalzvmoyo',
                          '--reveal', '-o', 'json'], capture_output=True, text=True, check=True).stdout
    return [k['api_key'] for k in json.loads(out) if k.get('type') == 'secret' and k.get('name') == 'default'][0]


def http(method, url, key, body=None, extra=None):
    h = {'apikey': key, 'Content-Type': 'application/json'}
    h.update(extra or {})
    r = urllib.request.Request(url, data=body, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=300) as res:
        t = res.read()
        return json.loads(t) if t else None


def core_text():
    s = open(PERSONA, encoding='utf-8').read()
    # 審閱稿末尾的「附錄（上線時…）」只是說明，真的附錄由 assemble.js 接上
    return s.split('\n## 附錄（上線時一併提供給模型')[0].rstrip()


def extract(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in ('.txt', '.md'):
        return open(path, encoding='utf-8', errors='replace').read()
    if ext in ('.docx', '.doc', '.rtf'):
        return subprocess.run(['textutil', '-convert', 'txt', '-stdout', path], capture_output=True, text=True).stdout
    if ext == '.pdf':
        import pypdf
        logging.disable(logging.CRITICAL)
        return '\n'.join((p.extract_text() or '') for p in pypdf.PdfReader(path).pages)
    return ''


def collect_docs():
    docs = []
    for folder in FOLDERS:
        d = os.path.join(DOC_ROOT, folder)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if name.startswith('.'):
                continue
            text = extract(os.path.join(d, name)).strip()
            if text:
                docs.append({'folder': folder, 'name': name, 'text': text})
            else:
                print(f'  ⚠ 讀不到文字，略過：{folder}/{name}')
    return docs


def main():
    args = set(sys.argv[1:])
    do_core = '--rebuild' not in args
    do_rebuild = '--core' not in args
    key = secret_key()
    if do_core:
        http('POST', SB + '/rest/v1/ai_personas', key,
             json.dumps({'id': 'woody-core', 'system': core_text(), 'version': 'persona-md'}).encode(),
             {'Authorization': 'Bearer ' + key, 'Prefer': 'resolution=merge-duplicates,return=minimal'})
        print('已上傳人格正文（woody-core）')
    if do_rebuild:
        docs = collect_docs()
        print(f'AI Woody 資料夾：{len(docs)} 份文件')
        r = http('POST', SB + '/functions/v1/ai-woody', key,
                 json.dumps({'action': 'rebuild', 'docs': docs}).encode())
        print(f"已重新彙整：週報 {r['reports']} 份（最新 {r['latest']}）、文件 {len(r['docs'] or [])} 份、共 {r['chars']:,} 字")


if __name__ == '__main__':
    main()
