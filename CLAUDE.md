# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 語言設定

**所有回覆請使用繁體中文。** 程式碼、變數名稱、API 路徑等技術內容維持原文，但說明文字、錯誤分析、操作步驟一律以繁體中文撰寫。

## Project Overview

COMART Platform is an internal corporate portal for COMART Corporation, deployed as a static site at **platform.comart.com.tw** (GitHub Pages via CNAME). There is no build system — all code is plain HTML/CSS/JavaScript edited and committed directly.

## Architecture

### Single-File Application Pattern

Each sub-application is one self-contained HTML file with all CSS, JS, and HTML inlined. Files grow large (~5,000–8,000 lines). There is no bundler, no module system, and no package.json.

| File | Version | Purpose | ~Lines |
|------|---------|---------|--------|
| `index.html` | v1.67 | Main portal — login, home, directory, bulletin, calendar, AI tools | 4,394 |
| `admin/index.html` | v2.30 | Admin System — room booking, fleet, visitor, library, lottery | 5,650 |
| `kms/index.html` | v2.33 | Knowledge Management System — RAG, document editor, AI Q&A | 7,120 |
| `quotation/index.html` | v3.54 | Quotation & CRM system | 7,332 |
| `board/index.html` | v1.28 | 公告與紀錄 Bulletin & Records — 公告、週會紀錄、業務會議記錄、Woody 週報、事前驗屍 | 2,934 |

`admin/lottery.html` is a standalone lottery page (separate from the lottery module inside `admin/index.html`).

Numbered backup files (`index112.html`, `index328.html`, etc.) are iteration snapshots. They are untracked by git (`.gitignore` excludes nothing — these are just leftover drafts).

### Navigation & Routing

**Within `index.html`**: `switchView(name)` shows/hides `<div id="view-{name}">` panels.

**Opening sub-apps**: `openApp(id)` navigates to the sub-app HTML file, passing the session via URL parameter `?_ps=<base64-JSON>` since localStorage cannot be shared cross-origin.

**Within `admin/index.html`**: `switchMod(m)` activates modules — `'room'`, `'car'`, `'visit'`, `'lib'`, `'lottery'`.

**Within `board/index.html`**: `switchTab(name)` activates 主頁籤 — `'bulletin'`、`'weekly'`、`'biz'`、`'woody'`、`'premortem'`。Portal 端由 `index.html` 的 app 清單項目 `id:'bulletin'`（`path:'./board/index.html'`）進入。

### Backend Stack

**Supabase** (PostgreSQL + pgvector) at `https://tcvlnpgpuphdalzvmoyo.supabase.co`:
- Primary database for users, KMS documents, admin data
- KMS uses pgvector for semantic search embeddings
- Anon key (publishable): `sb_publishable_rAVwVeUMWD-m_VTFIenMhg_Fcg6ocYJ`

**資料代理 = Supabase Edge Function `sb-proxy`**（2026-07-08 起）。前端所有資料讀寫與檔案上傳都指向
`https://tcvlnpgpuphdalzvmoyo.supabase.co/functions/v1/sb-proxy`，介面沿用舊格式 `/supabase/rest/v1/<table>`
與 `/supabase/storage/v1/...`（前端常數名仍叫 `SB_WORKER`/`workerUrl`/`SB_KMS_WORKER`，但值已是 sb-proxy）。
- ⚠️ **舊的 Cloudflare Worker `comart.mcsewoody.workers.dev` 已停用**：它在中國被 GFW 封鎖，且是「用前端可見的
  `x-admin-token` 就取得 service-role 全權」的後門、原始碼不在本 repo 無法修補。**不要再把任何呼叫指回 workers.dev。**
- sb-proxy 護欄：40 張表白名單（新增表要加進 `ALLOWED_TABLES`）、回應一律移除 `users.pwd_hash` 與
  `kms_documents.body`、寫入 users 剝除 pwd_hash、storage 走二進位轉發。
