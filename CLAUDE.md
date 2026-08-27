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
| `admin/index.html` | v2.39 | Admin System — room booking, fleet, visitor, library, lottery | 5,650 |
| `kms/index.html` | v2.33 | Knowledge Management System — RAG, document editor, AI Q&A | 7,120 |
| `quotation/index.html` | v3.54 | Quotation & CRM system | 7,332 |
| `board/index.html` | v1.48 | 公告與紀錄 Bulletin & Records — 公告、週會紀錄、業務會議記錄、Woody 週報、事前驗屍、腦力激盪 | 4,600 |

`admin/lottery.html` is a standalone lottery page (separate from the lottery module inside `admin/index.html`).

Numbered backup files (`index112.html`, `index328.html`, etc.) are iteration snapshots. They are untracked by git (`.gitignore` excludes nothing — these are just leftover drafts).

### Navigation & Routing

**Within `index.html`**: `switchView(name)` shows/hides `<div id="view-{name}">` panels.

**Opening sub-apps**: `openApp(id)` navigates to the sub-app HTML file, passing the session via URL parameter `?_ps=<base64-JSON>` since localStorage cannot be shared cross-origin.

**Within `admin/index.html`**: `switchMod(m)` activates modules — `'room'`, `'car'`, `'visit'`, `'lib'`, `'lottery'`.

**Within `board/index.html`**: `switchTab(name)` activates 主頁籤 — `'bulletin'`、`'weekly'`、`'biz'`、`'woody'`、`'premortem'`、`'brainstorm'`。後兩者共用同一份 DOM（`#pm-shell`）與同一套 `pm*` 函式，切換時由 `pmMountShell()` 把 shell 搬進當前 tabpanel。Portal 端由 `index.html` 的 app 清單項目 `id:'bulletin'`（`path:'./board/index.html'`）進入。

**可分享的深層連結**（Portal v1.76 / Board v1.79，2026-08-17）：把某一場投票或紀錄的網址直接發給同事。

```
https://platform.comart.com.tw/board/index.html?tab=poll&id=<場次 id>
```

- **Board 端**：`BOARD_DEEP`（IIFE）**必須在 `readPortalSession()` 之前**把 `tab`／`id` 讀走 ——
  那裡成功取得 session 後會 `replaceState` 把網址參數整組清掉（避免 base64 session token
  留在網址列被複製出去），晚一步就什麼都讀不到。落點是 `boardOpenDeep()`：
  `switchTab()` 之後 poll 走 `plOpen(id)`、三種 `pm*` 會議走 `pmOpen(id)`
  （那些清單載入函式都是「先 `showView('list')`、之後才 await」，所以不會把房間蓋回去）。
- **沒有 session 不再是死路**：以前頁面打得開、右上寫「尚未登入」、所有請求 401，
  收到連結的人看到一片空白，連「請先登入」都不會說。現在 `boardGoLogin()` 導向
  `index.html?next=…`，登入後自動轉回來。
- **Portal 端**：`safeNext()` 驗證 → `goNext()` 帶 `_ps` 轉址；出口放在 **`enterPortal()`**，
  所以「已登入直接進來」「剛登入」「剛改完強制密碼」三條路徑共用同一個出口，
  **強制改密碼那一關繞不過**。
- 🔴 **`next` 一定要白名單驗證，這是 open redirect**：不驗證的話，
  `index.html?next=https://evil.com` 會讓 Portal 把 **base64 的 session token 當參數送到別人的網站**。
  `safeNext()` 只放行 `NEXT_PATHS` 四個子系統路徑，參數只留 `NEXT_PARAMS`（`tab`／`id`）
  且值限定 `[A-Za-z0-9_-]`；有 scheme、`//`、開頭 `/`、`..`、`\` 一律丟掉。
  **新增可深層連結的子系統時，加進 `NEXT_PATHS`，不要改成黑名單。**
- 分享網址本身**不含任何 session 資訊**（只有頁籤與場次 id），所以轉發不會外洩身分；
  🔗 複製連結因此開放給所有人，不限發起人。權限仍由 `plCanSee()`／`pmCanSee()` 判斷。
- Board 與 Portal **同源共用 `localStorage['comart-portal-session']`**，所以 Portal 只要在登入狀態，
  貼裸連結進 board 就直接能用。

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

**Firebase**: 已完全移除（**2026-08-23 起真的完全移除**）。通知與站內訊息走 Supabase 輪詢（通知 60 秒、訊息 10 秒增量）。

🔴 **這裡曾經寫錯，值得記住為什麼**：2026-07 的結論是「四個 HTML 皆無 firebase 引用」——那句話對**程式碼**是對的，
但 Firebase 的依賴不在程式碼裡，在**資料**裡。`products.img` 有 **289 筆（全部 319 筆的 91%）**指向
`comart-quotation.firebasestorage.app`，直到 2026-08-23 才搬完。
**「grep 不到引用」不等於「沒有依賴」** —— 存在資料庫欄位裡的網址是 grep 不到的。
下次宣告某個外部服務已移除前，要一起查資料表裡的網址欄位。

順帶暴露一個一直存在的使用者問題：報價系統畫面上的產品圖是 `<img src="${p.img}">` **直連圖床**（不走 sb-proxy），
而 Firebase 是 Google 網域、**在中國被 GFW 封鎖**，所以東莞廠原本有 91% 的產品圖是破的，
只有 PDF／Excel 匯出正常（那條路徑走 `?imgproxy=` 由伺服器代抓）。搬到 Supabase 後一併解決。

⚠️ **這個 Supabase 專案由 platform 與公司官網共用。** `supabase functions list` 會看到三個
本 repo 沒有的 function —— **`enquiry`／`translate`／`admin-users` 屬於官網**
（`www.comart.com.tw`／`comartgroup.github.io`，允許來源清單裡沒有 platform.comart.com.tw），
原始碼在官網的 repo。**不要把它們 download 進本 repo 版控**：那會製造出第二份會分岔的副本
（2026-08-23 差點做了）。改動它們要去官網那邊。

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

五個系統共用 `localStorage['comart-lang']`（值為 `en` / `zh-TW` / `zh-CN` / `vi` / `ja`），在任一系統切換語言，其他系統下次載入就跟著換。

**Board 的 i18n（v1.48）**：`B_I18N`（330 key × 5 語）＋ `BT(key, params)`，`{n}` 佔位。
靜態 HTML 用 `data-i18n` / `data-i18n-ph` / `data-i18n-title`，由 `bApplyI18n()` 套上；
動態渲染的字串直接呼叫 `BT()`。topbar 有 `.lchip` 語言鈕（`bSetLang`），切換後 `bRerenderAll()`
把五個頁籤各自重畫（業務會議在 IIFE 裡，靠 `window.MeetingMinutes.relabel()` 進去）。

- 🔴 **介面翻譯，正式紀錄的版面不翻**。這是刻意的取捨，不是漏做：
  - **翻**：頁籤、面板標題、欄位標籤、按鈕、提示、清單列、toast、confirm。
  - **不翻**：`.sheet` 即時預覽、PDF、PNG、Excel、Email 內文，以及寄給別人的 `notifications` 標題。
    那是公司的存檔格式，同一份紀錄不該因為誰按了匯出鍵、介面剛好切成哪一國語言就長得不一樣；
    而且內文本來就是使用者打的中文，只翻表頭會變成半中半外。
  - 因此有成對的存取器：介面走 `siteLabel()` / `bizScopeLabel()` / `PMT()` / `pmPhaseLabel()`，
    輸出與 AI 提示詞走 `siteLabelZ()` / `bizScopeLabelZ()` / `PMTZ()` / `PMKZ()`（固定繁中）。
    **新增輸出格式或改 AI 提示詞時，用 Z 版本。**
- 事前驗屍／腦力激盪：`PM_KINDS` 維持繁中＝文件詞彙；`PM_KIND_I18N` 只覆寫畫面上看得到的
  `label` / `phaseLabel` / `defaultScenario` / `t`。**三個行為旗標（`anonymous`／`liveVisible`／`voteCap`）
  與 `sumSys`／`sumParts`／`cluster`／`intro` 一律只從 `PM_KINDS` 取，不進 `PM_KIND_I18N`** ——
  那是行為與 AI 語氣，不是文案。加第三種會議時兩張表都要加（缺語言會自動退回繁中，不會壞）。
- migration 缺欄位的錯誤訊息（`migration 029/030/031`）刻意留繁中：那是給管理者看的，不是一般使用者路徑。

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
### 成本檔案（BOM 表）：私有 bucket ＋ sb-proxy 角色守衛（2026-08-23）

`products.bomFiles` / `products.docs` 的檔案存 **`product-private`**（`public=false`），路徑
`products/<pid>/bom/<timestamp>.<ext>`。存取一律經 sb-proxy 換 10 分鐘簽章網址（`openStoredFile()`）。

- 🔴 **bucket 設成 private 只擋外部匿名者，擋不住已登入的內部人**。sb-proxy 的 storage 轉發段用
  service_role **無條件轉發任何 `/storage/v1/` 路徑**，所以任何持有有效 session 的人（含 `role='user'`）
  都能直接要走私有檔案。守衛在 sb-proxy 的 `RESTRICTED_BUCKETS`：受限 bucket 的名字出現在路徑任何一段
  就重新查資料庫當下的 role，只放行 `admin`/`dcc`（`COST_ROLES`），停用／離職者一律拒絕。
  **兩層都要有，少一層等於沒做。**
- 🔴 **角色重新查資料庫，不讀簽章裡的 role**（同 `kms-secure-docs`）：簽章是登入當時簽發的，
  降權後舊 token 還在有效期內。角色分界比照報價系統既有規則（產品編輯器不開給 `user`），沒有另外發明。
- 🔴 **Supabase Storage 的物件鍵不接受非 ASCII**（實測：空白可以、`+` 可以、**中文不行**，回 400 InvalidKey）。
  原本上傳路徑是 `'…/bom/'+Date.now()+'_'+file.name`，而 BOM 檔名幾乎全是中文——**所以中文檔名的上傳一直
  在失敗**。物件鍵一律經 `_safeStorageKey()`（只有時間戳＋副檔名），顯示名稱存在 JSON 的 `name` 欄位。
- 🔴 **`_deleteStorageFile()` 原本永遠不刪**：守衛是 `if (!storagePath.includes('supabase')) return;`，
  而 Supabase 的 storagePath 長得像 `products/A/bom/123.xls`，不含 'supabase' —— 刪除鈕移除了資料庫紀錄，
  實體檔案卻永遠留在 Storage 上。已改為用 bucket 判斷，Firebase 舊檔明確跳過。
- 新程式碼**同時吃舊格式**（`url` 是完整 http 網址就直接開），所以前端可以先上線、資料庫後改，
  中間沒有任何時間點是壞的。加新的受限 bucket 時記得加進 `RESTRICTED_BUCKETS`。

- Firebase：已移除，不再使用。產品圖存 Supabase Storage 的 **`product-assets`** bucket，
  路徑 `products/<產品id>.<jpg|png|webp>`，`products.img`／`img2`／`img3` 存的是**公開網址字串**（不是圖片內容）。
  `sb-proxy` 的 `IMG_HOSTS` 白名單只剩 `tcvlnpgpuphdalzvmoyo.supabase.co`；
  **要再加圖床請確認它不是 Google 網域**，否則等於把中國封鎖那個坑挖回來
- 部署: GitHub Pages → platform.comart.com.tw

## 版本規則

- **五個系統（Portal、Admin、KMS、Quotation、Board）每次修改版本號都 +0.01**，無例外
- 版本號同步更新（有幾處就改幾處）：`<title>`、`.login-sub`、topbar 版本顯示
  - Portal/Admin/KMS：`<title>` + `.login-sub` + topbar `<span>`
  - Quotation：`<title>` + topbar `#appVersionDiv`（沒有自己的登入畫面／`.login-sub`）
  - Board：`<title>` + topbar `.logo-ver`（沒有自己的登入畫面，session 只從 `?_ps=` 取得）
