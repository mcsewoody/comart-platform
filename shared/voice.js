/* ═══════════════════════════════════════════════════════════════════════
   COMART 共用語音輸入  shared/voice.js
   五個子系統（Portal / Admin / KMS / Quotation / Board）共用這一份。

   🔴 **這是本 repo 第一個跨子系統共用的 JS 檔。** 其他共用邏輯（i18n 字典、
      PM_TR_RULES／LC_TR_RULES 的翻譯規則）都是各檔一份副本，CLAUDE.md 已記載
      那必然分岔、而分岔之後寬鬆的那一份就是實際生效的那一份。語音輸入不再重蹈。

   🔴 **改這個檔案時，五個 HTML 的 `?v=` 都要 +1。** GitHub Pages 的
      Cache-Control 是 4 小時，不改 `?v=` 的話使用者拿到的是舊版，而且**看不出來**。
      目前的載入者：index.html（Portal）。

   架構：
     瀏覽器錄音（MediaRecorder）
       → Supabase edge function `transcribe`（whisper-1）
       → 呼叫端提供的 callClaude 做 AI 整理（標點／口語填充／同音字）
       → onText(文字)

   🔴 **不要退回瀏覽器內建的 Web Speech API。** 兩個原因：
      ① 品質改不了（無法提供詞彙表，產品型號一律聽錯），continuous 模式會自己中斷。
      ② **Chrome 的 Web Speech 把音訊送到 Google 伺服器，Google 被 GFW 封鎖，
         東莞廠根本用不了。** 現在瀏覽器只跟 Supabase 說話，音訊由機房發出。
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var V = { VERSION: '1.0' };

  var MAX_SEC   = 120;      // 忘記按停止時自己收（成本與等待時間都會失控）
  var MIN_BYTES = 1200;     // 比這還小就是誤觸，不值得送一次 API
  var SLICE_MS  = 2000;

  // 🔴 webm 的容器 header 在**第一塊**裡，少了它解碼器只能從後面的 cluster 開始
  //    ——那正是「只擷取最後一段」的典型成因。所以每一塊都要留。
  var mr = null, stream = null, chunks = [];
  var active = false, uploading = false, polishing = false;
  var sec = 0, tick = null, cfg = null;

  V.supported = function () {
    return !!(global.navigator && global.navigator.mediaDevices &&
              global.navigator.mediaDevices.getUserMedia &&
              typeof global.MediaRecorder !== 'undefined');
  };
  V.active    = function () { return active; };
  V.busy      = function () { return uploading || polishing; };
  V.seconds   = function () { return sec; };
  V.state     = function () {
    return polishing ? 'polishing' : uploading ? 'uploading' : active ? 'recording' : 'idle';
  };

  // MediaRecorder 的容器依瀏覽器而異：Chrome/Edge 給 webm(opus)、Safari 給 mp4(aac)。
  // 兩者 OpenAI 都吃，但**它靠副檔名判斷格式**，所以要把真實 mime 送給伺服器。
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (var i = 0; i < c.length; i++) {
      try { if (global.MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {}
    }
    return '';
  }

  // 🔴 一定要停掉 track：不停的話分頁的麥克風指示燈會一直亮著，
  //    使用者會（合理地）以為我們在偷錄音。
  function release() {
    if (stream) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      stream = null;
    }
    mr = null;
  }

  function paint() { if (cfg && cfg.onState) { try { cfg.onState(V.state(), sec); } catch (e) {} } }
  function fail(code, detail) {
    if (detail) console.warn('[voice] ' + code, detail);
    if (cfg && cfg.onError) { try { cfg.onError(code); } catch (e) {} }
  }

  V.toggle = function (c) { return active ? V.stop() : V.start(c); };

  V.start = async function (c) {
    if (active || V.busy()) return;
    cfg = c || {};
    if (!V.supported()) { fail('unsupported'); return; }
    try {
      stream = await global.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      fail('denied', e && e.name); return;
    }
    var mt = pickMime();
    try {
      mr = mt ? new global.MediaRecorder(stream, { mimeType: mt }) : new global.MediaRecorder(stream);
    } catch (e) {
      try { mr = new global.MediaRecorder(stream); }
      catch (e2) { release(); fail('unsupported', e2 && e2.message); return; }
    }
    chunks = [];
    mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
    mr.onstop = finish;
    try { mr.start(SLICE_MS); }
    catch (e) { release(); fail('failed', e && e.message); return; }

    active = true; sec = 0; paint();
    tick = setInterval(function () {
      sec++; paint();
      if (sec >= (cfg.maxSec || MAX_SEC)) V.stop();
    }, 1000);
  };

  V.stop = function () {
    if (tick) { clearInterval(tick); tick = null; }
    active = false;
    if (mr && mr.state !== 'inactive') { try { mr.stop(); } catch (e) { release(); } }
    else { release(); }
    paint();
  };

  async function finish() {
    var mime = (mr && mr.mimeType) || 'audio/webm';
    var n = chunks.length;
    // stop() 之後還會再吐最後一塊，所以 blob 要在 onstop 裡才組
    var blob = n ? new Blob(chunks, { type: mime }) : null;
    chunks = [];
    release();
    console.log('[voice] audio', { sec: sec, chunks: n, bytes: blob ? blob.size : 0, mime: mime });
    if (!blob || blob.size < MIN_BYTES) { paint(); fail('empty'); return; }

    uploading = true; paint();
    var raw = '';
    try {
      var sig  = typeof cfg.sig  === 'function' ? cfg.sig()  : (cfg.sig  || '');
      var lang = typeof cfg.lang === 'function' ? cfg.lang() : (cfg.lang || '');
      var res = await fetch(cfg.sbUrl + '/functions/v1/transcribe', {
        method: 'POST',
        headers: { 'x-session': sig, 'x-audio-type': mime, 'x-audio-lang': lang },
        body: blob,
      });
      if (!res.ok) {
        var why = await res.text().catch(function () { return ''; });
        uploading = false; paint();
        fail(res.status === 401 ? 'expired' : 'failed', res.status + ' ' + why.slice(0, 200));
        return;
      }
      var data = await res.json();
      raw = String((data && data.text) || '').trim();
      console.log('[voice] transcribe', { sentBytes: blob.size, gotBytes: data && data.bytes,
                                          model: data && data.model, chars: raw.length });
      // 上傳與伺服器收到的位元數不一致 ＝ 上傳被截斷，那是完全不同的問題
      if (data && data.bytes && data.bytes !== blob.size) {
        console.warn('[voice] byte mismatch — 上傳的音訊不完整', blob.size, '→', data.bytes);
      }
    } catch (e) {
      uploading = false; paint();
      fail('failed', e && e.message); return;
    }
    uploading = false;
    if (!raw) { paint(); fail('empty'); return; }

    // AI 整理（呼叫端沒給 callClaude 就跳過）
    var out = raw;
    if (typeof cfg.callClaude === 'function') {
      polishing = true; paint();
      out = await V.clean(raw, cfg.callClaude);
      polishing = false;
    }
    paint();
    if (cfg.onText) { try { cfg.onText(out); } catch (e) {} }
  }

  /* ── AI 整理 ──────────────────────────────────────────────────────────
     🔴 這一步是「翻譯頁籤的語音輸入效果好」的**真正原因**（原本的 pCleanText），
        不是它的辨識比較準 —— 那邊用的是同一套 Web Speech API，lang 還寫死 'zh-TW'。
        whisper 的輸出雖然已有標點，但不會去掉「嗯」「那個」這類口語填充、
        也不會修順語句。

     🔴 最大的風險是「整理」變成「改寫」：這些內容會被翻成多語、存進資料庫、
        匯出成 PDF —— 動到語意就是竄改別人的發言。所以規則寫得很嚴格。 */
  V.CLEAN_MODEL = 'claude-sonnet-5';

  V.VOCAB = ['COMART', 'TIPTOP', 'PLM', 'ERP', 'Qi2', 'MagSafe',
             '東莞廠', '越南廠', '台灣營運中心',
             '報價單', '出貨', '打樣', '開模', '驗貨', '櫃號', '工單', '料號'].join('、');

  V.CLEAN_SYS =
    'You clean up raw speech-to-text output from internal work systems at a manufacturer ' +
    '(Taiwan / Dongguan / Vietnam sites).\n\n' +
    'Rules:\n' +
    '- Output the SAME language as the input. Never translate.\n' +
    '- Add correct punctuation and sentence breaks.\n' +
    '- Remove speech disfluencies only (um, uh, 嗯, 那個, repeated false starts).\n' +
    '- Fix obvious speech-recognition errors, especially homophones, using the work context. ' +
    'Likely terms: ' + V.VOCAB + '\n' +
    '- Do NOT add, remove or reinterpret any content. Do NOT answer, explain or comment.\n' +
    '- Do NOT make it more formal or polite than the speaker was.\n' +
    '- Keep unchanged: names, product and system names, model numbers, employee IDs, ' +
    'numbers, dates and units.\n\n' +
    'Reply with ONLY the cleaned text wrapped in <clean></clean> and nothing else.';

  V.clean = async function (raw, callClaude) {
    var txt = String(raw || '').trim();
    if (txt.length < 4) return txt;            // 太短沒什麼可整理，省一次呼叫
    try {
      var budget = Math.min(4000, Math.max(600, txt.length * 3 + 200));
      var out = await callClaude([{ role: 'user', content: '<raw>' + txt + '</raw>' }],
                                 V.CLEAN_SYS, budget, V.CLEAN_MODEL);
      // 用標籤取值，避免模型加上「以下是整理後的文字：」之類的前言
      var m = String(out || '').match(/<clean>([\s\S]*?)<\/clean>/i);
      var got = m ? m[1].trim() : String(out || '').trim();
      /* 🔴 整理失敗或結果可疑時一律退回原文，**絕不能讓使用者的話消失**。
         長度掉到不足六成 ＝ 模型很可能自己摘要或截斷了，那比沒整理更糟。 */
      if (!got) return txt;
      if (got.length < txt.length * 0.6) {
        console.warn('[voice] cleanup 結果過短，退回原文', txt.length, '→', got.length);
        return txt;
      }
      return got;
    } catch (e) {
      console.warn('[voice] cleanup failed', e);
      return txt;    // 整理只是加分項，失敗不該讓語音輸入整個失效
    }
  };

  /* ── 便利函式：把一顆按鈕綁到一個 textarea ─────────────────────────────
     大部分使用情境都是這樣，不必每個地方自己寫 onState／onText。
     opts: { btn, target, sbUrl, sig, lang, callClaude, t, toast, maxLen } */
  V.bind = function (opts) {
    var btn = typeof opts.btn === 'string' ? document.getElementById(opts.btn) : opts.btn;
    var tt  = function (k, fb) { try { return (opts.t && opts.t(k)) || fb; } catch (e) { return fb; } };
    if (!btn) return null;
    if (!V.supported()) { btn.style.display = 'none'; return null; }

    function target() {
      return typeof opts.target === 'string' ? document.getElementById(opts.target) : opts.target;
    }
    function repaint(state, s) {
      btn.classList.toggle('on', state === 'recording');
      btn.disabled = (state === 'uploading' || state === 'polishing');
      if (state === 'recording')      btn.textContent = '⏹ ' + s + 's';
      else if (state === 'uploading') btn.textContent = '⋯';
      else if (state === 'polishing') btn.textContent = '✨';
      else                            btn.textContent = '🎙';
      if (opts.onState) { try { opts.onState(state, s); } catch (e) {} }
    }
    repaint('idle', 0);

    btn.addEventListener('click', function () {
      V.toggle({
        sbUrl: opts.sbUrl,
        sig: opts.sig,
        lang: opts.lang,
        callClaude: opts.callClaude,
        onState: repaint,
        onError: function (code) {
          var msg = {
            unsupported: tt('voice_unsupported', '這個瀏覽器無法錄音，請使用 Chrome、Edge 或 Safari。'),
            denied:      tt('voice_denied',      '麥克風權限被拒絕，請在瀏覽器設定中允許。'),
            empty:       tt('voice_empty',       '沒有收到語音，請再試一次。'),
            expired:     tt('voice_expired',     '登入已逾期，請重新登入。'),
            failed:      tt('voice_failed',      '語音辨識失敗，請再試一次，或改用打字。'),
          }[code] || code;
          if (opts.toast) opts.toast(msg, 'err');
          repaint('idle', 0);
        },
        onText: function (text) {
          var el = target();
          if (!el) return;
          el.value = el.value ? (el.value.replace(/\s+$/, '') + ' ' + text) : text;
          if (opts.maxLen) {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, opts.maxLen) + 'px';
          }
          el.focus();
          try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
          if (opts.onText) opts.onText(text);
        },
      });
    });
    return { repaint: repaint };
  };

  global.ComartVoice = V;
})(typeof window !== 'undefined' ? window : globalThis);