- 🔐 **驗證模型（2026-07-20 起）**：所有 sb-proxy / kms-write / claude-proxy / embed-* 請求必須帶
  **`x-session` 標頭**（登入時 auth-verify 簽發的 HMAC 簽章 token，前端存在 session 物件的 `sig` 欄位）。
  `users`/`departments`/`sites` 的寫入僅限簽章內 role=admin；一般使用者僅可 PATCH 自己那筆 users 的
  個人資料欄位（`SELF_PATCH_FIELDS` 白名單）。**舊的固定 `x-admin-token`（COMART-ADMIN-2026）已全面廢除，
  不要在任何新程式碼使用**。前端 helper：Portal `sbHdrs()`、admin `sbHdrs()`、kms `kmsSig()`、quotation `qtHdrs()`/`qtSig()`、board `sbHdrs()`（配 `SB.get/post/patch/del` 包裝）。

**Firebase**: 已完全移除（2026-07 確認四個 HTML 皆無 firebase 引用）。通知與站內訊息走 Supabase 輪詢（通知 60 秒、訊息 10 秒增量）。

**Supabase Edge Functions** (Deno, in `supabase/functions/`)：
- **所有 functions 一律以 `--no-verify-jwt` 部署**（config.toml 已全數固化 `verify_jwt = false`；
  漏帶旗標會造成全站 401，2026-07-20 曾發生）
- `sb-proxy` — 通用資料代理（取代 Cloudflare Worker），驗 `x-session` 簽章
- `auth-verify` — 伺服器端密碼驗證（PBKDF2，相容舊 SHA-256）+ 簽發 HMAC 簽章 session（`login`/`setPassword`/`adminSetPassword`）。**密碼驗證只在此進行，pwd_hash 永不回前端**
- `kms-secure-docs` — KMS 機密文件依「簽章驗證過的真實角色」過濾（`list`/`get`/`searchVector`/`searchKeyword`），機密等級在 SQL 層強制
- `kms-write` — service-role writes to KMS tables（驗 body.session 簽章）；allowed: `kms_documents`,`kms_doc_versions`,`kms_comments`,`kms_review_log`,`kms_experts`,`kms_product_lines`,`kms_search_log`,`kms_snapshots`,`kms_categories`
- `claude-proxy` — forwards to Anthropic API（驗 `x-session`）; `CLAUDE_API_KEY` from Secrets。
  **`body.stream === true` 時直接轉發上游 SSE**（不做 `res.json()`）：長輸出若等 Anthropic 全部產完才回應，
  會被 gateway 判逾時回 **504**（2026-08-08 board v1.33 實際踩到）。長分析一律走串流
- `embed-document` / `embed-query` — pgvector embeddings for RAG（驗 `x-session`）
- `holidays-proxy` — holiday calendar API proxy
- Secrets：`SESSION_HMAC_SECRET`（session 簽章密鑰，只有 edge function 讀得到）、`SB_SERVICE_ROLE_KEY`、`CLAUDE_API_KEY` 等

### Authentication & Session

- Custom auth：員工編號（如 `A00001`）+ 密碼，**驗證只在 `auth-verify` edge function（伺服器端）進行**，前端不再自行雜湊比對（2026-07 資安改造）。密碼存 `users.pwd_hash`：新密碼 PBKDF2（`pbkdf2$…` 格式），舊帳號仍是 SHA-256+固定鹽值（相容期，一經改密碼即轉 PBKDF2）。**pwd_hash 已不對前端／sb-proxy 開放讀取**
- 登入成功後 `auth-verify` 簽發 HMAC 簽章 session token，前端存在 SESSION 物件的 `sig` 欄位，隨 `?_ps=` 傳給子系統，供 `kms-secure-docs` 等驗證真實角色
- `users.must_change_pwd`：全員已標記，下次登入 Portal 強制改密碼才能進入
- Session stored in `localStorage` key `comart-portal-session` as JSON with expiry
- Roles: `admin`, `dcc`, `user` — admin role gates user management and destructive operations。**角色判斷若涉及敏感資料，必須經 edge function 的 `verifySession()` 驗證，不能只信前端 role 欄位（可偽造）**
- Sub-apps read session from URL `?_ps=` on load, then persist to their own localStorage key