- 每次修改後自動 commit 並 `git push`，不需等候使用者指示
- **每次修改完畢，回覆結尾必須告知目前各檔案最新版本號**（例如：`kms v2.06`、`admin v1.57`）

## 報價系統：僅限業務部（2026-08-25）

`dept='sales'`（業務部，19 位在職）**＋ 所有 admin**。目前 51 位在職者中 23 人進得去、28 人被擋。

- **admin 豁免是必要的**：有 4 位 admin 不在業務部（3 位 `management`、1 位空白部門 A00001）。
  系統管理者進不了自己管的系統通常是錯的。**`dcc` 不豁免** —— 那是文件管制角色，跟報價業務無關
  （因此有 2 位 dcc 被擋：`management` 與 `rd` 各一）。
- 🔴 **`writeSession()` 是逐欄位重建 SESSION 的，新增 session 欄位一定要加進去**（2026-08-25 踩過）。
  第一版把 `depts` 判斷加在 `canOpenApp()`，但 `writeSession()` 沒有 `dept` —— 登入時撈回來的
  `user` 物件有，寫進 localStorage 的那一份沒有。結果**全部 19 位業務部同事的卡片都消失**，
  只有 admin 看得到（admin 豁免在 dept 檢查之前，所以最容易察覺的人剛好不會察覺）。
  **「登入時那個變數有這個欄位」不等於「它活到 localStorage」。**
- 🔴 **舊 session 缺 dept 要放行，不是擋**：那是資訊缺失不是「不屬於任何部門」，
  當成拒絕理由會把全公司鎖到每個人重新登入為止。判斷用 `('dept' in s)`（有沒有這個鍵），
  不是判斷值真不真 —— 真的沒有部門的人是 `''`，那該擋，跟舊 session 是兩件事。
  `backfillSessionDept()` 在進 Portal 時即時補查，把空窗從「8 小時 session 壽命」縮到一次請求。
- 🔴 **報價系統有三條建立 `currentUser` 的路徑，三條都要擋**：portal session、`restoreSession`（F5）、
  `?_ps=`（從 Portal 進來，最常走的一條）。第一版只擋了第一條，所以「直接打網址進不去」
  對重新整理與從 Portal 點進來都不成立。
- **兩處都要改，規則必須一致**：Portal 的 `canOpenApp()`（`APPS` 條目加 `depts:['sales']`）
  與報價系統的 `_qtDeptAllowed()`。Portal 隱藏卡片，報價系統擋直接輸入網址的人。
- 🔴 **Portal 有三個入口，全部都要擋**：卡片（`renderAppGrid`）、`openApp()`（畫面可能是舊的，
  或有人從 console 呼叫）、以及 **`goNext()`**（`?next=quotation/index.html` 這條深層連結，
  卡片過濾完全管不到它）。漏掉第三個等於沒擋。
- 🔴 **報價系統端判斷用的是「剛從資料庫撈回來的 dept」**，不是 localStorage 那份 —— 那個位置
  本來就已經在重新查 `users`（查詢也早就含 `dept`，只是沒放進 `freshUser`）。改 localStorage
  偽造不了，調部門也立即生效。
- ⚠️ **這是 UI 層與載入層的守衛，不是資料層的牆。** 改前端程式碼可以繞過兩者。擋的是
  「不小心進錯地方」與「同事互相轉貼網址」，這是 Woody 2026-08-25 選定的層級。
  真正的牆要在 sb-proxy 依部門擋 `quotes`／`crm_*` 等表 —— 評估過暫不做，因為那些表
  不只報價系統在用，得先查清使用者。

## 密碼政策：最少 10 碼 ＋ 禁用常見密碼（2026-08-25）

由「最少 8 碼」改為「最少 10 碼 ＋ 禁用常見密碼」。**不迷溯既有密碼**：48 位已改過密碼的
同事照常登入，下次自己改密碼時才套新規則（Woody 定案）。

- 🔴 **黑名單只有一份，在 `auth-verify` 的 `passwordProblem()`**。前端**刻意不放第二份**，
  只做長度檢查（即時回饋），常見密碼一律由伺服器判斷、回 `password_too_common`。
  兩邊各存一份清單必然分岔，而分岔之後**寬鬆的那一份就是實際生效的那一份**。
