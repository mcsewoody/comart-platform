/* ═══════════════════════════════════════════════════════════════════════
   shared/invite.js — 線上對話的邀請卡（五個子系統共用同一份）
   Portal v1.95 / 2026-09-07

   為什麼是共用檔而不是各系統一份：
   邀請卡本來只做在 Portal（v1.94），但同事被邀請的時候人常常在 KMS 或報價系統裡，
   那邊什麼都不會出現 —— 而「有人正等你進去講話」錯過就沒有意義了。
   複製四份的下場 CLAUDE.md 已經記載過兩次（PM_TR_RULES → LC_TR_RULES 一天內就分岔，
   而且**弱掉的那一份就是實際生效的那一份**），所以這裡跟 voice.js／translate.js
   一樣走 shared/。

   🔴 這個模組刻意「幾乎不需要參數」：五個子系統同源、共用
      localStorage['comart-portal-session']（含 sig）與同一個 sb-proxy，
      所以它自己讀得到身分。宿主只要在「session 已就緒、而且畫面已經真的進到系統裡」
      的時候呼叫 ComartInvite.start() 一次。
      ⚠️ 不做自動啟動：Portal 有強制改密碼那一關，在那個畫面上冒出可點進聊天室的卡片
      等於把那一關繞過去。什麼時候算「進來了」只有宿主知道。

   🔴 卡片自帶配色，不使用宿主的 CSS 變數。
      Portal／Quotation／Board 是 --ac/--s1/--tx，Admin／KMS 是 --blue/--surface-2/--text-3
      —— 共用元件一旦引用宿主的 token 名稱，就會在另外兩個系統裡變成透明或看不見。
      五個系統都是深色底，所以這裡寫死一組在 #080C14 與 #0f1117 上都讀得清楚的顏色。

   🔴 「看過了沒有」的事實來源是 notifications.is_read，不另外存旗標：
      存在瀏覽器就會換一台裝置又被吵一次，存成新欄位則要多一個 migration
      而且與鈴鐺的已讀狀態必然分岔。

   改這個檔案時，**所有載入它的 HTML 的 ?v= 都要 +1**（GitHub Pages 的
   Cache-Control 是 4 小時，不 bump 的話使用者拿到舊版而且看不出來）。
   目前載入者：index.html、admin/index.html、kms/index.html、
   quotation/index.html、board/index.html。
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SB_URL      = 'https://tcvlnpgpuphdalzvmoyo.supabase.co/functions/v1/sb-proxy';
  var SESSION_KEY = 'comart-portal-session';
  var LANG_KEY    = 'comart-lang';
  var SHOW        = 3;        // 同時最多三張，其餘只報數（別把整個畫面蓋掉）
  var POLL_MS     = 60000;
  var DEBOUNCE_MS = 20000;    // 宿主另外呼叫 check() 時的節流（Portal 的鈴鐺會呼叫）

  var TX = {
    'en': {
      who:   '{who} invited you to a live chat',
      cta:   'Enter the chat room',
      later: 'Later',
      more:  '{n} more invitation(s)',
    },
    'zh-TW': {
      who:   '{who} 邀請你加入線上對話',
      cta:   '進入對話室',
      later: '稍後再說',
      more:  '還有 {n} 則邀請',
    },
    'zh-CN': {
      who:   '{who} 邀请你加入线上对话',
      cta:   '进入对话室',
      later: '稍后再说',
      more:  '还有 {n} 则邀请',
    },
    'vi': {
      who:   '{who} đã mời bạn vào cuộc trò chuyện',
      cta:   'Vào phòng trò chuyện',
      later: 'Để sau',
      more:  'Còn {n} lời mời nữa',
    },
    'ja': {
      who:   '{who} さんがオンライン会話に招待しました',
      cta:   '会話ルームに入る',
      later: 'あとで',
      more:  'ほかに {n} 件の招待',
    },
  };

  var started   = false;
  var timer     = null;
  var lastAt    = 0;
  var lastRows  = [];
  var seen      = {};      // 這次載入按過 ✕ 的，避免下一輪輪詢又冒出來
  var busy      = false;

  // ── 小工具 ──────────────────────────────────────────
  function sess() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.empId) return null;
      if (s.expires && Date.now() > s.expires) return null;
      return s;
    } catch (e) { return null; }
  }
  function lang() {
    try { var l = localStorage.getItem(LANG_KEY); return TX[l] ? l : 'zh-TW'; }
    catch (e) { return 'zh-TW'; }
  }
  function T(k) { return (TX[lang()] || TX['zh-TW'])[k] || k; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // notifications.to_user 不受 sb-proxy 保護，任何持有 session 的人都能寫一列進來、
  // link 內容完全由他決定，而那個值會進 onclick 屬性 → 一律過白名單
  // （涵蓋 uid() 的 base36 與 uuid 的連字號）
  function safeId(v) {
    return /^[A-Za-z0-9_-]{1,64}$/.test(String(v || '')) ? String(v) : '';
  }
  // 收件身分：寫入端可能以 nameEn／nameZh／empId 任一為 to_user
  // （同 Portal 的 _notifFilter，那個不一致修過一次，這裡不要只比對工號）
  function filterQs(s) {
    var ids = [], seenId = {};
    [s.nameEn, s.nameZh, s.empId].forEach(function (v) {
      if (v && !seenId[v]) { seenId[v] = 1; ids.push(v); }
    });
    return 'or=(' + ids.map(function (v) {
      return 'to_user.eq."' + String(v).replace(/"/g, '') + '"';
    }).join(',') + ')';
  }
  function hdrs(s) { return { 'x-session': s.sig || '', 'Content-Type': 'application/json' }; }

  // Portal 在根目錄，子系統在一層子目錄底下 → 算出回 Portal 的相對路徑。
  // 用相對路徑而非絕對路徑：絕對路徑會讓 file:// 開檔的開發方式失效。
  function portalPath() {
    var segs = String(location.pathname || '/').replace(/^\/+|\/+$/g, '').split('/');
    return (segs.length - 1) > 0 ? '../index.html' : './index.html';
  }

  // ── 樣式（只注入一次）────────────────────────────────
  var CSS = ''
    + '.cmi-stack{position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:2147483000;'
    +   'display:flex;flex-direction:column;gap:10px;width:min(520px,calc(100vw - 24px));pointer-events:none;'
    +   'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Microsoft JhengHei",sans-serif;}'
    + '.cmi{pointer-events:auto;display:flex;align-items:flex-start;gap:14px;padding:16px 18px;'
    +   'background:#141924;border:1px solid #2D7FF9;border-left:5px solid #2D7FF9;border-radius:14px;'
    +   'box-shadow:0 14px 40px rgba(0,0,0,.5);cursor:pointer;animation:cmiIn .28s ease;}'
    + '.cmi:hover{background:#1a2130;}'
    + '.cmi-ico{font-size:30px;line-height:1.1;flex-shrink:0;}'
    + '.cmi-tx{flex:1;min-width:0;}'
    + '.cmi-who{font-size:14px;font-weight:500;color:#9AA6BC;margin-bottom:4px;}'
    + '.cmi-title{font-size:18px;font-weight:700;color:#E8ECF4;line-height:1.35;word-break:break-word;}'
    + '.cmi-cta{font-size:13px;font-weight:600;color:#5B9BF9;margin-top:8px;}'
    + '.cmi-x{flex-shrink:0;background:transparent;border:none;color:#6B7689;font-size:15px;'
    +   'cursor:pointer;padding:2px 4px;line-height:1;}'
    + '.cmi-x:hover{color:#E8ECF4;}'
    + '.cmi-more{pointer-events:auto;text-align:center;font-size:12px;color:#9AA6BC;'
    +   'text-shadow:0 1px 3px rgba(0,0,0,.6);}'
    + '@keyframes cmiIn{from{opacity:0;transform:translateY(-10px);}to{opacity:1;transform:translateY(0);}}'
    + '@media(max-width:768px){.cmi-stack{top:calc(env(safe-area-inset-top) + 62px);width:calc(100vw - 20px);}'
    +   '.cmi{padding:14px;border-radius:12px;}.cmi-title{font-size:16px;}.cmi-ico{font-size:26px;}}';

  function ensureDom() {
    if (!document.getElementById('cmi-style')) {
      var st = document.createElement('style');
      st.id = 'cmi-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var box = document.getElementById('cmi-stack');
    if (!box) {
      box = document.createElement('div');
      box.id = 'cmi-stack';
      box.className = 'cmi-stack';
      document.body.appendChild(box);
    }
    return box;
  }

  // ── 畫卡片 ──────────────────────────────────────────
  function render(rows) {
    var box = ensureDom();
    var list = (rows || []).filter(function (n) { return !seen[n.id]; });
    if (!list.length) { box.innerHTML = ''; return; }
    var show = list.slice(0, SHOW);
    var html = show.map(function (n) {
      var nid = safeId(n.id);
      var lk  = String(n.link || '');
      var sid = lk.indexOf('#lc/') === 0 ? safeId(lk.slice(4)) : '';
      // title／body 是別人打的字，一律跳脫（儲存型 XSS 防護）
      return '<div class="cmi" onclick="ComartInvite.enter(\'' + nid + '\',\'' + sid + '\')">'
        + '<div class="cmi-ico">💬</div>'
        + '<div class="cmi-tx">'
        +   '<div class="cmi-who">' + esc(T('who').replace('{who}', n.from_user || '')) + '</div>'
        +   '<div class="cmi-title">' + esc(n.body || '') + '</div>'
        +   '<div class="cmi-cta">' + esc(T('cta')) + ' ›</div>'
        + '</div>'
        + '<button class="cmi-x" title="' + esc(T('later'))
        +   '" onclick="event.stopPropagation();ComartInvite.dismiss(\'' + nid + '\')">✕</button>'
        + '</div>';
    }).join('');
    if (list.length > show.length)
      html += '<div class="cmi-more">' + esc(T('more').replace('{n}', String(list.length - show.length))) + '</div>';
    box.innerHTML = html;
  }

  // ── 查未讀邀請 ──────────────────────────────────────
  async function check(force) {
    if (!started) return;
    var now = Date.now();
    if (!force && now - lastAt < DEBOUNCE_MS) return;   // 宿主也會呼叫，節流免得一分鐘打兩次
    var s = sess();
    if (!s) { lastRows = []; render([]); return; }       // 登出／逾期就把卡片收掉
    if (busy) return;
    busy = true;
    lastAt = now;
    try {
      var qs = encodeURI(filterQs(s)) + '&type=eq.chat_invite&is_read=eq.false'
             + '&order=created_at.desc&limit=10';
      var res = await fetch(SB_URL + '/supabase/rest/v1/notifications?' + qs, { headers: hdrs(s) });
      if (!res.ok) return;                              // 讀失敗保持現狀，不要清掉已經畫出來的卡片
      var rows = await res.json();
      if (!Array.isArray(rows)) return;
      lastRows = rows;
      render(rows);
    } catch (e) {
      // 靜默：這是背景輪詢，網路差一次不該在畫面上留下錯誤
    } finally { busy = false; }
  }

  async function markRead(notifId, s) {
    try {
      await fetch(SB_URL + '/supabase/rest/v1/notifications?id=eq.' + encodeURIComponent(notifId),
        { method: 'PATCH', headers: hdrs(s), body: JSON.stringify({ is_read: true }) });
    } catch (e) { /* 沒寫進去下一輪還會再出現，是可接受的失敗方向 */ }
  }

  // ── 對外 ────────────────────────────────────────────
  window.ComartInvite = {
    // 宿主在「session 已就緒、畫面已真的進到系統裡」時呼叫一次
    start: function () {
      if (started) { check(true); return; }
      started = true;
      check(true);
      timer = setInterval(function () { check(true); }, POLL_MS);
      // 回到前景立刻補查：「我邀請你了 → 對方切回這個分頁」就是即時的
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) check(false);
      });
    },
    stop: function () {
      started = false;
      if (timer) { clearInterval(timer); timer = null; }
      var box = document.getElementById('cmi-stack');
      if (box) box.innerHTML = '';
    },
    // 宿主想在自己的時機補查（例如 Portal 的鈴鐺剛把某則標成已讀）
    check: function (force) { check(force === true); },
    // 切換語言後重畫（用上一次查到的資料，不再打一次請求）
    relabel: function () { if (started) render(lastRows); },

    enter: async function (notifId, sessionId) {
      var s = sess();
      if (notifId) seen[notifId] = true;
      render([]);                                  // 先收掉，連點兩下不會開兩次
      if (notifId && s) await markRead(notifId, s);
      if (!sessionId) return;
      // Portal 有 lcGoto ＝ 站內導覽；其他子系統導回 Portal 帶 ?lc=
      // （五個系統同源共用 session，所以不必帶 _ps）
      if (typeof window.lcGoto === 'function') { window.lcGoto(sessionId); return; }
      location.href = portalPath() + '?lc=' + encodeURIComponent(sessionId);
    },

    // ✕ 也算「看過了」：卡片本身就是通知，收掉它不該讓同一則明天再跳一次。
    // 內容仍在鈴鐺的「查看已讀」裡找得到。
    dismiss: async function (notifId) {
      if (!notifId) return;
      var s = sess();
      seen[notifId] = true;
      render(lastRows);
      if (s) await markRead(notifId, s);
    },
  };
})();
