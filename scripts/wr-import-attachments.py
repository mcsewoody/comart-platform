#!/usr/bin/env python3
"""把 Gmail 週報信件裡的附件補進 woody_reports.attachments（board v1.93 起的「附件」欄）。

用法：
  python3 scripts/wr-import-attachments.py <takeout.mbox> <wr_attachments.json> [--dry-run]

- mbox：Google Takeout 匯出的郵件（只勾「Woody 週報」那些信或整個信箱都可以）。
- json：盤點清單（date／threadId／messageId／files），由 Gmail 掃描產生。
- 金鑰：用 `supabase projects api-keys --reveal` 取 secret key（不寫進檔案、不進版控）。

🔴 對應用 Gmail 的 X-GM-THRID（十進位）＝ 盤點清單 threadId（十六進位），不靠主旨或日期 ——
   主旨日期與內文不符、收回重寄的情況都有。
🔴 同一張圖常在一封信裡出現兩次（行內圖＋附件），以內容 sha256 去重。
🔴 HEIC 轉成 JPEG（sips）：Chrome／Edge 不顯示 HEIC。
🔴 只補「目前還沒有附件」的週報；物件鍵由日期＋sha 決定，重跑不會重複。
"""
import email, hashlib, io, json, mailbox, os, subprocess, sys, tempfile, urllib.request
from email.header import decode_header, make_header

SB = 'https://tcvlnpgpuphdalzvmoyo.supabase.co'
BUCKET = 'woody-attachments'

def secret_key():
    out = subprocess.run(['supabase', 'projects', 'api-keys', '--project-ref', 'tcvlnpgpuphdalzvmoyo',
                          '--reveal', '-o', 'json'], capture_output=True, text=True, check=True).stdout
    return [k['api_key'] for k in json.loads(out) if k.get('type') == 'secret' and k.get('name') == 'default'][0]

def req(method, path, key, body=None, ctype='application/json', extra=None):
    h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': ctype}
    h.update(extra or {})
    r = urllib.request.Request(SB + path, data=body, method=method, headers=h)
    with urllib.request.urlopen(r) as res:
        t = res.read()
        return json.loads(t) if t else None

def fname(part):
    n = part.get_filename()
    return str(make_header(decode_header(n))) if n else ''

def img_size(data):
    try:
        from PIL import Image
        return Image.open(io.BytesIO(data)).size
    except Exception:
        return (None, None)

def heic_to_jpeg(data):
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, 'a.heic'), os.path.join(d, 'a.jpg')
        open(src, 'wb').write(data)
        subprocess.run(['sips', '-s', 'format', 'jpeg', src, '--out', dst], capture_output=True, check=True)
        return open(dst, 'rb').read()

EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf'}

def main():
    mbox_path, json_path = sys.argv[1], sys.argv[2]
    dry = '--dry-run' in sys.argv
    want = json.load(open(json_path))
    by_thr = {int(w['threadId'], 16): w for w in want}
    by_msg = {int(w['messageId'], 16): w for w in want}

    # 每份週報收集附件（同一 thread 可能有重寄，取附件最多的那一封）
    found = {}
    for msg in mailbox.mbox(mbox_path):
        thr = msg.get('X-GM-THRID')
        w = by_thr.get(int(thr)) if thr and thr.isdigit() else None
        if not w:
            continue
        parts = []
        for part in msg.walk():
            ct = part.get_content_type()
            if part.is_multipart() or not (ct.startswith('image/') or ct == 'application/pdf'):
                continue
            data = part.get_payload(decode=True)
            if data:
                parts.append((fname(part) or 'image', ct, data))
        if len(parts) > len(found.get(w['date'], ([], None))[0]):
            found[w['date']] = (parts, w)

    key = None if dry else secret_key()
    reports = {}
    if not dry:
        for r in req('GET', '/rest/v1/woody_reports?select=id,report_date,attachments&limit=2000', key):
            reports[r['report_date']] = r

    total = 0
    for w in want:
        d = w['date']
        parts = found.get(d, ([], None))[0]
        if not parts:
            print(f'⚠ {d}: mbox 裡找不到這封信的附件'); continue
        seen, atts = set(), []
        for name, ct, data in parts:
            if ct in ('image/heic', 'image/heif'):
                data, ct = heic_to_jpeg(data), 'image/jpeg'
                name = os.path.splitext(name)[0] + '.jpg'
            h = hashlib.sha256(data).hexdigest()
            if h in seen:
                continue
            seen.add(h)
            ext = EXT.get(ct, 'bin')
            path = f'wr/import-{d}/{h[:16]}.{ext}'
            a = {'path': path, 'name': name, 'mime': ct, 'size': len(data)}
            if ct.startswith('image/'):
                a['w'], a['h'] = img_size(data)
            atts.append((a, data))
        print(f'{d}: {len(atts)} 份 ' + '、'.join(a['name'] for a, _ in atts))
        total += len(atts)
        if dry:
            continue
        r = reports.get(d)
        if not r:
            print(f'   ⚠ 平台上沒有 {d} 這份週報，略過'); continue
        if r.get('attachments'):
            print('   已有附件，略過'); continue
        for a, data in atts:
            req('POST', f'/storage/v1/object/{BUCKET}/{a["path"]}', key, data, a['mime'], {'x-upsert': 'true'})
        req('PATCH', f'/rest/v1/woody_reports?id=eq.{r["id"]}', key,
            json.dumps({'attachments': [a for a, _ in atts]}).encode(), extra={'Prefer': 'return=minimal'})
    print(f'合計 {total} 個檔案' + ('（dry-run，未寫入）' if dry else ''))

if __name__ == '__main__':
    main()