### KMS / RAG Architecture

KMS (`kms/index.html`) implements RAG (Retrieval-Augmented Generation):
1. Documents uploaded and parsed (Word via mammoth.js, Excel via SheetJS, PPTX via JSZip, CSV via PapaParse)
2. Text chunked and embedded via `embed-document` edge function → stored in `kms_documents.embedding` (pgvector)
3. Queries embedded via `embed-query` edge function → cosine similarity + keyword scoring for retrieval
4. Retrieved context passed to Claude API via `claude-proxy` edge function for Q&A
5. Rich text editing via TipTap (loaded dynamically from esm.sh)

### Design System

All apps use a dark theme with CSS custom properties. Two slightly different palettes:
- **Portal + Quotation + Board**: `--bg:#080C14`, accent `--ac:#2D7FF9`, fonts: DM Sans / DM Serif Display / DM Mono
- **Admin + KMS**: `--bg:#0f1117`, accent `--blue:#5b9bd5`, fonts: Segoe UI / PingFang TC

Board 的列印／匯出版面（`.sheet`）刻意反轉為白底黑字（PingFang TC），供 PDF／PNG／Email 輸出使用。

Responsive breakpoint at 768px: desktop shows sidebar, mobile shows bottom nav. Safe-area insets are handled for iOS.

### Multi-language Support

The portal supports EN, 繁中, 简中, VI, 日 via `setLang(lang)`. Each language has a full i18n dictionary stored as a JS object in the HTML file. KMS and admin have their own i18n dictionaries.

## 系統架構

- **Platform** (`/`) — 入口門戶，`index.html`
- **Admin** (`/admin`) — 行政管理平台
- **KMS** (`/kms`) — 知識管理系統
- **Quotation** (`/quotation`) — 報價系統
- **Board** (`/board`) — 公告與紀錄（2026-07 由 Portal 公告欄獨立出來，Portal v1.65 changelog 有記載）

## 技術棧

- 純 HTML + CSS + JavaScript，單一 HTML 檔案
- Supabase 資料庫（專案 ID: `tcvlnpgpuphdalzvmoyo`）+ Edge Functions（資料代理、密碼驗證、機密文件、RAG）
- Supabase anon key: `sb_publishable_rAVwVeUMWD-m_VTFIenMhg_Fcg6ocYJ`
- 資料代理：`sb-proxy` edge function（`.../functions/v1/sb-proxy`）。~~Cloudflare Worker `comart.mcsewoody.workers.dev`~~ 已停用（中國被封 + 安全後門，2026-07-08 淘汰）
- Firebase：已移除，不再使用
- 部署: GitHub Pages → platform.comart.com.tw

## 版本規則

- **五個系統（Portal、Admin、KMS、Quotation、Board）每次修改版本號都 +0.01**，無例外
- 版本號同步更新（有幾處就改幾處）：`<title>`、`.login-sub`、topbar 版本顯示
  - Portal/Admin/KMS：`<title>` + `.login-sub` + topbar `<span>`
  - Quotation：`<title>` + topbar `#appVersionDiv`（沒有自己的登入畫面／`.login-sub`）
  - Board：`<title>` + topbar `.logo-ver`（沒有自己的登入畫面，session 只從 `?_ps=` 取得）
- 每次修改後自動 commit 並 `git push`，不需等候使用者指示
- **每次修改完畢，回覆結尾必須告知目前各檔案最新版本號**（例如：`kms v2.06`、`admin v1.57`）

## Admin 重要細節