- 清單分兩類，**第二類在實務上更常被選中**：① 公開洩漏清單的高頻密碼
  ② 從這個組織猜得出來的（`comart2026`、`quotation123`）——那些不會出現在任何公開清單上。
  另外用規則擋「同一字元重複」「連續鍵盤序列」「含自己的工號」，那些是無限多組、列不完。
- 前端訊息鍵：`um_err_pwd_short`／`um_err_pwd_common`（五語）。
  改長度時記得 Portal 有**兩處程式檢查**（強制改密碼那一關、admin 設定初始密碼）
  ＋**三處顯示文字**（強制改密碼畫面的 label 與說明段落、用戶管理的 placeholder、i18n 的
  `um_err_pwd_short`）。v1.79 前那三處還寫著「8 碼」—— 規則改了、畫面沒改，使用者照著畫面
  打 8 碼會被伺服器擋下，而畫面剛好沒有任何地方講得出真正的規則。
- 🔴 **伺服器新增一種拒絕理由時，前端一定要有對應分支**（v1.79 修）：`password_too_common`
  原本掉進 `else` 顯示「更新失敗，請重新登入」，使用者會重登、再打同一組密碼、再失敗，
  永遠看不出原因；而**最容易撞到的正是 B 類密碼**（`comart2026` 剛好 10 碼，前端長度檢查放行）。
  `um_err_pwd_common` 的五語翻譯當初就寫好了，只是一處都沒接上 —— **翻譯存在不等於它被呼叫**。
  強制改密碼畫面的說明段落現在直接寫出「不可使用常見密碼（公司名＋年份、自己的工號）」，
  讓使用者在打字之前就知道，而不是靠錯誤訊息事後補救。

## 用戶狀態：在職／停用／離職（2026-08-16，migration 202608160002）

`users.status`（`'active'` / `'disabled'` / `'resigned'`）是**狀態的唯一事實來源**，
`users.role` 回歸純角色（`admin` / `dcc` / `user`）。另有 `users.resigned_at`（date，可留白）。

- 🔴 **舊做法已廢除**：以前「停用」是把 `'inactive'` 寫進 `role` 欄位，代價是一停用就永遠失去
  「這個人本來是 admin 還是 user」。**不要再把狀態值寫進 `role`。**
- 🔴 **`active` 布林保留，由 DB trigger（`users_sync_status_active`）自動同步** ——
  `active = (status = 'active')`。這是整個設計的關鍵：五個系統約 30 處人員查詢都寫著
  `active=eq.true`，只要 active 跟著 status 走，**那些查詢一行都不用改**，離職者就自動
  從所有會議、投票、抽籤、通訊錄的選單消失。
  同步放在 trigger 而不是前端，是因為任何一條沒改到的寫入路徑都不能讓兩個欄位不一致。
  trigger 是雙向的：只改 `active`（舊程式路徑）也會推回 `status`，不會被還原成看似「按了沒反應」。
  `status <> 'resigned'` 時 `resigned_at` 一律清成 null（復職不該留下矛盾紀錄）。
- 🔴 **新增任何「列出人給人挑」的查詢時，一定要帶 `active=eq.true`**，不要自己撈全表。
- 🔴 **Portal 前端另有一個坑**：`ALL_USERS` 平常來自 `active=eq.true` 的查詢，但 admin 開過
  「用戶管理」後 `loadUsers()` 會把它整份覆寫成**含停用與離職的全表**（要看得到才能復職）。
  所以 Portal 裡任何列人的地方都必須經 **`umActiveUsers()`**（通訊錄、排行榜、出差人員下拉已改），
  不可直接用 `ALL_USERS`。
- `auth-verify` 對離職回 `reason:'resigned'`（與 `'inactive'` 分開，前端訊息不同）；
  `status='resigned'`、`active=false`、舊資料的 `role='inactive'` 三者都擋登入。
- sb-proxy 不必改：`users` 本來就是 `ADMIN_WRITE_TABLES`，且 `SELF_PATCH_FIELDS` 不含
  `status`／`resigned_at`，一般使用者改不到自己的狀態。
- **歷史紀錄一律保留不動**（已預約的會議室／公務車、借閱中的書、進行中的會議名單、報價單上的姓名）：
  那是歷史事實，不追溯修改。離職只影響「以後還會不會出現在可選清單裡」。
- ⚠️ `admin/lottery.html` 是**未被任何系統連結、也未納入 git** 的獨立草稿頁，名單是寫死的 22 個人名，
  不吃這套狀態。真正在用的抽籤是 `admin/index.html` 的 lottery 模塊（`lottoInit`，已過濾）。

## 地點：三個營運中心 ＋ 集團 GRP（2026-08-17，migration 202608170001）

`sites` 有四列：`TW` 台灣、`CN` 東莞廠、`VN` 越南廠、**`GRP` 集團**。

- 🔴 **`GRP` 原本叫 `'N/A'`（不適用），語意正好相反**：`'N/A'` 讀起來像「不屬於任何中心」，
  但這個層級的實際定義是「**屬於每一個中心**」—— 集團成員參與每個營運中心的工作。
  鍵值已改為 `'GRP'`（只影響 `users` 3 筆、`kms_users` 3 筆，其餘 9 張帶 site 的表都是 0 筆）。
- 🔴 **判斷「某人算不算某中心的人」一律走 `inSite(userSite, targetSite)`，不要再寫 `u.site === X`。**
  四個系統各有一份同名 helper（board / admin 定義完整，Portal / KMS 只需標籤）：
  ```js
  const SITE_GROUP = 'GRP';
  function isGroupSite(s) { return s === SITE_GROUP || s === 'N/A'; }   // 相容舊 session 快取
  function inSite(userSite, targetSite) { return userSite === targetSite || isGroupSite(userSite); }
  function iAmGroup() { return isGroupSite(PORTAL_SESSION?.site || ''); }
  ```
  相容 `'N/A'` 是必要的：那 3 位使用者瀏覽器裡的 session 快取還帶著舊值，**要等他們重新登入才會更新**。
- **已套用「集團屬於每個中心」的地方**：
  | 位置 | 函式 | 效果 |
  |---|---|---|
  | board 事前驗屍／腦力激盪／意見徵集 | `pmInScope` | 範圍＝單一中心時集團成員也在範圍內 |
  | board 投票 | `plInScope` | 同上 |
  | board 週會出席名單、中心公告收件人 | `usersBySite` | 每個中心的名單都含集團成員 |
  | board 中心公告發布 | `bbSetupCompose` / `bbPublish` | 集團成員可發任一中心的公告 |
  | board 週會／業務會議編輯權 | `canEditSite` / `bizCanEdit` | 集團成員編得動任一中心的紀錄 |
  | admin 抽籤 | `lottoInit` / `lottoFilterSite` | 選 TW 時集團成員也在抽籤池裡 |
  | admin 會議室邀請人員 | `_invSiteUsers` | 集團的人看得到全部；一般人看自己中心＋集團 |
  | Portal 行事曆預設分類 | `siteMap` | 集團預設顯示三國假日 |
- **刻意不併入集團的地方**（這些是「他屬於哪個單位」的統計，不是「誰能參加」）：
  board 投票的分中心統計（`plCenterFilter`，集團自成一格 —— 灌進每個中心會變成重複計算）、
  Portal／KMS 的貢獻排行榜 site 篩選。
- **`GRP` 不是可選的「範圍」**：`pm-c-site` / `pl-c-site` 的下拉維持 TW/CN/VN 三個。
  只給集團的會議請用「指定人員」。同理 `wmNewRecord` / `bizMeetingInit` 的預設中心遇到 `GRP`
  會退回 `TW`（紀錄的 site 必須是真的營運中心）。
- board 的介面標籤是 `site_GRP`（五語），文件用固定繁中的 `SITE_LABEL_ZH.GRP = '集團'`；
  badge class `.site-GRP`。Portal／KMS 的 `SITE_FLAG` 用 🏢。

## Admin 重要細節

