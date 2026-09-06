/* ═══════════════════════════════════════════════════════════════════════
   COMART 共用翻譯規則  shared/translate.js
   Portal（線上對話）與 Board（會議紀錄／驗屍／腦力激盪／意見徵集）共用這一份。

   🔴 **為什麼一定要共用：因為各存一份已經被證實會分岔。**
      2026-09-05 把 Board 的 PM_TR_RULES 複製到 Portal 成為 LC_TR_RULES，
      **一天之內就不一樣了** —— Portal 那份掉了兩處：
        · 「pick one consistent register **for the whole text**」的 for the whole text
        · 「**and never mix registers within one text**」整句
      而那正是越南同仁最初反映「譯文怪」的根因（一篇之內人稱不一致）。
      也就是 CLAUDE.md 早就寫下的那句：**分岔之後寬鬆的那一份就是實際生效的那一份。**
      這份檔案就是為了讓那件事不再發生。

   🔴 **改規則只改這裡一個地方。** 呼叫端只組裝前後文（場景描述與輸出格式），
      規則正文一律取 ComartTranslate.RULES，不要在任何 HTML 裡另存一份。

   🔴 **載不到就必須大聲失敗，不可以無聲降級。** 少了規則的翻譯仍然「跑得動」，
      只是人稱與語氣會失控 —— 那種壞法沒有人會注意到，比整個壞掉更糟。
      呼叫端用 ComartTranslate.requireRules() 取值，載入失敗時它會丟例外。

   🔴 改這個檔案時，所有載入它的 HTML 的 ?v= 都要 +1（GitHub Pages 快取 4 小時）。
      目前載入者：index.html（Portal）、board/index.html。
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var T = { VERSION: '1.0' };

  /* 規則正文。這是 Board 版（完整版）的逐字內容 —— Portal 那份較弱的已廢除。
     最重要的是人稱與語域那一條：中文與英文的「你／他」不帶年齡與位階資訊，
     越南語卻**必須**選一個（bạn／anh／chị／em），譯者不選就是亂選，
     而一篇之內不一致讀起來就會「怪」。
     ⚠️ 這是換翻譯廠商（DeepL 等）解決不了的部分 —— 那些引擎無法被下指令。 */
  T.RULES =
    '- Faithful, not literal. Produce what a fluent native speaker would actually write, ' +
    'not a word-by-word rendering. Never omit or add content.\n' +
    '- Preserve tone strength exactly. Do not soften criticism, and do not inflate warmth or ' +
    'add pleasantries the original does not contain.\n' +
    '- Keep unchanged: personal names, company and product names, model numbers, employee IDs, ' +
    'system names (TIPTOP, PLM, ERP...), English acronyms, numbers, dates and units.\n' +
    '- Preserve the original line breaks and paragraph structure.\n' +
    '- Person reference: Chinese and English do not encode the age/seniority information that ' +
    'Vietnamese pronouns require. When translating INTO Vietnamese, pick one consistent register ' +
    'for the whole text and stay with it. Default to the neutral collegial "ban" (bạn) for a peer ' +
    'addressed as you; use anh/chi only when the source clearly implies a senior colleague; ' +
    'use the person\'s own name where the source names them. Never invent honorifics the source ' +
    'does not imply, and never mix registers within one text.\n' +
    '- When translating INTO Chinese, do not add honorifics or pleasantries the source lacks.\n';

  // 取規則，載不到就丟例外（見檔頭說明：無聲降級比整個壞掉更糟）
  T.requireRules = function () {
    if (!T.RULES || T.RULES.length < 200) {
      throw new Error('shared/translate.js 未正確載入，拒絕在沒有翻譯規則的情況下送出請求');
    }
    return T.RULES;
  };

  /* 組裝系統提示詞。
       intro  ：場景描述（會議紀錄／即時聊天，各系統不同，這部分本來就該不同）
       extra  ：該系統額外的規則（例如聊天要求「短句保持短句」）
       output ：輸出格式指示（JSON／XML 標籤／純譯文，各處不同）
     只有 RULES 是共用的，前後文刻意留給呼叫端。 */
  T.sys = function (intro, extra, output) {
    return String(intro || '') + '\n\nRequirements:\n' + T.requireRules() +
           String(extra || '') + '\n' + String(output || '');
  };

  global.ComartTranslate = T;
})(typeof window !== 'undefined' ? window : globalThis);