- `cancelCarBk(id)` 公務車取消，`cancelBk(id)` 會議室取消，**不可混用**
- localStorage 只是快取，正本在 Supabase
- 五大模塊順序：公務車 → 圖書館 → 會議室 → 客戶到訪 → 抽籤

## Board 重要細節

`board/index.html`（公告與紀錄，v1.28）五個頁籤，各自一組前綴命名的函式與 Supabase 表：

| 頁籤 | 前綴 | 主要資料表 |
|------|------|-----------|
| 公告 | `bb*` | `portal_bulletin`、`notifications`（逐人通知） |
| 週會紀錄 | `wm*` | `weekly_minutes` |
| 業務會議記錄 | `bm*` | `biz_meeting_minutes` |
| Woody 週報 | `wr*` | `woody_reports` |
| 事前驗屍 | `pm*` | `premortem_sessions`、`premortem_entries`、`premortem_mitigations` |

**事前驗屍 Premortem**（Gary Klein 方法，v1.21 起分階段開發，v1.28 完成）：
- 階段機（`PM_PHASES`）：`intro` 說明 → `setup` 情境設定 → `writing` 開放填寫 →
  `reveal` 揭露 → `ranking` 排序分類 → `mitigation` 對策 → `locked` 定稿
  - **必須依序進行**（v1.44，`pmCanGoPhase`）：往前只能走一步，往回不限。
    否則開場就能直接按定稿，產生一場沒有任何內容的「已定稿」紀錄。
    不可到達的階段鈕會 `disabled` 變灰
- **建會時登錄會議基本資訊**（v1.39，migration 031）：會議日期／時間（`meet_at`，自動帶入建會當下的
  **當地時間**）、會議地點（`meet_location`）、主席（自動帶入，唯讀）、與會人員（`attendees`，自由文字）。
  會議室頂端、清單列、四種輸出都會顯示
  - `meet_at` 刻意存 **text（'YYYY-MM-DD HH:mm' 當地時間）而非 timestamptz**：主席填的是當地時間，
    存 text 就不會有 UTC 換算導致顯示差 8 小時的問題；此格式字典序＝時間序，排序照樣正確。
    **產生 datetime-local 的預設值不可用 `toISOString()`**（那是 UTC），要用 `pmNowLocal()`
  - `attendees`（紀錄用的與會名單，自由文字）與 `scope_members`（決定誰打得開這場會議的權限範圍）是兩件事；
    建會表單有「＋ 帶入指定人員」（`pmFillAttendees`）把勾選的人附加進來並去重，列席者仍可手動補打
  - 對策期限預設改以 `meet_at` 為基準（沒填才退回 `created_at`）
  - **資訊卡只在 `intro`（開場）與 `locked`（定稿）出現**（v1.41）：中間的進行過程用不到，只佔畫面。
    主席在這兩個階段可按「✎ 修改」改日期／地點／與會人員（`pmSaveMeetInfo`）；主席欄位固定為開場者不可改
  - `setup` 階段頂端卡片**不顯示**專案描述／情境（下方已有可編輯的同一套資訊，不要出現兩份）
  - `datetime-local` 欄位一律加 `class="pm-dt"`：只有 `color-scheme:light`（讓**彈出的挑選器面板**亮白），
    輸入框本身沿用深色配色；代價是日曆圖示變深色看不見，故 `::-webkit-calendar-picker-indicator` 用
    `filter:invert(1)` 反白
- 🔴 **主席＝開場的那一個人，`pmIsChair()` 只認 `chair_emp_id`，絕對不要在裡面加 `isAdmin()`**（v1.31）。
  admin 在驗屍會議裡就是一般與會者：不能控制階段（只看到唯讀 badge）、看不到填寫人姓名、
  不能改情境／譯文、不能新增或刪除對策。唯一保留給 admin 的是清單上的「刪除整場會議」（資料治理，不在會議室內）；
  **這條在 sb-proxy 也擋了**（`DELETE premortem_sessions` 需 role=admin）——一場會議被刪會 cascade
  帶走 entries/mitigations，比覆寫更嚴重