- `cancelCarBk(id)` 公務車取消，`cancelBk(id)` 會議室取消，**不可混用**
- localStorage 只是快取，正本在 Supabase
- 五大模塊順序：公務車 → 圖書館 → 會議室 → 客戶到訪 → 抽籤
- 🔴 **日期一律用 `tds()`／`tdm()`／`ymdL()`／`ymL()`（裝置當地時間），不要用 `toISOString()`
  取日期或月份**（v2.32）。`toISOString()` 是 UTC，台灣 00:00–08:00 之間會少算一天；
  也**不要寫死 `+8*3600000`**（v2.32 前的 `tds()` 就是），越南廠是 UTC+7 會在 23:00 後跳成明天。
  完整時間戳（`createdAt` 之類）維持 `new Date().toISOString()`，那本來就該是絕對時刻
- 🔴 **公務車「出發／歸還」要指定是哪一筆預約**（v2.31）。`K.bks` 以 `start_dt DESC` 載入，
  車輛看板原本用 `bks.find(…'pending')` 抓到的是**最晚開始**那筆——一輛車同時有 8/10 與 8/14
  兩筆待出發時，8/10 的人按出發動到的是 8/14 那筆，接著歸還就把別人的預約結掉（實際發生過）。
  改用 `pendBkOf()`（取最早開始）／`actBkOf()`（優先取現在落在時段內的）；
  用車記錄表格每列也有自己的出發／歸還鈕，那才是使用者該走的路徑
- 時間字串比較一律經 `dtn()`：DB 回 `'YYYY-MM-DD HH:mm'`（空白）而 `datetime-local`
  是 `'…THH:mm'`，直接比大小會在第 11 個字元分岔（`' '` < `'T'`）

### 寫入必須先成功才可以改快取（v2.37，2026-08-26）

🔴 **關鍵寫入一律 `SB.write()`（回 `{ok,status,data,err}`）→ 檢查 `ok` → 才改 localStorage → 才 toast 成功。**
`SB.get/post/patch/del/upsert` 這一層**每個方法都吞掉錯誤回傳 null**。對「載入」那是對的（網路差一次
不該讓畫面空掉，用快取撐著比較好），但「寫入」共用同一套語意就是災難。

實際發生過（公務車，2026-08-26）：使用者按了歸還，畫面顯示「已登記歸還」，資料庫其實還是 `active`
—— 下次 `loadCarFromSB()` 就把那台車打回「使用中」，接著下一位同事出發，**同一台車出現兩筆同時使用中**。
三個錯誤疊在一起：
1. `doReturn()` 先改 localStorage、再送 DB、**不看結果**、無條件 toast 成功；
2. `SB.upsert` 把「PATCH 真的失敗（401）」與「PATCH 成功但沒有符合的列」都當成後者而改送 POST，
   於是 401 之後又補一個 409 duplicate key，**兩個錯誤都被吞掉**；
3. session 過期後這個頁面**照樣操作得動** —— `readPortalSession()` 只在載入時檢查一次，
   分頁開過夜之後每個寫入都被 sb-proxy 回 401，而畫面完全看不出來。

已做的四道防線：
- `SB.write()`（新）＋ `sbErrMsg()`：401/403 直接講「登入已逾期，剛才的操作沒有存檔」，不要只講「失敗」。
- `sbAuthLost()`：任何 401/403 就在 topbar 下方掛一條紅色橫幅（`#sb-authbar`），**橫幅不會自己消失** ——
  從那一刻起這個分頁什麼都存不進去，那是要一直看得到的事實。toast 只跳一次，否則會變連環彈窗。
- `startUse()`：**一輛車同時只能有一筆 `active`**（硬擋，並指名是哪一筆要先歸還）。
  這條是「歸還沒存檔」的下游防線 —— 上游修好了也要留著，否則任何漏網的寫入失敗都會再長出同一種爛資料。
- 車輛卡片：同一台車 >1 筆 `active` 時直接印警告（`car.multi_active`），叫人去用車記錄逐筆歸還。
- **資料層的牆**（migration 202608260002，v2.38）：`car_bookings_one_active_per_vehicle`
  ＝ `unique (vehicle_id) where status='active'`。**`service_role` 繞得過 RLS，但繞不過 constraint** ——
  這才是改前端程式碼也繞不過的一層，前端 `startUse()` 的硬擋只是為了給出好訊息。
  `sbErrMsg()` 會把 `23505` 認出來翻成 `car.db_one_active`，不讓使用者看到 Postgres 原文。
  🔴 **migration 開頭那段 `do $$` 是刻意的**：有既存重複時 index 會建不起來，而原生錯誤看不出是哪一台車，
  所以先把衝突車輛的**名稱與車牌**列出來再 `raise exception`。加同類約束時照這個寫法。
- **會議室同時段不可重複**（migration 202608260003，v2.39）：`room_bookings_no_overlap`
  ＝ `exclude using gist (room_id with =, tsrange(book_date + start_time, book_date + end_time, '[)') with &&)
  where (coalesce(status,'confirmed') <> 'cancelled' and end_time > start_time)`。
  需要 `btree_gist`（`room_id` 的 `=` 比較）。公務車用 unique 是因為那是等值重複；
  會議室是**時段重疊**，只有 `EXCLUDE USING gist` 的 `&&` 做得到。
  🔴 **邊界一定要 `'[)'`**，才會與前端 `timeToMin(a.start) < timeToMin(b.end) && timeToMin(a.end) > timeToMin(b.start)`
  的語意一致（10:00–11:00 與 11:00–12:00 可以並存）。兩邊不一致會造出「前端說可以、資料庫說不行」的死路。
  🔴 **它擋的是前端擋不到的東西**：前端比對的是**瀏覽器快取**，兩個人同時挑同一個時段時兩邊都會通過。
  那個競態只有資料庫擋得住。撞到時 `sbIsRoomOverlap()` 會把快取拉新並退回選時段那一步 ——
  只 toast 不刷新的話，使用者再按一次還是同一個錯。
  `end_time > start_time` 寫進 WHERE 是為了讓跨夜／壞資料不會讓整個約束建不起來（代價是那種列不受約束）。

### 哪些寫入要改成 DB-first，哪些刻意不改（v2.38）

分界線是**「遺失一筆寫入會不會產生別人照著行動的假狀態」**，不是「重不重要」：

| 已改（狀態轉換） | 遺失寫入的後果 |
|---|---|
| 公務車 出發／歸還／標記完成（v2.37） | 車子掛在使用中 → 下一位出發 → 一台車兩筆同時使用中 |
| 圖書館 借出／還書／預約 | 書在架上卻顯示借閱中 → 沒人去借；預約沒存 → 那個人永遠等不到 |
| 會議室 預約／取消／簽到 | 取消沒存 → 房間看起來被佔用；預約沒存 → 兩組人撞同一時段 |
| 客戶到訪 建立／刪除／任務勾選／廣播 | 行程沒進資料庫 → 櫃檯與陪同人員不知道有客人要來 |

**刻意不改**（仍是「改快取 → 送 DB → 不看結果」）：新增／編輯車輛、保養、驗車、加油、書目、分類、訪客名冊。
那些失敗的後果是「東西不見了」—— 使用者看得到、會重做，不會有第三個人照著假資料行動。
為這些改動翻遍 45 個呼叫點的回歸風險大於收益，而 401 橫幅已經接住最主要的失效模式。

**兩個刻意的例外**：
- 會議室**自動釋出**（`checkAutoReleaseWithToast`）維持先改快取：那不是使用者按出來的動作、沒人在等回饋，
  而且它是自癒的 —— 寫入失敗時下次載入把 `confirmed` 拉回來、再釋出一次。
- 圖書館 `chkOv()` 把逾期狀態只寫進快取：`overdue` 是從 `due_date` 推導出來的衍生狀態，不是事實來源。

