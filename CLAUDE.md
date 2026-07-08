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
| `index.html` | v1.57 | Main portal — login, home, directory, bulletin, calendar, AI tools | 4,372 |
| `admin/index.html` | v2.25 | Admin System — room booking, fleet, visitor, library, lottery | 5,576 |
| `kms/index.html` | v2.25 | Knowledge Management System — RAG, document editor, AI Q&A | 7,059 |
| `quotation/index.html` | v3.53 | Quotation & CRM system | 7,288 |

`admin/lottery.html` is a standalone lottery page (separate from the lottery module inside `admin/index.html`).

Numbered backup files (`index112.html`, `index328.html`, etc.) are iteration snapshots. They are untracked by git (`.gitignore` excludes nothing — these are just leftover drafts).

### Navigation & Routing

**Within `index.html`**: `switchView(name)` shows/hides `<div id="view-{name}">` panels.

**Opening sub-apps**: `openApp(id)` navigates to the sub-app HTML file, passing the session via URL parameter `?_ps=<base64-JSON>` since localStorage cannot be shared cross-origin.

**Within `admin/index.html`**: `switchMod(m)` activates modules — `'room'`, `'car'`, `'visit'`, `'lib'`, `'lottery'`.

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

**Firebase**: 已完全移除（2026-07 確認四個 HTML 皆無 firebase 引用）。通知與站內訊息走 Supabase 輪詢（通知 60 秒、訊息 10 秒增量）。

**Supabase Edge Functions** (Deno, in `supabase/functions/`)：
- `sb-proxy` — 通用資料代理（取代 Cloudflare Worker），`--no-verify-jwt`
- `auth-verify` — 伺服器端密碼驗證（PBKDF2，相容舊 SHA-256）+ 簽發 HMAC 簽章 session（`login`/`setPassword`/`adminSetPassword`）。**密碼驗證只在此進行，pwd_hash 永不回前端**
- `kms-secure-docs` — KMS 機密文件依「簽章驗證過的真實角色」過濾（`list`/`get`/`searchVector`/`searchKeyword`），機密等級在 SQL 層強制
- `kms-write` — service-role writes to KMS tables；allowed: `kms_documents`,`kms_doc_versions`,`kms_comments`,`kms_review_log`,`kms_experts`,`kms_product_lines`,`kms_search_log`,`kms_snapshots`,`kms_categories`
- `claude-proxy` — forwards to Anthropic API; `CLAUDE_API_KEY` from Secrets
- `embed-document` / `embed-query` — pgvector embeddings for RAG (**not** in `config.toml`; deploy with `--no-verify-jwt`)
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
- **Portal + Quotation**: `--bg:#080C14`, accent `--ac:#2D7FF9`, fonts: DM Sans / DM Serif Display / DM Mono
- **Admin + KMS**: `--bg:#0f1117`, accent `--blue:#5b9bd5`, fonts: Segoe UI / PingFang TC

Responsive breakpoint at 768px: desktop shows sidebar, mobile shows bottom nav. Safe-area insets are handled for iOS.

### Multi-language Support

The portal supports EN, 繁中, 简中, VI, 日 via `setLang(lang)`. Each language has a full i18n dictionary stored as a JS object in the HTML file. KMS and admin have their own i18n dictionaries.

## 系統架構

- **Platform** (`/`) — 入口門戶，`index.html`
- **Admin** (`/admin`) — 行政管理平台，目前 v1.57，5840 行
- **KMS** (`/kms`) — 知識管理系統
- **Quotation** (`/quotation`) — 報價系統

## 技術棧

- 純 HTML + CSS + JavaScript，單一 HTML 檔案
- Supabase 資料庫（專案 ID: `tcvlnpgpuphdalzvmoyo`）+ Edge Functions（資料代理、密碼驗證、機密文件、RAG）
- Supabase anon key: `sb_publishable_rAVwVeUMWD-m_VTFIenMhg_Fcg6ocYJ`
- 資料代理：`sb-proxy` edge function（`.../functions/v1/sb-proxy`）。~~Cloudflare Worker `comart.mcsewoody.workers.dev`~~ 已停用（中國被封 + 安全後門，2026-07-08 淘汰）
- Firebase：已移除，不再使用
- 部署: GitHub Pages → platform.comart.com.tw

## 版本規則

- **四個系統（Portal、Admin、KMS、Quotation）每次修改版本號都 +0.01**，無例外
- 版本號同步更新（有幾處就改幾處）：`<title>`、`.login-sub`、topbar 版本顯示
  - Portal/Admin/KMS：`<title>` + `.login-sub` + topbar `<span>`
  - Quotation：`<title>` + topbar `#appVersionDiv`（沒有自己的登入畫面／`.login-sub`）
- 每次修改後自動 commit 並 `git push`，不需等候使用者指示
- **每次修改完畢，回覆結尾必須告知目前各檔案最新版本號**（例如：`kms v2.06`、`admin v1.57`）

## Admin 重要細節

- `cancelCarBk(id)` 公務車取消，`cancelBk(id)` 會議室取消，**不可混用**
- localStorage 只是快取，正本在 Supabase
- 五大模塊順序：公務車 → 圖書館 → 會議室 → 客戶到訪 → 抽籤

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