- 🔴 **填寫者姓名一律不顯示，連主席也不顯示**（v1.43）：事前驗屍靠匿名換誠實，主席若看得到誰寫了哪一條，
  與會者就會自我審查。`pmEntryHtml()` 已無 `showAuthor` 參數，**不要把 author_name 加回畫面**
  （DB 仍存 `author_emp_id`，供「只看得到自己填的」「刪自己填的」與必要時的後台稽核）
  - 主席改看 `pmSubmittedHtml()` 的「已填／未填名單」催填。**3 人門檻對兩份名單都要套用** ——
    名單是互補的，5 人裡列出 4 個未填，等於指名剩下那 1 人就是即時彙整裡那些內容的作者
  - 「✎譯」按鈕原本綁在 `showAuthor` 上，已改綁 `bilingual && pmIsChair()`；**動這裡要順便確認它還在**
- 投票只顯示票數，畫面上從不顯示投票人；PDF／PNG／Excel／Email 四種輸出都不含姓名
- 填寫階段**範圍內所有人（含主席）都可填寫**（v1.23 決定，別再改回只有成員可填）
- 投票上限 `PM_VOTE_CAP = 3`（排序階段）
- 雙語：每則失敗原因寫入後自動經 `claude-proxy` 翻成會議設定的兩種語言，存 `text_a`/`text_b`
  （情境與專案說明同理存 `desc_a`/`desc_b`、`scenario_a`/`scenario_b`）。**已翻譯過的不重翻**
- `setup` 階段主席可雙語編輯專案描述與情境（`PM_BI_FIELDS` + `pmBiEditorHtml`/`pmSaveBiField`，v1.29–v1.30）：
  改任一語言就自動翻另一語言，親手輸入的那一邊原文照留不回譯