- 🔴 **`car_bookings.actual_start` / `actual_end` 是 2026-08-26 才補上的**（migration 202608260001）。
  前端從 v2.31 就在寫這兩個值，但欄位不存在、`sbSaveCarBk()` 的映射也沒送 ——
  「實際歸還時間」一直只活在 localStorage，下次載入就消失，看板「最後歸還」只能退回顯示預約結束時間。
  `_carBkHasActualTs` 旗標讓「欄位還沒建立就先上線」也不會壞（撞到 PGRST204 就降級重試）。
  **這是「grep 不到引用不等於沒有依賴」的鏡像版本：程式碼裡寫得好好的欄位，資料庫裡可能根本不存在。**

## Board 重要細節

`board/index.html`（公告與紀錄，v1.64）八個頁籤，各自一組前綴命名的函式與 Supabase 表：

| 頁籤 | 前綴 | 主要資料表 |
|------|------|-----------|
| 公告 | `bb*` | `portal_bulletin`、`notifications`（逐人通知） |
| 週會紀錄 | `wm*` | `weekly_minutes` |
| 業務會議記錄 | `bm*` | `biz_meeting_minutes` |
| Woody 週報 | `wr*` | `woody_reports` |
| 事前驗屍 | `pm*` | `premortem_sessions`、`premortem_entries`、`premortem_mitigations`（`kind='premortem'`） |
| 腦力激盪 | `pm*`（同一套） | 同上三張表（`kind='brainstorm'`） |
| 意見徵集 | `pm*`（同一套） | 同上三張表（`kind='collect'`） |
| 投票 | `pl*` | `poll_sessions`、`poll_options`、`poll_votes`、`poll_comments` |

**事前驗屍 Premortem**（Gary Klein 方法，v1.21 起分階段開發，v1.46 完成）：
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
  不能改情境／譯文、不能新增或刪除對策。**刪除整場會議也只有該場主席能做**（v1.45，admin 沒有例外），
  sb-proxy 同步擋下（`DELETE premortem_sessions` 需比對 `chair_emp_id`）——一場會議被刪會 cascade
  帶走 entries/mitigations，比覆寫更嚴重
- 🔴 **填寫者姓名一律不顯示，連主席也不顯示**（v1.43）：事前驗屍靠匿名換誠實，主席若看得到誰寫了哪一條，
  與會者就會自我審查。`pmEntryHtml()` 已無 `showAuthor` 參數，**不要把 author_name 加回畫面**
  （DB 仍存 `author_emp_id`，供「只看得到自己填的」「刪自己填的」與必要時的後台稽核）
  - 主席改看 `pmSubmittedHtml()` 的「已填／未填名單」催填。**3 人門檻對兩份名單都要套用** ——
    名單是互補的，5 人裡列出 4 個未填，等於指名剩下那 1 人就是即時彙整裡那些內容的作者
  - 「✎譯」按鈕原本綁在 `showAuthor` 上，已改綁 `bilingual && pmIsChair()`；**動這裡要順便確認它還在**
- 投票只顯示票數，畫面上從不顯示投票人；PDF／PNG／Excel／Email 四種輸出都不含姓名
- 填寫階段**範圍內所有人（含主席）都可填寫**（v1.23 決定，別再改回只有成員可填）
- **送出後可修改自己那一則**（v1.76，`pmEditEntry` / `pmEditCancel`）：
  - 🔴 **與刪除同條件：自己的、且還在 `writing` 階段**。揭露之後全體都讀過了，
    再改就是偷偷換掉別人看過的內容（`pm_no_edit_after`）。
  - 🔴 **沿用同一組表單欄位（`pm-writebox` / `pm-target`），不要再畫第二份**：
    對象下拉的 `pmTgt*` 綁死 `pm-target` / `pm-tgt-wrap` / `pm-tgt-menu` 這幾個 id，畫兩份會直接撞 id。
    進入修改模式時面板標題、按鈕文字與外框都跟著換（`pmEditId`）。
  - 修改既有那一則**不算新增**，不受 `opt_entry_cap` 上限鎖住。
  - 內容或對象沒動就不重送翻譯（省一次 API，也不會把主席修過的譯文洗掉）；
    有動才重翻，翻譯失敗就把 `text_a`/`text_b` 清成 null 讓主席端背景補翻 ——
    **不可留著舊譯文**，那會變成譯文與原文不一致。
  - `pmEditId` 在推進階段、換會議、回清單、刪掉正在修改的那一則時都會清掉。
- 投票上限 `PM_VOTE_CAP = 3`（排序階段）
- 🔴 **來源語言由系統辨識，不要再加「我用的語言」下拉**（v1.77）：`pmTranslate(text, langA, langB, srcLang)`
  的 `srcLang` **可省略**，省略時由模型自行辨識並回傳 `{a, b, src}`，偵測結果寫回 `src_lang`。
  只有 `pmSaveBiField`（主席明確打在「語言 A」或「語言 B」那個框裡）才傳明確的 `srcLang`。
  另外：偵測到的來源語言等於某個目標語言時，**原文一字不動放回去**（不靠模型「照抄」，`pmTranslate` 自己保證）。
- 🔴 **翻譯用 `claude-opus-5`（`PM_TR_MODEL`），不要退回 haiku**（v1.77）：越南同仁反映中文→越南文
  不精準，根因是這裡一直用最低階模型配兩句話的提示詞。一整場會議的翻譯量連 opus 都不到 US$0.5。
  `output_config.effort='low'`＋`max_tokens:4000`：opus-5 預設開 thinking，**不可關掉**
  （關掉會讓 `<thinking>` 標籤漏進回覆，而我們要從回覆裡抓 JSON），且 max_tokens 同時涵蓋 thinking＋回覆。
- 🔴 **規則寫在 `PM_TR_RULES`，`pmTranslate` 與 `pmTranslateLong` 共用**（v1.81）：
  人稱與語域那一條以前只有條目翻譯有，AI 總結的長文翻譯是另一段自己寫的中文提示詞、沒有這條 ——
  同一份紀錄裡因此有兩套人稱標準。**改翻譯規則只改 `PM_TR_RULES` 這一份。**
  兩者的差別只在輸出格式（條目要 JSON、長文要純譯文），規則不該有差別。
- 🔴 **主席可「↻ 重新翻譯」整場**（`pmRetranslateAll`，v1.81）：模型與提示詞會改版
  （v1.77 haiku→opus-5 並補上人稱規則），既有會議的譯文卻還是舊版產出的，之前沒有辦法換掉。
  - **只重翻機器翻的東西**：從員工清單挑到的對象（`target_emp_id` 有值）不翻 ——
    人名翻譯只會製造出同一個人的兩種寫法；AI 總結不在這裡，它有自己的「↻ 重譯結論」。
  - **不傳 `srcLang`**：舊資料的 `src_lang` 是當初用「介面語言」猜的，可能根本是錯的
    （越南同仁把介面切成越南文卻用中文打字），讓模型自己辨識正是要修的問題之一。
  - **逐則序列 ＋ 各自寫回**：39 則同時打進 claude-proxy 會撞上 edge function 併發上限；
    各自寫回則是中途失敗時前面完成的都保得住，重按一次只重試失敗的那幾則。重翻期間 `pmPollStop()`。
  - ⚠️ **原文永遠不會被重翻**：來源語言等於某個目標語言時 `pmTranslate` 把原文一字不動放回去。
    所以越南同仁寫的越南文原封不動，重翻改善的是它的中文那一欄（反之亦然）。
- 🔴 **`PM_TR_SYS` 的重點是人稱與語域，不是詞彙**：中文的「你／他」不帶年齡與位階資訊，越南語卻**必須**
  選一個（bạn／anh／chị／em），譯者不選就是亂選，一篇之內不一致讀起來就會「怪」。
  提示詞明令：整篇固定一種語域、同輩預設 `bạn`、原文有指名就用名字、不得自行加敬語。
  **這是換翻譯廠商（DeepL 等）解決不了的部分 —— 那些引擎無法被下指令。**
