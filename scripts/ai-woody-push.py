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
import base64, json, logging, os, subprocess, sys, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERSONA = os.path.join(ROOT, '.local/woody/ai-woody-persona.md')
DOC_ROOT = os.path.join(ROOT, 'AI Woody')
FOLDERS = ['必讀資料', '好文分享']
IMAGE_EXT = ('.png', '.jpg', '.jpeg', '.webp', '.gif')
OCR_PAR = 3   # 同 Portal 按鈕：同時辨識幾張
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


def is_image(name):
    return os.path.splitext(name)[1].lower() in IMAGE_EXT


def ocr_key(folder, name, path):
    return f'{folder}/{name}|{os.path.getsize(path)}'


def ocr_one(key, path, fn):
    # 同 Portal：長邊 2000px、JPEG，由 edge function 的 'ocr' 動作抄錄並存進伺服器端快取
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, 'x.jpg')
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '90', '-Z', '2000', path, '--out', out],
                       capture_output=True, check=True)
        data = base64.b64encode(open(out, 'rb').read()).decode()
    return fn({'action': 'ocr', 'key': key, 'mime': 'image/jpeg', 'data': data})


def collect_docs(api):
    """圖片送 { ocr: True, size }（文字由伺服器端快取補）；沒辨識過的先辨識。
    🔴 圖片一定要列進去：rebuild 會清掉「這次沒列到的」圖片快取。"""
    docs, todo = [], []
    cached = None
    for folder in FOLDERS:
        d = os.path.join(DOC_ROOT, folder)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if name.startswith('.'):
                continue
            path = os.path.join(d, name)
            if is_image(name):
                if cached is None:
                    cached = set(api({'action': 'ocrList'}).get('keys') or [])
                key = ocr_key(folder, name, path)
                docs.append({'folder': folder, 'name': name, 'size': os.path.getsize(path), 'ocr': True})
                if key not in cached:
                    todo.append((key, path, name))
                continue
            text = extract(path).strip()
            if text:
                docs.append({'folder': folder, 'name': name, 'text': text})
            else:
                print(f'  ⚠ 讀不到文字，略過：{folder}/{name}')
    if todo:
        print(f'辨識圖片 {len(todo)} 張…')
        def run(t):
            try:
                ocr_one(t[0], t[1], api)
                return None
            except Exception as e:
                return f'{t[2]}（{e}）'
        with ThreadPoolExecutor(OCR_PAR) as ex:
            for bad in ex.map(run, todo):
                if bad:
                    print(f'  ⚠ 辨識失敗：{bad}')
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
        api = lambda body: http('POST', SB + '/functions/v1/ai-woody', key, json.dumps(body).encode())
        docs = collect_docs(api)
        print(f'AI Woody 資料夾：{len(docs)} 份文件')
        r = api({'action': 'rebuild', 'docs': docs})
        print(f"已重新彙整：週報 {r['reports']} 份（最新 {r['latest']}）、文件 {len(r['docs'] or [])} 份、共 {r['chars']:,} 字")
        if r.get('ocrMissing'):
            print('  ⚠ 這些圖片沒有文字可用：' + '、'.join(r['ocrMissing']))


if __name__ == '__main__':
    main()