- 對策的「重點風險」是**下拉挑選高票失敗原因**（v1.28），風險文字與雙語直接沿用該原因，不再重翻
- 對策期限預設 `pmDefaultDue()` ＝**會議日期（`created_at`）＋14 天**；對策清單雙語上下並排、中間 `---------` 分隔線（v1.31）
- **定稿（`locked`）會自動產生「AI 評論與總結」**（v1.33，`pmGenSummary` + `PM_SUM_PARTS`）：直接／深刻／嚴厲／
  不留情面、**字數不限**的雙語分析，分三部分 —— ① AI 補充與會者沒想到的失敗原因 ② 逐條挑戰並補強對策
  ③ 彙整全場的會議結論。存進 `premortem_sessions.ai_summary` / `ai_summary_a` / `ai_summary_b` / `summary_at`
  （migration 029），未來可查
  - 🔴 **必須走串流 `pmClaudeStream()`**（v1.34）：非串流時 claude-proxy 要等 Anthropic 全部產完才回應，
    長分析必逾時 **504**。不要為了省事改回 `pmClaude()`
  - 🔴 **深度分析只做一次（語言 A），語言 B 是翻譯（`pmTranslateLong`）不是重新發想**（v1.36 修正）。
    v1.34 讓兩個語言各自重新發想，結果慢一倍、而且**兩個版本會講出不同的風險與不同的結論**——
    同一場會議不該有兩種結論。翻譯用 opus-5 但 `output_config.effort='low'`（翻譯不需要深度推理），
    譯者提示詞明令「保留原文語氣強度，不得把批判翻得比原文客氣」；單段翻譯失敗就退回原文，不讓整份掉失
  - 流程（v1.38）：每段分析完**立刻**把譯文丟到背景，與下一段的分析重疊進行，三段寫完只等剩下的譯文。
    分析與翻譯會同時想寫回，故存檔走 `pmSumSaveQ()` 佇列序列化（組稿在執行時才做，較舊的內容不會蓋掉較新的）
  - **篇幅**：每個部分約 350–500 字（`PM_SUM_SYS`，尾端另有 `<tone_preference>` 提醒）。
    opus-5 天生寫得長，且**降 effort 不能可靠縮短輸出**——篇幅只能靠提示詞控制
  - 畫面排版用 `pmSumDocHtml()`／`pmSumSections()`：依標題把長文切回三段、段間虛線、語言分區塊並標籤。
    主席若把標題改掉會退化成單一區塊（不會壞）
  - 段落小標存在 `PM_SUM_PARTS[].disp`（五語對照），`pmSumAssemble()` 依該版本語言挑選，
    否則越南文版會夾著中文小標
  - 這是唯一用 **`claude-opus-5`** 的地方（`PM_SUM_MODEL`）：三段分析與其譯文都用它，
    其餘（`pmTranslate` 的條目／情境翻譯、`pmAiCluster` 分群）仍用 haiku。opus-5 預設開 thinking 且
    `max_tokens` 同時涵蓋 thinking＋回覆，單段給 8000
  - 先鎖定再背景生成，AI 失敗不會卡住定稿；生成中暫停輪詢（否則會把剛寫好的總結蓋回 null）；主席可「↻ 重新生成」
  - **定稿後主席可「✎ 編輯」修訂這段結論**（v1.35，`pmSumEditToggle`/`pmSaveSummaryEdit`）：雙語各一個大 textarea，
    存檔時寫 `summary_edited_at` / `summary_edited_by`（migration 030），畫面與四種輸出都會標示「已由主席（○○）修訂」
    —— AI 產出的正式紀錄若無法分辨是否被人改過，日後追溯就失去意義。**「↻ 重新生成」會把修訂軌跡清成 null**
    （那是全新的 AI 產出）。編輯中暫停輪詢，免得把主席正在打的字弄掉
  - 四種輸出都含這段；PDF 的雙語表格 `td` 必須保留 `white-space:pre-wrap`，否則分段長文會塌成一團
  - 🔐 **兩層寫入防護**（v1.43）：
    ① `premortem_summary_audit` trigger（migration 032）—— `ai_summary` 每次被改動就把舊版存進
    `premortem_summary_log`。**trigger 不會被 service_role 繞過**（RLS 會），這是前端與代理都繞不過的一層。
    該 log 表**刻意不在 sb-proxy 的 `ALLOWED_TABLES`**：稽核紀錄不該能被應用程式讀取或刪除，只能從後台查
    ② sb-proxy 欄位守衛 —— PATCH `premortem_sessions` 若含 `ai_summary*`／`summary_*`／`phase`，
    必須是該場主席本人（比對簽章 empId 與 `chair_emp_id`）；`chair_emp_id`／`created_by` 完全禁改；
    取不到 `?id=eq.<id>` 一律拒絕（不猜其他 filter 的語意），查詢失敗也拒絕（fail-closed）
- 多人同步靠輪詢：`pmPollStart()` 每 7 秒抓一次 phase 與 entries；離開頁籤即 `pmPollStop()`
- 定稿可輸出四種格式（PDF／PNG／Excel／Email），皆為雙語版面

新增 `premortem_*` 之類的新表時，記得同步加進 sb-proxy 的 `ALLOWED_TABLES` 白名單，否則前端一律 403。

## Development Workflow

**Editing**: Open the relevant HTML file directly in an editor. There is no dev server needed — open the file in a browser or use a simple HTTP server.

**Deploying**: `git push` to `main` — GitHub Pages auto-deploys from the root of the repository.

**Supabase Edge Functions** (when editing functions in `supabase/functions/`):
```bash
# Deploy a single function
supabase functions deploy claude-proxy --project-ref tcvlnpgpuphdalzvmoyo

# Local dev (requires supabase CLI)
supabase start
supabase functions serve claude-proxy
```

**Versioning**: Increment the version number manually in the HTML `<title>` tag and topbar text when making significant changes. The git commit message follows the pattern `v1.XX - 描述`.