- 🔴 **翻譯不要降級成 Sonnet，也不要換 DeepL**（2026-08-17 使用者拍板，兩案都已評估過，不必再提）：
  - **Sonnet 5** 技術上做得到（翻譯不是深度推理），一年只省約 US$10（每月 4 場、每場 40 則的估算：
    opus US$0.52／場 vs sonnet US$0.31／場）。**不划算的原因不是錢而是風險**：譯文不精準是使用者
    忍一陣子才會反映的問題，等回報時已經有一批會議紀錄存進資料庫了。使用者選擇保留 opus。
  - **DeepL** 越南語自 2025-06 起支援，所以不是能力問題，是**無法被下指令**：上面那條人稱與語域規則、
    「保留原文語氣強度、不得把批判翻得比原文客氣」、術語與工號保留，全部會失控。
    真要用也只能是「DeepL 翻初稿 → Claude 依規則潤飾」，不是二選一。
  - 品質不夠時的正確順序是 ① 調 `PM_TR_SYS`（免費）② 加公司術語對照表 ③ 才考慮第二家廠商。
- 🔴 **語言標籤有兩份，不要合併**（v1.78）：
  - `pmLangShortU()`（`PM_LANG_SHORT_UI` ＝ `PM_LANGS` 的 endonym）給**畫面**用：
    `繁體中文` / `简体中文` / `Tiếng Việt` / `English` / `日本語`。
  - `pmLangShort()`（`PM_LANG_SHORT`，固定繁中）只給 **PDF／PNG／Excel／Email 四種輸出**用，
    同 `siteLabelZ()` 的道理 —— 存檔格式不隨介面語言改變。改輸出時用這一個。
  - **不做 5×5 對照表是刻意的**：語言標籤要讓「看得懂那個語言的人」認得出來，不該由當下的介面語言決定
    （越南同仁把介面切成中文時，那一欄還是要寫 `Tiếng Việt`）。瀏覽器與作業系統的語言清單都這樣做。
    原本兩處共用一份固定繁中，越南同仁看到的欄位標題是「越南語」三個他讀不出來的漢字，
    而建會的語言下拉本來就顯示 `Tiếng Việt`，選的時候一種寫法、送出後另一種。
- 雙語：每則失敗原因寫入後自動經 `claude-proxy` 翻成會議設定的兩種語言，存 `text_a`/`text_b`
  （情境與專案說明同理存 `desc_a`/`desc_b`、`scenario_a`/`scenario_b`）。**已翻譯過的不重翻**
- `setup` 階段主席可雙語編輯專案描述與情境（`PM_BI_FIELDS` + `pmBiEditorHtml`/`pmSaveBiField`，v1.29–v1.30）：
  改任一語言就自動翻另一語言，親手輸入的那一邊原文照留不回譯
- 對策的「重點風險」是**下拉挑選高票失敗原因**（v1.28），風險文字與雙語直接沿用該原因，不再重翻
- 對策的雙語顯示用 `pmBiOrdered()`（v1.46）：**左右兩欄**（沿用失敗原因清單的 `.pm-bi`／`.pm-lc`），
  **中文一律在左欄**（不管它是設定的語言 A 還是 B）；風險、措施、負責人期限同一字級 13.5px。
  窄螢幕由 CSS 自動改為上下堆疊
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
  - 🔴 **「↻ 重譯結論」（`pmRetranslateSummary`，v1.82）與「↻ 重新生成」（`pmGenSummary`）是兩件事，不要合併**：
    重譯只把 `ai_summary_b` 用現在的規則重做，`ai_summary_a` 一字不動；重新生成會**重跑分析**，
    得出不同的風險與不同的結論 —— 而同一場會議不該有兩種結論（v1.36 就是為此把「兩語言各自發想」
    改回「翻譯」）。想換更好的譯文卻按了重新生成，等於把結論也換掉了。
    逐段翻譯而非整篇一次（三段各 350–500 字，整篇會逼近 `max_tokens`，且一段失敗不必整份重來）；
    段落小標不送翻譯，直接取 `PM_SUM_PARTS[].disp` 的五語對照；主席修訂過時換一段確認文案，
    明講「保留修訂過的原文、覆蓋另一種語言」。`pmSumSplit()` 是排版與重譯共用的切段函式。
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
  - 🔴 **輪詢重繪一律走 `pmRerender(force)`，不要直接呼叫 `pmRenderRoom()`**（v1.60）。
    會議室是整塊 `innerHTML` 重畫的，別人一送出內容、一則譯文補完就重畫，正在打字的人游標會彈掉、
    **中文輸入法組字到一半會被砍斷**。兩道防線：① 使用者焦點在 textarea／文字 input 時直接延後重繪
    （`pmPendingRender`，掛一次性 `blur` 補畫）；② 非畫不可時（階段變更 `force=true`）先 `pmSnapInputs()`
    快照所有欄位值＋焦點＋游標＋捲動位置，`pmRenderRoom()` 尾端 `pmApplyInputSnap()` 還原。
    快照**空值不覆寫**，否則會蓋掉重繪後才算出來的預設值（對策期限）
- **排序階段全員投滿票會自動進入對策階段**（v1.60，`pmMaybeAutoAdvance`）：票數已成定局，再等主席按鍵只是延遲會議
  - 🔴 **動作只由主席端發出** —— sb-proxy 欄位守衛規定 PATCH `phase` 必須是該場主席本人，別人送出去只會 403。
    判斷邏輯人人都算得出來（用來顯示進度條），但 `pmSetPhase` 只有主席會呼叫
  - 應投票的人（`pmVoterRoster`）：`scope_type='list'` 用 `scope_members`；全公司／中心無法列舉，
    改以**實際有填寫內容的人**為準（＝真正到場的人）。主席一律計入
  - 實際票數上限取 `min(voteCap, pmEntries.length)`：只有 2 則條目時沒人投得滿 3 票，否則永遠不會觸發
  - `pmAutoAdvanced` 旗標一場只自動推進一次（失敗也不重試，免得每 7 秒跳一次失敗提示）；
    主席手動退回排序階段（讓晚到的人補投）時 `pmSetPhase` 會重新武裝
  - 進度條 `pm_vote_progress` **只給數字不給名字**，維持「畫面上從不顯示投票人」
- 定稿可輸出四種格式（PDF／PNG／Excel／Email），皆為雙語版面
  - 🔴 **四種輸出的區塊順序**（v1.75）：`背景說明 → 題目／引導語 → AI 總結 → 個人意見 →〔對策〕`。
    匯出的是給人冷讀的文件，先交代「這場在問什麼」，讀者才看得懂後面的總結與內容。
    **畫面上（`locked` 階段）AI 結論刻意擺最前面**——會議當下要先看到結論，兩者不同不是 bug。
    四份實作（`pmReportHtml` / `pmPngBlocks` / `pmBuildXlsx` / `pmSendMail`）順序必須一致，改一處要改四處。
    Email 版原本整段漏掉「背景說明」，v1.75 一併補上。
  - 🔴 **只有定稿（`locked`）之後才給匯出**（v1.73）：未定稿的紀錄匯出去是半成品，
    收件人沒辦法分辨它是不是最終版本 —— 這跟「AI 總結被修訂過要留下軌跡」是同一類考量。
    這樣「匯出的一定是正式版本」才真正成立。
  - 🔴 **PNG 匯出直接畫 canvas（`pmRenderPngCanvas`），不要退回「SVG `foreignObject` → `<img>`
    → canvas」那條路**（v1.73 改掉的舊做法）：**WebKit（Safari／iOS）根本不會光柵化
    `<img>` 裡的 `foreignObject`**，在 Mac 與 iPhone 上必定失敗；Chrome 可以，所以很容易誤以為沒問題。
    週會紀錄的 PNG 一直正常，就是因為它一開始就直接畫 canvas。
    版面由 `pmPngBlocks()` 拆成可量可畫的區塊，刻意與 PDF（`pmReportHtml`）逐項對齊。
    中文沒有空格，斷行一律走逐字的 `pmPngWrap()`，不可用 `split(' ')`。
    ⚠️ **投票頁籤的 PNG 匯出已直接移除**（v1.74）：同一個 foreignObject bug，
    但使用者決定投票只需要 PDF，故不重寫成 canvas 版（它的報表含選項圖與總圖，要非同步載入才畫得出來）。
    投票的匯出剩 寄送／Excel／PDF。**要恢復請寫 canvas 版，不要把 foreignObject 那段搬回來。**
  - **與會人員（`pmAttendeesZ`）**：`attendees` 欄位要手動打字、實務上幾乎都是空的，
    所以匯出時沒填就用「實際有送出內容的人」補上。
    🔴 **匿名場次絕對不可列名單** —— 那等於指出「這些人之中有人寫了那些內容」，範圍一小就是點名；
    匿名場次只輸出人數。四種輸出（PDF／PNG／Excel／Email）共用這一個函式。

