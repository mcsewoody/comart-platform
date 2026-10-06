#!/usr/bin/env python3
"""AI Woody 的人格正文上傳與重新彙整（Portal 上 Woody 另有一顆「🔄 更新 AI Woody」做重新彙整）。

用法：
  python3 scripts/ai-woody-push.py            # 上傳人格正文 ＋ 重新彙整
  python3 scripts/ai-woody-push.py --core     # 只上傳人格正文（.local/woody/ai-woody-persona.md）
  python3 scripts/ai-woody-push.py --rebuild  # 只重新彙整

組成（由 edge function ai-woody 的 assemble.js 組裝，這裡不重寫那段邏輯）：
  人格正文（ai_personas 'woody-core'，Woody 審閱過）
  ＋ 附錄一：Woody 本人在週報裡寫過的全部文字（woody_reports）
  ＋ 附錄二：KMS「Woody 推薦閱讀」分類（cat_key = woody_reads）已發佈的文件；標籤「必讀資料」＝必讀，其餘＝好文分享

🔴 人格正文不進版控（repo 公開）。🔴 --core 只在 Woody 看過修改的段落、同意之後才跑。
"""
import json, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERSONA = os.path.join(ROOT, '.local/woody/ai-woody-persona.md')
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


def main():
    args = set(sys.argv[1:])
    key = secret_key()
    if '--rebuild' not in args:
        http('POST', SB + '/rest/v1/ai_personas', key,
             json.dumps({'id': 'woody-core', 'system': core_text(), 'version': 'persona-md'}).encode(),
             {'Authorization': 'Bearer ' + key, 'Prefer': 'resolution=merge-duplicates,return=minimal'})
        print('已上傳人格正文（woody-core）')
    if '--core' not in args:
        r = http('POST', SB + '/functions/v1/ai-woody', key, json.dumps({'action': 'rebuild'}).encode())
        print(f"已重新彙整：週報 {r['reports']} 份（最新 {r['latest']}）、KMS 文件 {r['docs']} 份、共 {r['chars']:,} 字")


if __name__ == '__main__':
    main()