新增 `premortem_*` 之類的新表時，記得同步加進 sb-proxy 的 `ALLOWED_TABLES` 白名單，否則前端一律 403。

### 未存檔提醒：三個編輯器共用（v1.85，2026-08-11）

週會紀錄／業務會議記錄／Woody 週報**只在按「儲存」時才寫進資料庫**，所以任何其他離開方式都會丟掉編輯內容。
兩條離開路徑能做到的事情不同：

| 離開方式 | 機制 | 文字可否自訂 |
|---|---|---|
| 返回列表、切換主頁籤 | `boardLeaveGuard()` 自己 `confirm` | ✅ 我們寫的（`board_unsaved_leave`，五語） |
| 關閉分頁／重新整理 | `beforeunload` | ❌ **瀏覽器決定，無法自訂** |

- 🔴 **`beforeunload` 的對話框文字塞不進去**，各瀏覽器 2011–2017 年間陸續移除自訂文字（被詐騙頁面濫用）。
  不要再嘗試把「請按儲存後再離開」寫進那一關，只能是制式問法。
- 🔴 **原本「返回列表」完全沒有提醒**：`onclick="wmBackToList()"`／`wrBackToList()` 一聲不響就丟掉未存檔的編輯
  ——比關分頁更危險，關分頁至少瀏覽器會攔。現在按鈕走 `wmLeaveEditor()`／`wrLeaveEditor()`，
  **`*BackToList()` 本身刻意不加守衛**：`wmSave`／`wrSave`／刪除成功後都會呼叫它，那時候問「尚未存檔」是錯的。
- 🔴 **`switchTab` 的守衛必須是函式的第一個語句**：先 toggle class 再問的話，使用者按「取消」時頁籤已經跳掉了。
- **`_boardLeaveAcked`**：使用者按過一次「確定離開」後就不再重複詢問，直到又動了內容（`boardMarkDirty` 會清掉它）。
  每次切頁籤都重問會把人訓練成無腦點掉，反而讓提醒失效。**`_boardDirty` 刻意保留**，所以關分頁時 `beforeunload` 還是會攔。
- 業務會議記錄另有 `localStorage` 草稿（`comart-board-mm-draft-v1`，每次變更就寫、載入時還原），週會與週報沒有。

**「自動存檔」已評估後否決**（2026-08-11，Woody 拍板）：離開欄位就寫進資料庫會讓「取消」失去意義
（改到一半反悔也收不回來），且新紀錄一打字就建立一筆、列表開始堆廢棄草稿。不要再提議。

### 事前驗屍：已定案的決策與**已否決**的選項

下列是 2026-08 討論後拍板的結果。**不要再重新提議已否決的項目**（每一項都已評估過成本與效益）：

| 決策 | 結論 | 理由 |
|---|---|---|
| 匿名程度 | **全程匿名到底，連主席也看不到誰寫了哪一條** | Klein 原版其實是具名口說；但我們是「書面＋永久存檔＋匯出寄送＋跨語言＋主席常是被驗屍專案的負責人」，門檻完全不同 |
| 中途解匿 | ❌ **否決** | 填寫時承諾匿名、揭露後才具名 ＝ 承諾到期。第一次這樣做，第二次就沒人敢認真寫 |
| 對策「自願認領」按鈕 | ❌ 暫不做（維持現狀） | 已提案，使用者決定先不加 |
| 投票可見性 | 只顯示票數，畫面從不顯示投票人 | 票決具名等於沒有票決 |
| 伺服器端授權（`premortem-secure` edge function，即討論中的「方案 C」） | ❌ **否決** | 使用者的威脅模型是「一般企業使用者」，明確表示不在意「要開發者工具才觸及得到」的洩漏。C 的全部價值就在擋這種人 → 不划算（省 4–5 天） |
| 讀取權限 | 維持前端 `pmCanSee()` 判斷（sb-proxy 對 premortem 三表**不做列級過濾**） | 同上。**這是已知且已接受的取捨，不是待修的 bug** |
| 寫入防護 | ✅ 已做（見上方「兩層寫入防護」） | 「看到」與「改到／刪掉」是兩回事：正式紀錄被無痕竄改、整場會議被 cascade 刪除，損害等級不同 |

### 腦力激盪 Brainstorm（v1.47，migration 033）

**與事前驗屍是同一套程式**，用 `premortem_sessions.kind` 區分（`'premortem'` / `'brainstorm'`）。
階段機、雙語翻譯、投票、AI 分群、AI 三段分析、四種輸出、主席控制、寫入防護全部共用，
資料也在同一組 `premortem_*` 表。**要再加第三種會議，就在 `PM_KINDS` 加一筆，不要複製程式。**

- `PM_KINDS`（board/index.html）是唯一的差異來源。取用一律經 `PMK()`／`PMT()`／
  `pmPhaseLabel()`／`pmVoteCap()`，**不要在 render 裡寫死「失敗原因」「對策」之類的名詞**。
  `PMK()` 開著會議室時以 `pmSession.kind` 為準、在清單時以 `pmKind`（目前頁籤）為準
- 兩個頁籤共用同一份 DOM `#pm-shell`（`pmMountShell()` 把它搬到當前 tabpanel）。
  這樣 60 行 HTML 與 40 處 `getElementById('pm-…')` 都只有一份；會隨類型變的靜態文字
  由 `pmApplyKindLabels()` 套上
- 🔴 **只有三個旗標是真正的行為差異，其餘都是文案**：

  | 旗標 | 事前驗屍 | 腦力激盪 | 為什麼相反 |
  |---|---|---|---|
  | `anonymous` | `true` 全程匿名 | `false` 顯示提出者 | 驗屍靠匿名換誠實（主席常是被驗屍專案的負責人）；發想點子沒有「講錯話」的風險，具名反而方便認領與追問 |
  | `liveVisible` | `false` 填寫時互相看不到 | `true` 即時可見 | 驗屍要避免錨定與從眾（nominal group）；腦力激盪要 Osborn 的 hitchhiking，看到別人的才長得出新的 |
  | `voteCap` | 3 | 5 | 點子通常比失敗原因多 |

- 🔴 **AI 三段分析的語氣必須跟著換**（`sumSys` / `sumParts`）：驗屍全程嚴厲；腦力激盪
  **前兩段建設性、第三段才收斂下判斷**。用驗屍的語氣批評剛冒出來的點子，正是 Osborn 第一原則
  （延遲批判）禁止的事，會直接殺死會議成果。這是複製程式最容易漏掉、也最傷的一項
- `anonymous:false` 時 `pmSubmittedHtml()` 的 3 人門檻自動停用（名單本來就看得到人名，門檻沒有意義）
- `kind` 在 sb-proxy 的 `PM_IMMUTABLE`：建立後不可更改（把一場已定稿的驗屍紀錄改成腦力激盪
  等於竄改正式紀錄的性質）

### 意見徵集 Collect（v1.61–v1.64，migration 202608160001）

**第三種 `kind`，同一套程式**（`kind='collect'`）。與前兩者最大的不同：**它的行為由主席建會時決定**，
而不是寫死在 `PM_KINDS`。用途是「大家各自寫、然後一起看」的通用場景 —— 感恩留言、專案回顧、意見徵集。

- 🔴 **只有 `collect` 可設定；`premortem` / `brainstorm` 的旗標維持寫死，不要開放**。
  `PM_KINDS[kind].configurable` 宣告「這個類型允許主席決定哪些旗標」，驗屍與腦力激盪是空清單。
  驗屍的「全程匿名」一旦變成主席可以關掉的選項，與會者每次寫之前都要先確認這場是開還是關，
  那份安全感就沒了；腦力激盪的「即時可見」同理，那是 Osborn 的 hitchhiking 不是排版偏好。
- 🔴 **行為旗標的唯一取用點是 `pmOpt(name)` / `pmOptOf(s, name)`**，階段清單是 `pmPhases()`。
  `pmOptOf` 裡「只有 configurable 列出來的旗標才吃 session 的 `opt_*`」那道判斷是整個設計的安全閥，
  不要繞過去直接讀 `PMK().anonymous` 或 `s.opt_anonymous`。
- 四個可設定旗標（DB 欄位 `opt_anonymous` / `opt_live_visible` / `opt_vote` / `opt_entry_cap`，
  **NULL ＝ 照 `PM_KINDS` 預設**，所以既有資料不必回填）：匿名／具名、填寫時可見性、
  要不要投票、每人則數上限（0＝不限）。
  **四者與 `template` 都在 sb-proxy 的 `PM_IMMUTABLE`：建立後一律不可改** ——
  尤其匿名不可中途翻盤（「中途解匿」CLAUDE.md 早已否決）。
- **階段**：`intro → setup → writing → reveal →〔ranking，opt_vote 決定〕→ locked`。**沒有 `mitigation`**。
  `PM_PHASES` 仍是驗屍／腦力激盪的完整版；`pmPhases()` 才是實際清單，
  所有比較階段先後的邏輯（`pmPhaseIdx` / `pmCanGoPhase` / `pmSetPhase` / `pmMaybeAutoAdvance`）都吃它，
  少一個階段時「往前只能走一步」自動跳過，不必寫特例。**自動推進的目標不可寫死 `'mitigation'`。**
- **範本 `PM_TEMPLATES`**（`gratitude` / `retro` / `general`）：只屬於 collect。負責兩件事 ——
  ① 預填那四個旗標與引導語 ② 決定填寫欄位是一欄還是兩欄（`fields`）。選完主席仍可逐項改。
  畫面文案走 i18n key `pmt_<key>_*`（五語），`z` 是繁中固定詞彙給 AI 提示詞與四種輸出用。
- **感恩範本的「對象」欄位**（`fields:2`，DB `premortem_entries.target_emp_id/target_name/target_a/target_b`）：
  用 `<input list=…>` ＋ `<datalist>` 而不是 `<select>` —— 使用者要的是「兩者皆可」：
  打字跳出同仁建議（挑到存 `emp_id`，日後統計得出誰因為什麼事被提到），也可直接打
  「客服團隊」「XX 廠商」這類清單外的對象。`pmTargetMap()` 同名同姓時補工號，
  否則兩個人共用同一個顯示字串會解析到同一個 `emp_id`。
  🔴 **從清單挑到的人名不送翻譯**（人名翻譯只會製造出同一個人的兩種寫法），自由文字才翻。
  - 🔴 **v1.66 起改成自己畫的下拉面板（`pmTgt*`），不要退回 `<datalist>`**：
    iOS Safari 不畫任何可下拉的提示、桌機 Chrome 的小箭頭也只在特定狀態出現，
    使用者根本不知道能挑。現在右側永遠有一顆 SVG 箭頭鈕，手機與桌機行為一致。
    三個必須保留的行為：① 手機按箭頭時先 `blur()` 收鍵盤（否則清單被鍵盤蓋住）
    ② 觸控裝置**不要**一聚焦就彈清單（`pmTgtFocus` 用 `pointer: coarse` 判斷）
    ③ 下拉開著時 `pmRerender` 要延後重繪，收起時（`pmTgtClose`）再補上 ——
    否則 7 秒的輪詢會讓正在挑人的清單憑空消失。下方空間不足時 `pmTgtPlace` 會翻到輸入框上方。
- **展示階段的播放模式**（`play_idx`）：主席按「▶ 播放」逐則放大呈現，**全場畫面同步** ——
  索引寫進 `premortem_sessions.play_idx`，其他人靠既有 7 秒輪詢跟著跳。
  🔴 `play_idx` 在 sb-proxy 的 `PM_PROTECTED`（只有該場主席改得動），否則任何與會者都能把
  全場畫面拉走＝搶走主席的簡報器。主席另有鍵盤 ← → Esc；走到最後一則**不繞回**
  （多按一次又跳回第一則會讓全場以為漏看）。離開展示階段自動關閉播放。
  - 🔴 **播放中投影幕上只有「人名＋內容」**（v1.68）：`pmRenderRoom` 一開頭就 early return
    只畫 `pmPlaySlideHtml()`，會議資訊卡／專案描述／情境／匯出工具列全部不畫，
    `pmRenderPhasebar` 也整條清空。面板標題、「第 X／N 則」、進度點、跟隨提示都已移除 ——
    那些是操作資訊不是會議內容，投在牆上只會分散注意力。
    主席的操作列（上一則／位置／下一則／結束）獨立 sticky 在底部且**只有主席看得到**；
    與會者的畫面到提出者姓名為止就結束。**要往這裡加任何東西之前，先問它該不該上投影幕。**
  - 🔴 **投影片的字級全部用 `clamp(最小, vw, 最大)`**（v1.69）：同一份程式要同時應付手機、
    筆電與會議室投影幕（1920px 以上），寫死 px 在任一端都會不對。播放中另有
    `body.pm-playing .wrap{max-width:1560px}` 把內容欄放寬（1180px 在投影幕上會浪費三分之一畫面），
    那個 class 由 `pmRenderRoom` 依 `pmPlaying()` 即時 toggle，`pmShowView`／`switchTab`／
    `pmBackToList` 三處負責收回。
  - 🔴 **內文的字級選擇器必須寫成 `.pm-slide .pm-lc .txt`**：`.pm-lc .txt{font-size:13.5px}`
    的權重是 (0,2,0)，只寫 `.pm-slide-txt`（0,1,0）會被它整個蓋掉 ——
    v1.68 的投影內文其實一直是 13.5px。改這一段時務必確認權重仍然壓得過去。
  - 內容越短字放越大（`pmPlaySlideHtml` 依較長那一語言的字數決定 `lg`／`xl` class）：
    一句話擺在整個投影幕上，用一般字級會空掉一大半。
  - 🔴 **投影片一律靠上對齊，不要用 `justify-content:center`**（v1.70）：置中會把內容推到
    框正中間，內容一短上方就空出一大片。**要填滿畫面靠的是把字放大，不是靠置中推開。**
    播放時另外收掉三處上緣留白：`.wrap` 的 padding-top、`.pm-roombar` 的 margin-bottom、
    `.pm-slide-in` 的 padding-top。會議室頂端那一列的樣式已從 inline style 抽成
    `.pm-roombar` / `#pm-phasebar` 兩個規則 —— inline 樣式沒有 `!important` 是蓋不過去的。
    v1.71 把 `.pm-slide-in` 的上內距補回約一行（`clamp(18px,2.2vw,44px)`）：
    完全貼齊分隔線會太擠。**這個值是使用者來回調過兩輪的結果（先太空、再太擠），不要再自行加減。**
- 🔴 **AI 三段分析的語氣是第三種**：`PM_SUM_SYS_CL` **全程溫暖具體**，三段為
  彙整 → 模式 → 結論。這裡收到的常是同事對同事的感謝，用審查顧問的語氣去評分等於當眾評比
  誰的感謝比較有價值。提示詞裡明令**不排名、不比較誰被提到得多**（沒被提到只代表這次沒被想起來），
  要下判斷只准針對流程不准針對人。
- **沒開投票的場次**：`pmSummaryContext` 與四種輸出都不印票數、不寫「（依票數）」；
  AI 分群按鈕改掛在展示階段（否則永遠沒有主題可分群，總結與輸出就少了依主題歸類這一層）。
- **不發通知**（使用者決定）：被感謝的人不會收到站內通知，靠現場與事後匯出知道。
- ⚠️ **「人的投票表決」請走 🗳 投票頁籤（`pl*`）**，不要把 `pm*` 撐成表決工具。
  兩套系統形狀不同：`pl*` 是「主席出選項 → 大家投」，`pm*` 是「大家各自寫 → 一起看 → 收斂」。

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
