# COMART Product Finder 版本紀錄




## 2.40（2026-10-09）

- 語言列拿掉「日本語」（Woody：所有系統的日文介面停止維護；`DICT` 的 ja 留著不刪）。之前選過日文的人改看英文。

## 2.39

### 🔴 刪掉的文件會被匯入回來

批次匯入判斷「匯入過沒有」唯一的依據是伺服器上還有沒有同一個 sha256。
刪除把整列拿掉之後，對下一次掃描來說它跟全新的檔案一模一樣 ——
**只要本機、另一台電腦或另一位同事的電腦還有那個檔，就會被匯入回來。**
刪除對話框的「同時刪除本機檔案」只刪得到當下那一台的預設目錄，擋不住。

**現在刪除時記下內容指紋**（`pd_deleted_documents`，migration `202610010001`）：

- 🔴 **擋在伺服器**：`initUpload` 與 `completeUpload` 都查這張表，命中就回
  `deleted:true`。前端的略過只是讓盤點畫面講得清楚，改前端繞不過去。
  查詢失敗一律**不放行**（fail-closed）—— 資料庫抖一下，刪掉的文件不該趁機回來。
- **先記刪除紀錄、再刪資料列**；記不下來就不刪。
- 盤點結果多一格「曾刪除，已略過」，並列出是哪些檔、何時被誰刪的。
  「我資料夾裡明明有，為什麼沒匯入」一定會被問，默默略過只會讓人以為系統壞了。
- **還原只有 admin**（與刪除同一個權限），而且**逐份確認**，不做「全部還原」。
  手動上傳碰到曾刪除的檔，admin 可以就地按「仍要重新匯入」。
  還原成功才移除那一筆刪除紀錄，稽核記為 `restore`。
- 判斷抽成 `pd-documents-api/tombstone.js`（`node --test` 4 個），
  `uploadOne` 另加 4 個測試（被擋時不碰 storage、restore 兩個端點都要送）。

⚠️ 補回既有刪除：`pd_transfer_audit` 裡的 `delete` 紀錄會轉成刪除紀錄，
但上線時一筆都沒有（2.37 之前的刪除會連稽核一起刪掉），所以更早以前刪掉的無法追回。

## 2.38

### 🔴 上傳完不會自動分析 —— 一直都不會

上傳時 `completeUpload` 會建一筆 `queued` 的佇列工作，但**沒有任何東西會去
執行它**。`pd-document-worker.yml` 從建立那天起就只有 `workflow_dispatch`
（查過整份 git 歷史，從來沒有過排程；README 寫的「5 分鐘 worker」是 CPF
時代那一支）。真正的流程是：上傳 → 排進佇列 → **要有人記得去按「AI 文件分析」**。

畫面上只寫「等待內容分析」，**看不出來它在等的是一個人**。
執行紀錄佐證：每一筆都是 `workflow_dispatch`，2026-09-28 之前的上一次是 09-13。

**現在上傳完直接觸發**（`autoStartAnalysis`）：批次匯入結束、手動上傳結束，
各自呼叫一次既有的 `startAnalysis`。

- 評估過改成 GitHub Actions 每 15 分鐘排程，**否決**：上傳是「兩個月一次」的
  事件，用每天 96 次輪詢去等它，絕大多數執行都是空轉。**事件驅動才對。**
- 而且事件驅動這條路**連 workflow 檔案都不用改** —— `startAnalysis` 本來就會
  dispatch，只需要 `repo` 權限（`workflow` 權限管的是「修改 workflow 檔案」）。
- **失敗不擋上傳**：檔案已經進去了，分析沒觸發最多是晚一點做，而且 2.37 之後
  搜尋結果列表會顯示「等待內容分析」徽章，看得出來。訊息會說可以按下方重試。
- session 失效時不觸發（不要再打一個注定 401 的請求）；中途按停止**仍然觸發**
  —— 已經傳上去的那些檔案照樣該被分析。

### `startAnalysis` 補上 `max_batches`

workflow 早就吃這個 input（1–20），但 edge function 一直沒送，所以
**按一次最多處理 `limit` 份（上限 50）** —— 一次匯入幾百份要按很多次，
而且沒有任何地方說得出「還沒處理完」。自動觸發之後更需要它：
沒有人會在背後幫忙多按幾次。

輪數由 `analysisBatchesFor(上傳份數)` 算（`ceil(n/50)`，夾在 1–20）。
算的是「這次新上傳的份數」而不是「真的需要深度分析的份數」——
CAD 與影片是 `metadata_only` 不進佇列，所以多估；多出來的那幾輪各自
claim 到 0 就立刻結束，而少估的代價是文件留在佇列裡沒人處理。

### 兩段邏輯都抽出來測

這個 repo 被「改了沒辦法在本機驗的東西」燒過兩次，所以：

- `analysis-request.js` —— 參數驗證。🔴 其中一條測試**直接讀
  `pd-document-worker.yml` 比對 `max_batches` 的範圍檢查**：兩邊分岔的話，
  edge function 放行的值會讓 GitHub job 在第一步 `exit 1`，
  而使用者只看到「已啟動分析」然後什麼都沒發生。
- `analysisBatchesFor()` —— 輪數計算，含上限夾制。

測試：前端 40 → 43、edge function 21 → 28。

### 順帶記一筆

寫測試時我把 `limit: "20"` 放進「應該被拒絕」的清單，結果是**測試錯了不是程式錯了**
—— `Number(body.limit)` 本來就會收下數字字串，那是既有行為。
已改成明確測「數字字串會被接受」，免得下次有人順手收緊而不知道那會改變行為。


## 2.37

一次做完九項檢討，前後端都有。

### ① 搜尋 RPC：三段「證明無效」的東西

`202609280004_pd_search_simplify.sql`。

- **`iq.q = ''` 這個 disjunct 讓 trigram 索引永遠用不到。** WHERE 原本是
  `(iq.q = '' or search_text like ... or search_text % ...)`，第一條只碰 cross join
  的另一邊、不碰 `d`，Postgres 就沒辦法把任何一條轉成 `d` 的 index condition。
  2.35 正規化了大小寫、索引仍然 Unused，原因就是這個。
  🔴 **而它是多餘的**：`search_text` 是 `not null`，`q = ''` 時
  `like '%' || '' || '%'` 就是 `like '%%'`，恆為真。刪掉語意完全等價。
- **`search_text % iq.q`（similarity）是純成本零效果。** 走到 similarity 的
  base_score 最大 `1 × 180 = 180`，門檻是 200，`rank_weight` 的 CHECK 又是 `<= 1`。
  **永遠過不了** —— 它讓列通過 WHERE，只為了在下一個 CTE 被丟掉。
- **評分用 `extracted_text`、過濾用 `search_text`，同一份 300 KB 掃兩遍。**
  worker 把 `extracted_text` 整份接進 `search_text`，所以那是掃一份副本，
  而且 `extracted_text` 沒有索引、每列都要再 detoast 一次。改成直接給 220。
  ⚠️ 唯一的行為差異：「只在 AI 摘要裡命中」的文件原本落到 similarity 分支被丟掉，
  現在算成 content 留下。那是修正。
- 連帶：`relevant` 那個 CTE 的 WHERE 現在恆為真，併回 `scored`。

🔴 **`rank_weight` 全 repo 沒有任何一行寫入**，永遠是 default 1。欄位與乘法保留
（那是預留的降權鉤子），但要用它得先有寫入路徑。

### ② 搜尋結果看不出「這份文件的內文還沒進索引」

`analysisStatus` 以前只在詳情頁看得到，列表完全沒有 —— 所以
**「這份文件搜不到內文」與「沒有這份文件」在畫面上長得一模一樣**。
而且 `failed` 跟 queued 共用「等待內容分析」，**永遠失敗的文件會永遠顯示等待中**。

- 列表對非 `completed` 的文件加狀態徽章（`failed` 用 danger 色）
- 新增 `d_idx_processing`／`d_idx_failed`（五語）
- 查無結果時多一句：也可能是還在等待分析或分析失敗，那種情況只有檔名與路徑查得到

### ③ `loadMore()` 少了 `searchDocuments()` 已經有的那層保護

`searchDocuments()` 有 `searchSeq` + abort，`loadMore()` 兩個都沒有 ——
按「下一頁」之後立刻改條件送出新搜尋，舊的分頁回應會把舊資料接在新結果後面，
並覆蓋 `total` 與 `elapsed`。同一個 race，之前只修了一半。

### ④ `bootstrap` 每次開頁全撈供應商，前端根本沒讀

`select("supplier_name")` 沒有 range，加上兩個 `count(*)`。
`suppliers` 與 `counts` 在前端**一次都沒被使用過**（`api.ts` 連 bootstrap 方法都沒有）。
而且那份清單就算有人要用也是壞的：Supabase 預設 1000 列會靜默截斷。整組移除。

### ⑤ `deleteDocument` 的失敗順序是反的

原本先刪 storage 三個 bucket、再刪資料列。中間失敗 → **資料列還在、檔案沒了**：
搜尋找得到、點進去壞掉，沒有人會知道。改成先資料列後檔案 ——
那個方向失敗只會留下孤兒 bytes，看不見也便宜，而且回應會列出來。

**`pd_transfer_audit` 的舊紀錄不再被刪掉。** 原本會整批 delete 再補一筆 delete ——
會被刪掉的稽核紀錄不是稽核紀錄，而「誰下載過這份圖」正是刪檔之後最需要查的。

### ⑥ 三個端點的 `select("*")`

`deleteDocument` 只需要三個路徑與兩個稽核欄位、`updateDocument` 需要
`extracted_text` 但不需要舊的 `search_text`。兩者都改成明確清單
（`deleteColumns()`／`editColumns(dataset)`），`document` 維持 `*`（它真的要全部）。

🔴 **順手修好 schema 讀取器的一個洞**：`document-columns.test.mjs` 的欄位名
regex 是 `[a-z_]+`，**讀不到任何含數字的欄位名** —— `sha256` 就是一個。
也就是那支「拿真 schema 來驗」的測試，對含數字的欄位一直是空轉的。

### ⑦ 簽章網址的 TTL 分兩級

300 秒對列表縮圖夠用，對另外兩個場景不夠：詳情頁讀完一份規格書再按下載很容易
超過 5 分鐘；`syncUrls` 一次發 50 個來源檔、單檔上限 50 MB，五分鐘下載不完。
列表 900 秒、檔案 3600 秒。

### ⑧ `search-ranking.js` 是死碼，而且有 4 個測試在假裝它活著

沒有任何檔案 import 它，邏輯早就搬進 SQL RPC 了。edge function 的 19 個通過測試
裡有 4 個測的是不會執行的程式碼。連同測試一起刪除。

（它的註解「at most 180」對門檻 200，正是 ① 第二點的旁證 —— 是知道的，
但條件留在 SQL 裡沒拿掉。）

### 測試

前端 40 個（+1）、edge function 21 個（19 − 4 死碼 + 6 新）。
另外用 `pglast`（libpg_query 的 Python binding，＝真的 PostgreSQL 文法）
把全部 migration 與 `$$` 裡的函式本體驗過一遍 —— 這裡沒有 Docker、沒有本機
Postgres，`db push` 是直接打正式庫，2.35 就是這樣上線再壞掉的。


## 2.36

### 🔴 三處把 i18n key 直接印到畫面上（五種語言全錯，已上線）

`k_*` / `sk_*` 的標籤表存的是**字典 key**，呼叫端得自己記得包一層 `t()`。
三個地方忘了包：

| 位置 | 使用者看到的 |
|---|---|
| 文件詳情頁頂端的類型徽章 | `k_design_drawing`、`k_cad2` |
| 文件詳情頁「文件類型」欄位 | 同上 |
| 跳過清單匯出的 CSV「原因」欄 | `sk_oversized`、`sk_archive` |

CSV 那一份特別明顯：標題列是翻好的（`t("u_sk_reason")`），資料列卻是 key。

這是 2.33 的同一類事故的第二次。差別在於 2.33 是**字典少了 key**，
`i18n.test.ts` 補上之後守得住；這次三個 key 在五種語言裡都好好存在，
測試全綠 —— 壞的是**呼叫端**。

所以這次不是再加一條「記得包 `t()`」的規則，而是把責任結構性拿掉：

- `lib/document-labels.ts` 現在只導出**已經翻好的字串**
  （`kindOptions` / `kindOptionLabel` / `skipReasonLabel` / `dateTypeLabel`），
  沒有東西可以忘記包
- 各頁自己的 `KIND_OPTIONS`、`SKIP_REASON_LABELS`、`DATE_TYPE_LABELS` 三張表刪除
- `i18n.test.ts` 加一條**來源掃描**：`pages/` `components/` `auth/` 裡不准再出現
  「值是 i18n key」的對照表。塞一張回去驗證過會紅

順帶：`type SkipReason` 從上傳頁移到 `document-labels.ts`，與標籤同住。

測試 34 → 39。前端行為除上述三處外沒有變動。


## 2.35

後端與資料層，前端只動版本號。

### 🔴 搜尋的 trigram 索引從來沒生效過

`pd_*_documents_search_trgm_idx` 建在 `gin(search_text gin_trgm_ops)`，但三代 RPC
（`202608300001` / `202609130006` / `202609130008`）查的都是 `lower(d.search_text)`。
Postgres 不會拿 `col` 上的索引去服務 `lower(col)` 的條件。

不是推論 —— `supabase inspect db index-stats` 的數字：

| 索引 | 大小 | Index scans | Unused |
|---|---:|---:|---|
| `pd_mfg_documents_search_trgm_idx` | 6,760 kB | 0 | true |
| `pd_buy_documents_search_trgm_idx` | 1,680 kB | 0 | true |
| `pd_mfg_documents_pkey`（對照） | 88 kB | 5,073 | false |

從 2026-08-30 建立到 2026-09-28，一次都沒用過。每次搜尋是全表掃描，再
`cross join` 乘上最多 12 個語言變體。

**修法不是加 `gin(lower(search_text))` 表達式索引**：analysis 完成後 worker 會把
最多 300 KB 的文件內文塞進 `search_text`（`pd_worker/run.py` 的 `path_context`），
mfg 那個索引已經 6.7 MB 比表本身還大，再長一份只是把維護成本變兩倍。改成把欄位
正規化成小寫，現有索引直接可用。

🔴 **正規化放在 DB 的 trigger，不是應用層**：`search_text` 有三個寫入點
（`completeUpload`、`updateDocument`、worker），放應用層任何一處漏掉就破壞不變量，
而症狀只是「搜尋變慢」—— 不會有人發現。其他欄位（`title`、`keywords`、
`category_path`）的 `lower()` 保留，它們沒有 trgm 索引。

### AI 佇列狀態 10 次查詢併成 1 次

`analysisStatus` 對每個資料庫各發 5 個 `count(*)`，兩個資料庫 10 次往返，而前端
在分析頁每 15 秒 poll 一次：`pd_mfg_jobs` 929 列累積 10,603 次 seq scan、
`pd_buy_jobs` 266 列 10,332 次。新增 `pd_analysis_queue_status()` RPC，用
`count(*) filter (...)` 讓五個分組共用同一次掃描。

### 搜尋不再 `select("*")`

把 `extracted_text` 與 `search_text`（各最多 300 KB）整份撈出來再丟掉，而
`summary()` 一個欄位都沒用到。改成明確列 25 個欄位。`document` 與
`updateDocument` 端點是真的需要 `extracted_text`，那幾處保留。


## 2.34

修 2.33 自己造成的迴歸。

2.33 清 i18n 孤兒 key 時，我用 grep 找「定義了但沒人用」的 key，regex 只比對
`t(` 沒比對 `tr(`。但 `DocumentLibraryPage` 有**兩處是動態組 key** 的：

```ts
const kindLabel  = (kind)   => KIND_KEYS.includes(kind)    ? tr(`k_${kind}`)   : kind;
const matchLabel = (reason) => MATCH_KEYS.includes(reason) ? tr(`m_${reason}`) : tr("m_default");
```

於是 `k_cad`／`k_image`／`k_document` 與 11 個 `m_*` 被判成孤兒刪掉，文件庫列表的
**文件類型與命中原因整片變成 `m_keyword` 這種 key 名稱**，而且已經上線。
14 個 key × 5 語言已從 git 還原。

🔴 **真正的修法是把這個檢查變成測試**，因為出錯的是掃描方式，不是程式 ——
靠肉眼 grep 找動態 key 本來就不可靠。新增 `src/i18n.test.ts`：

- 五種語言的 key 集合完全一致（少一個就紅）
- 沒有任何語言留空字串
- `KIND_KEYS` / `MATCH_KEYS` / `confirmationLabelKeys` 的每一個值都查得到字典，
  且 `t()` 回傳的不是 key 本身

實測過：把 `m_keyword` 拿掉，上面第一與第三項會同時失敗。

測試 29 → 34 個。


## 2.33

Codex 交接後的第一次體檢。i18n（330 key × 5 語言零缺漏）、上傳的重試／tus 續傳／
sha256 秒傳、路徑穿越白名單都做得很紮實；這一版處理的是**環境與流程**上的三個
會咬人的地方，外加清掉 2.31 刪頁面時沒跟著刪的後端。

### 🔴 `npm run build` 會靜默產出「假資料版」

`demoMode` 的判定是 `!supabaseAnonKey && VITE_PLATFORM_MODE !== "true"` ——
沒帶環境變數就自動成立。demo 版會發一個假的管理員（canUpload／canSync 全開）
讓人進到主畫面，但**現存每一頁用到的 13 個 API 全都沒有 demo 分支**，所以它只是
一個「看起來已登入、每頁都丟登入失效」的殼，而且 rsync 上線沒有任何提示。
實測：`npm run build` 的產物含 `demo-user`，`build:platform` 的不含。

→ **整個拿掉 demo 模式**，不留旗標。不是換預設值 —— 是刪掉一個本來就不能運作的
東西。`vite.config.ts` 另外擋下 `VITE_DEMO_MODE` / `VITE_PLATFORM_MODE` /
`VITE_SUPABASE_ANON_KEY`，照舊文件打指令會**直接 build 失敗**而不是默默忽略。
`npm run build` 現在就是正確的指令，`build:platform` 保留為別名。

### 🔴 批次上傳沒有出口

`upload()` 是一個跑完 200 次、沒有取消機制的 for-await，而 `platformCall` 對 401
只丟普通 Error —— session 中途過期時，剩下 197 個檔會各自送一次注定失敗的請求、
各留一行錯誤，十幾分鐘的進度就沒了。

→ 新增 `SessionExpiredError`（401／403 專用）讓呼叫端 `instanceof` 得出來，批次
立刻停並告知停在第幾個檔；`AuthProvider` 同時把 profile 清掉回到登入轉接頁。
另加「停止」鈕 ＋ `AbortController`，訊號一路串到 api、storage PUT 與 tus。
🔴 tus 的重試迴圈吃不進 AbortSignal，要手動掛 listener 並自己 reject，
否則按了停止那個 Promise 永遠不 settle，整批卡在該檔上。

### 🔴 掃描指紋快取每次被整份覆寫

`saveManifest(nextManifest)` 只寫這一次掃到的檔 —— 掃了子資料夾 A，整個 B 的快取
就沒了，下次掃 B 又要重算全部 sha256（`hashFile` 讀整個檔，上限 50 MB）。

→ 改成 `mergeManifest(舊, 新)` 合併，並加 8,000 筆上限從最舊淘汰。單純合併會無上限
長大，localStorage 一滿 `saveManifest` 把 QuotaExceeded 整個吞掉，就變成「永遠全部
重算」而且沒有任何訊號。

### 其他修正

- **跳過原因的徽章顯示的是 key 名稱**：`{SKIP_REASON_LABELS[reason]}` 漏了包 `t()`，
  畫面上是 `sk_oversized` 而不是「超過大小上限」。
- **切語言時檔案狀態欄不會更新**：狀態是 `status: tr("u_st_pending")` 這樣把「當下
  語言的字串」寫進 state 的。改成存 `{key, params}`，渲染時才翻譯 —— 跟同一支檔案
  上方 `SKIP_REASON_LABELS` 的註解講的是同一條規則，只是當初沒套用到這裡。
- **搜尋競態**：送出鈕雖然 `disabled={loading}`，但輸入框按 Enter 不受 disabled 按鈕
  限制，連按兩次舊結果會蓋掉新的。加序號比對 ＋ abort 前一個請求。順帶把
  `loadMore` 的 offset 改用獨立的 `serverOffset` —— 原本用 `items.length`，而 items
  被 id 去重過濾，會愈翻愈偏。
- **四份 `formatBytes`** 併成一份。頁面那版把 2 GB 顯示成「2048.0 MB」、
  0 bytes 顯示成「1 KB」。
- `directory-access.ts` 與 `incremental-import.ts` 的錯誤訊息原本寫死中文，而且
  會直接顯示給使用者（越南同仁看到的是中文）。改走 i18n。
- 第一次繪製的語言：`initLang()` 原本只在 AuthProvider 的 effect 裡呼叫，跑在首次
  繪製之後，所以「驗證登入狀態…」那個 splash 固定閃一下繁中。改成 `main.tsx` 先叫
  一次（只讀 localStorage），AuthProvider 拿到 session 再叫一次帶 site 的。

### 清理與結構

- **`api.ts` 41 → 13 個方法**。其餘 28 個是 2.31 刪掉 11 個 CPF 時代頁面後的遺留，
  沒有任何呼叫點。`types.ts` 382 → 143 行，刪掉 `supabase.ts`（零 import）與
  `demo-data.ts`，移除未使用的相依 `zod` 與 `@supabase/supabase-js`。
- **i18n 清掉 21 個孤兒 key × 5 語言 = 105 條**，新增 11 個 key × 5 語言。
  其中 6 個 `si_*` 是 2.32 改寫登入頁時我自己留下的。
- **`uploadOne` 抽成 `lib/upload-one.ts`**：三條路（秒傳／tus／一般 PUT）加上重試與
  回退，是整包最會出事的一段，留在 1,000 行的元件裡沒辦法單獨測。行為沒改。
- **路由層 code splitting**：上傳頁與詳情頁改 `lazy()`，tus-js-client 不再進首屏。
- **測試 17 → 30 個**。新增 `uploadOne` 8 個（秒傳、已存在、503 重試會重新取簽章
  網址、400 不重試、「已存在」視為成功、413 訊息、signal 串接、狀態回傳 key）與
  `mergeManifest` 3 個。`App.test.tsx` 原本靠 demo 模式繞過登入，改成餵真的 session
  進 localStorage ＋ 攔 API，順便把「Portal 帶 session 進來」這條路測到，並補一個
  「沒有 session 要停在登入頁」的案例。
  🔴 這個 jsdom 設定沒有 `localStorage`，`src/test/setup.ts` 補了最小實作 ——
  產品程式碼的 try/catch 要留著，Safari 封鎖儲存時是真的會 throw。



## 2.32

風格對齊平台。v2.27 統一了**顏色**，但版面與元件形狀仍是另一套設計語言：
72px topbar、行銷式左右分割登入頁、`font-black`(900) 的標題、48px 表單控制項、
`text-4xl` 頁標、2xl 圓角＋陰影的卡片。顏色一樣、密度差一個量級，一眼還是看得出
不是同一個系統。

- **登入頁重做成 Portal 登入畫面的形狀**（置中單卡、max-w-380、COMART 三角標）。
  🔴 順帶修掉一個**真的看不見的 bug**：那張卡是 `bg-cyan-50` 配 `text-slate-100` ——
  配色統一後 cyan-50 變淺底而 slate-100 是淺色文字，**「單一登入」那行標題整個隱形**，
  而沒有 session 的人一進 Finder 第一眼就是這張卡。
- **AppShell**：topbar 72 → 56px，品牌改成 COMART 三角標 ＋ DM Serif 斜體名稱 ＋
  DM Mono 版本（照 board／admin 的子系統慣例）；語言鈕、側欄寬度與 nav 項目
  對齊 Portal。
- **共用元件一次改到底**（`ui.tsx`）：`PageHeader` 拿掉行銷式 eyebrow、標題降到
  Portal 的 22px/600；`Button` 40 → 34px；`Card` 去掉陰影與 2xl 圓角；`Badge`、
  `EmptyState` 同步縮。改一個共用元件比逐頁改 class 可靠得多。
- 各頁 49 處 `font-black`／`text-4xl`／`rounded-2xl` 降級。
- 🔴 **`styles.css` 的 `input,select,textarea { font: inherit }` 是個隱形 bug**：
  `font` 簡寫會把 font-size 一起設成繼承來的 16px，而這條規則**沒有進 @layer**，
  未分層的規則在串接上贏過 Tailwind utilities —— 結果全站所有輸入框與下拉的
  `text-sm`／`text-xs` 都不生效，一律 16px。改成只繼承 `font-family`。

typecheck／lint／17 個測試全過。

## 2.31

刪除 11 個沒有掛上路由的 CPF 時代模組：`AdminPage`／`DocumentDetailPage`／
`DocumentsPage`／`PilotUploadPage`／`ProductDetailPage`／`ReviewPage`／`SearchPage`／
`TrashPage`／`UploadPage`，以及只被它們用到的 `DocumentRow`／`ProductCard`。

`App.tsx` 一行都不用改（本來就沒有引用）。確認方式是逐一 grep：
唯一看起來像引用的幾處全是**子字串誤判**（`PdDocumentDetailPage` 含
`DocumentDetailPage`、`IncrementalUploadPage` 含 `UploadPage`）或**死模組互相引用**。

🔴 **「沒有人 import」不等於「不影響產物」**：Tailwind 仍然會掃描它們並把樣式
編進 CSS。刪掉之後 **CSS 51,780 → 39,057 bytes（−24.6%）**，而且編譯後的 CSS
裡最後兩處淺色殘留（`#f8fafc`／`#e5e9e8`，來自 `ProductDetailPage` 的
radial-gradient）也一併消失了。

typecheck／lint／17 個測試全過。

## 2.30

上傳工具（`IncrementalUploadPage`）也上五語，Finder 的 i18n 至此完成（330 個 key）。
涵蓋批次匯入、手動上傳、預設目錄補檔、AI 文件分析與 Users 權限管理五個畫面，
以及上傳過程的所有進度與錯誤訊息。

- 🔴 **`SKIP_REASON_LABELS` 一樣改成存 key**（同其他標籤表）。
- 🔴 **`名片` 這個中文不可以翻**：它在 `excludedName()` 裡是**比對實際檔名**的規則，
  不是介面文字。已就地加註，免得下次掃描時被當成漏翻。
- 非元件的輔助函式（`uploadResumable`／`prepareBatch`／`storageUploadError` 等）
  用模組層級的 `tr`，元件用 `useT()` 回傳的 `t` —— 兩者是同一個函式，
  差別只在元件需要訂閱重繪。
- `useCallback` 的 deps 補上 `t`。它是模組層級的穩定參考，不會造成重跑。

## 2.29

讀取路徑全部上五語（173 個 key）：DocumentLibraryPage、PdDocumentDetailPage、
SignInPage、NotFoundPage、ImportToolsPage、components/ui、lib/api。

- 🔴 **所有標籤表一律存 key 不存文案**（`kindLabels`／`matchLabels`／`KIND_OPTIONS`／
  `DATE_TYPE_LABELS`／`confirmationLabels`）。那些物件在**模組載入時求值一次**，
  存死字串的話切語言換不掉 —— 這是這次改動裡最容易漏、也最難察覺的一項。
- 🔴 **修掉一個 i18n 之後才會變成 bug 的寫法**：`PdDocumentDetailPage` 原本用
  `saveMessage.startsWith("搜尋關鍵字")` 判斷訊息要顯示在哪一區。翻譯之後其他
  四種語言必定判斷失敗，而壞法是「成功訊息不出現」—— 沒有人會回報。
  改成明確的 `savedKeywords` 旗標。
- `lib/api.ts` 的錯誤訊息也走 `t()`（它不是元件，用的是模組層級的 `t`，
  這正是 i18n 用 module state 而不是 React context 的理由）。

⚠️ **`IncrementalUploadPage`（上傳工具，約 172 條）刻意未轉換** —— Woody 2026-09-26
決定只做讀取路徑：上傳工具只有 uploader 名單那幾個人會用，且多在台灣。
`lib/utils.ts` 的 `processingLabels`／`sensitivityLabels` 同理未轉，
它們目前只被沒有掛路由的舊頁面引用。

## 2.28

- 建立 i18n 基礎（`src/i18n.ts`）：`t()`／`useT()`／`setLang()`，
  與其他系統共用 `localStorage['comart-lang']`。
  🔴 用 `useSyncExternalStore` 訂閱而不是 React context —— 這個 app 有很多
  非元件的呼叫點（`lib/api.ts` 的錯誤訊息、`lib/utils.ts` 的標籤表）也要拿得到
  當下語言，所以事實來源是模組 state，hook 只是讓元件訂閱它。
- topbar 與行動版側欄加上語言鈕（樣式與其他系統的 `.lchip` 一致）。
- AppShell 的字串已全部走 `t()`。🔴 `navigation` 陣列存 **key 不存文案** ——
  那個陣列在模組載入時求值一次，存死字串就換不掉了。
- 越南文字型：`html[lang="vi"]` 換成 Be Vietnam Pro
  （DM Sans 沒有越南文字集，見 CLAUDE.md）。
- `initLang()` 在 AuthProvider 取得 session 之後、打 bootstrap **之前**呼叫 ——
  擺在回應之後的話後端不通時整個畫面會停在繁中。

⚠️ **其餘頁面的字串尚未轉換**（約 430 條）：DocumentLibraryPage、
PdDocumentDetailPage、IncrementalUploadPage、ImportToolsPage、SignInPage、
NotFoundPage 與 `lib/` 的標籤表。畫面目前仍是繁中，切語言只會換掉外框與導覽。

## 2.27

- 配色與字體改為與 COMART Platform 一致（Portal `index.html` 的 `:root`）：
  主色由 cyan `#22d3ee` 換成平台的 `--ac` 藍 `#2D7FF9`，深色表面／邊框／文字
  改用 `--bg`／`--s1`／`--s2`／`--br`／`--tx` 那一組，字體改為 DM Sans／DM Mono。
- 做法是 Tailwind 4 的 `@theme` **直接改寫 slate／cyan 兩條色階**，
  所以 640 多處既有 class 不必逐一改寫。改配色請改 `src/styles.css` 的 `@theme`，
  不要去改各頁的 class。
- `styles.css` 裡原本那一長串 `.text-slate-*` / `.text-cyan-*` 的 `!important`
  覆寫已刪除（改由 `@theme` 統一），只留語意上真的是「淺色表面」的那幾條。
- 登入頁右半邊原本是白底（整個平台唯一的亮色畫面），改為深色。
- 主色按鈕上的文字由 `text-slate-950` 改為 `text-white` —— 色階改寫後
  slate-950 是深藍，留著會變成深藍字配藍底。

## v2.26 — 2026-09-13

- Document Finder 左上角返回按鈕由「Portal」改為「Product Dev」，直接回到 Product Dev 工作區首頁；桌機、手機及本機預覽使用相同導覽層級。

## v2.25 — 2026-09-13

- 新增 `car charger`、車充／車用充電器、簡中車充／車用充電器及越南文 `sạc ô tô`／`sạc xe hơi` 的雙向搜尋對應。
- 自製品與外購品搜尋改為每次 30 筆，顯示完整命中總數，並可由結果底部逐批載入後續 30 筆直到全部顯示。
- 多語查詢改由資料庫一次合併、去重、計算總數及分頁，避免舊版每個別名各查 20 筆造成總數錯誤與遺漏。

## v2.24 — 2026-09-13

- 手動上傳成功或內容重複略過後，自動清空已選檔案與上傳狀態；上傳失敗時保留檔案與錯誤，方便重試。
- 自製品與外購品搜尋共用繁中、簡中、英文、越南文查詢展開；加入產品配件領域常用譯名、無聲調越南文及繁簡中文字轉換，原始查詢仍維持最高權重。
- 多語展開後只保留直接欄位命中或足夠高分的全文命中，排除低分 trigram 模糊結果，避免翻譯搜尋帶出大量不相關文件。
- 後續 AI 文件分析會為明確產品概念建立繁中、簡中、英文、越南文關鍵字，型號、品牌與廠商名稱仍保留原文。

## v2.23 — 2026-09-13

- 手動上傳移除分類路徑欄位，流程簡化為選擇自製品／外購品、拖放或從資料夾選取一個檔案、直接上傳。
- 手動上傳的文件直接保存於所選邏輯資料庫根目錄；仍以 SHA-256 檢查內容重複，且維持每次一份與 50 MB 上限。

## v2.22 — 2026-09-13

- 「少量快速上傳」更名為「手動上傳」，並升級為左側導覽的獨立 TAB，不再藏在文件工具內。
- 自製品／外購品改為大型雙按鈕，提供明確選取狀態；每次只接受一個檔案，可拖放或從電腦資料夾選擇。
- Users 頁改為每次直接讀取 Platform `users` 主表，同時顯示啟用與停用帳號，並新增「重新同步」按鈕與同步人數。

## v2.21 — 2026-09-13

- Product Finder Users 將「上傳」與「全庫補檔／下載」拆成兩個獨立權限，可以單獨授予或撤銷。
- 既有 Product Finder Users 只保留上傳權限，不會因升級自動取得全庫原檔下載權限；管理員也需明確開啟自己的全庫補檔權限。
- 後端的全庫 manifest 與 signed URL 介面改為只接受補檔授權；只有上傳權限者無法取得全庫清單或下載連結。

## v2.20 — 2026-09-13

- 自製品與外購品的搜尋結果及空白查詢列表，統一依「命中率 → 主要文件日期（版本日期）→ 原始檔案修改日期」由高到低排序。
- 相同命中率時優先顯示版本日期較新的文件；版本日期仍相同時，再依本機原檔修改日期排序，缺少日期的文件排在後面。

## v2.19 — 2026-09-13

- AI 分析從文件內容選出一個主要文件日期，報價單優先報價日期，BOM 優先發行日期；保存日期類型、原文證據與頁碼／工作表位置，沒有證據時維持待辨識。
- AI 同時辨識版本／版次及來源證據；列表與預覽頁皆顯示主要日期與版次，報價單及 BOM 的日期使用醒目樣式。
- 文件資訊編輯新增主要日期與版本／版次，人工修正會標記為人工設定並立即更新搜尋文字。
- 預覽頁新增僅限 Admin 的永久刪除，可選只刪雲端或雲端及本機；雲端範圍包含資料庫、AI 結果、工作、預覽、縮圖與 Supabase 原檔，本機刪除只限已授權預設 products 目錄的精確相對路徑。

## v2.18 — 2026-09-13

- 批次盤點單檔上限統一為 50 MB，配合 Supabase Spend Cap 下的全域限制；不納入 Creo 原生版本檔，自製與外購的既有分類規則不變。
- 將「可用檔案」改為「符合格式」，新增「唯一檔案」，並將「已匯入」改為「雲端已有相同內容」，避免把資料夾內重複誤認成待匯入。
- 將未納入匯入的文件拆分為非產品目錄、空檔案、系統／排除檔、超過 50 MB、壓縮檔與不支援格式，並可下載 CSV 清單逐筆確認。
- Storage 上傳錯誤會解析實際回應；檔案過大時直接顯示檔案大小與 Supabase Storage 限制，不再只顯示籠統的 HTTP 400。

## v2.17 — 2026-09-12

- 修復大於 6 MB 的檔案可能因 Supabase TUS signed token 回傳 `Invalid Compact JWS` 而無法上傳。
- TUS 遇到明確的簽章授權錯誤時，自動改用同一份短效 signed URL 進行標準安全上傳；不公開 service-role key、不覆寫既有物件，SHA-256 去重與完成後建索引流程維持不變。
- 以 Supabase 實際端點驗證：同一短效簽章在 TUS 回傳 400／403，但標準 signed upload 成功；測試物件已立即清除。

## v2.16 — 2026-09-04

- 永久移除舊版 CPF 的 28 個 `cpf_` 資料表、2 個 views、33 個 functions、9 個 enum types，以及所有舊 Storage policies。
- 清空並刪除 `cpf_source`、`cpf_preview`、`cpf_thumbnail` 三個私有 buckets；共移除 2,051 個物件，約 2.40 GB。
- 退役舊 `cpf-platform-api`、`cpf-ai-worker` Edge Functions 與舊版排程 workflow，避免再次寫入已退役資料結構。
- 現行 v2 文件分析端點更名為 `pd-ai-worker`，只接受指定的 `cpf_worker` Supabase Secret Key；不再接受 legacy service-role fallback，也不信任未驗證的 JWT payload。
- 清除後確認 `cpf_` relations、functions、types、policies、Storage buckets 與 objects 均為 0；`pd_*`、KMS 與 Quotation 資料未受影響。

## v2.15 — 2026-09-01

- 移除左側欄底部重複的「返回 Platform」，統一使用左上角「Portal」。
- 自製品與外購品搜尋由後端限制最多回傳 20 份文件，空白搜尋顯示最新 20 份，降低資料庫與縮圖流量。
- 將批次匯入、少量上傳、預設目錄補檔、文件分析拆成四個獨立功能入口；只有文件分析頁會輪詢 AI 狀態。
- 「E. Product Finder 上傳者」獨立成管理頁並更名為「Users」。

## v2.14 — 2026-09-01

- 「搜尋關鍵字」卡片新增獨立的「編輯關鍵字」按鈕，不必先進入文件資訊編輯。
- 關鍵字可用頓號、逗號或換行分隔，最多 30 個；可在原位置直接儲存或取消。
- 儲存後明確顯示搜尋索引已立即更新。

## v2.13 — 2026-09-01

- 自製品與外購品文件詳情頁的「文件資訊」加入編輯模式。
- 可修改顯示名稱、文件類型、來源工廠／廠商、分類路徑、搜尋關鍵字、摘要與參考資料狀態。
- 原始相對路徑、SHA-256、檔案大小與 Storage 位置維持唯讀，避免文件索引與原檔失聯。
- 儲存時同步重建該文件的搜尋文字，人工修正立即影響搜尋結果。
- 每次人工修改保存修改前、修改後、操作者與時間，供日後稽核。

## v2.12 — 2026-08-31

- 第一次選擇 `products` 後，將目錄控制代碼保存在瀏覽器 IndexedDB；日後直接掃描預設目錄，也可手動更換。
- 新增 Supabase → 本機安全補檔：只下載雲端有、本機沒有的文件，沿用 OwnProduct／Outsourcing 相對路徑，絕不覆寫同路徑檔案。
- 同路徑不同 SHA-256 明確列為衝突，留待人工判斷；所有補檔連結短效化並留下下載請求稽核。
- 上傳權限改為 Product Finder 專用白名單；管理員可在匯入頁直接勾選同事，不改變 KMS 或其他 Platform 權限。
- 文件索引新增上傳者與顯示名稱，並記錄上傳稽核；管理員永久保留上傳權限。
- 驗證：12 個單元測試、ESLint、TypeScript 與正式 Vite build 全數通過。

## v2.11 — 2026-08-31

- 超過 6 MB 的原始檔案自動改用 Supabase TUS 續傳上傳，並固定使用 6 MB chunk。
- 大檔上傳使用短效 signed token，瀏覽器不會取得 service-role key。
- 顯示大檔續傳進度；上傳完成後才建立文件索引，不覆寫已存在的 SHA-256 物件。

## v2.10 — 2026-08-31

- 搜尋加入有界的中英產品同義詞展開；`3 in 1`、`3-in-1`、`三合一` 與 `3合1` 可互相命中。
- 支援常用合一數量、Watch／手錶、wireless charging／無線充電、MagSafe／磁吸、手機支架、車架、指環架、行動電源、折疊、桌面與風扇等詞組。
- 原文精確命中維持最高權重；翻譯／同義詞結果略降權並標示「中英同義詞命中」。
- 查詢展開最多 12 組、每組仍沿用既有有界索引 RPC，不啟用每次搜尋的 OpenAI API 呼叫。

## v2.09 — 2026-08-31

- 匯入頁新增 AI 文件分析控制區，可直接選擇自製品、外購品或兩者並設定本次份數。
- 顯示兩個邏輯資料庫的排隊、處理中、可重試、已完成與三次失敗數量，並每 15 秒更新。
- 前端只呼叫受 Platform session 與編輯權限保護的 Supabase API；GitHub 憑證只保留在後端 Secrets。
- 未完成一次性後端授權時，按鈕會停用並明確說明，不會將 token 暴露給瀏覽器。

## v2.08 — 2026-08-30

- Storage 遇到 408、425、429 或 5xx 暫時性錯誤時，會重新取得 signed upload URL 並最多重試三次。
- 若前一次請求雖回傳錯誤但原檔已進入 Storage，下一次會直接補建文件索引。
- 快速上傳與 200 份批次匯入共用同一套容錯流程。

## v2.07 — 2026-08-30

- 資料夾盤點保存相對路徑、檔案大小、修改時間與 SHA-256；下次只重新雜湊新增或變更檔案。
- 新增 1～10 份少量快速上傳，可指定自製／外購資料庫及分類路徑。
- 外購品快速上傳以分類路徑第一層作為廠商名稱；兩種匯入方式都不會自動執行 AI。
- 快取無法讀取、已清除或空間不足時，安全退回完整 SHA-256 盤點。

## v2.06 — 2026-08-30

- 將固定 20＋20 試點選檔改為完整資料夾盤點與增量批次匯入，每批最多 200 份。
- 新增只讀 SHA-256 批次查詢，精確區分已匯入、待匯入、資料夾內重複與不支援檔案。
- 每批優先平衡自製品與外購品各 100 份；單一資料庫不足時，由另一資料庫補足剩餘名額。
- 匯入完成後可直接準備下一批，不需重新選擇資料夾；AI 工作仍維持手動執行。

## v2.05 — 2026-08-30

- 自製品路徑中的報價、估價與成本文件統一歸入 `BOM／成本`，不再寫入只屬於外購品的 `quotation` 類型。
- 修復兩份已進入 Storage 的自製品商業文件無法補建索引的資料表 constraint 錯誤。

## v2.04 — 2026-08-30

- 修正 Supabase 在建立 signed upload URL 階段就回傳 `The resource already exists` 的恢復路徑。
- API 明確回傳 `storageExists`，前端直接補建資料庫索引，不要求 signed URL、也不覆寫既有原檔。

## v2.03 — 2026-08-30

- 修復原檔已成功進入 Storage、但資料庫索引尚未建立時，重試被 `The resource already exists` 阻擋的問題。
- SHA-256 物件已存在時不覆寫原檔，直接補建文件索引與背景工作。

## v2.02 — 2026-08-30

- 試點候選排除業務名片等非產品圖片。
- 格式配額不足時優先補入 PDF／Office 文件，避免以同一產品的重複圖片補滿 20 份。

## v2.01 — 2026-08-30

- 20＋20 試點改為跨來源工廠、廠商與產品目錄分散取樣，避免同一產品的連續圖片占滿圖片配額。
- 位於 `Outsourcing` 根目錄、沒有廠商資料夾的文件改標為「待確認廠商」，不再把檔名誤認為廠商。

## v2.00 — 2026-08-30

- 重建為 Document Finder：一筆搜尋結果只代表一份原始文件，不再自動建立產品主檔或拆分文件內圖片。
- 自製品與外購品使用完全分離的 `pd_mfg_`／`pd_buy_` 資料表、工作佇列及私有 Storage bucket。
- 自製品搜尋設計圖、BOM、CAD 與產品圖；外購品搜尋型錄、報價單、簡報、產品圖及廠商名稱。
- 檔名、目錄與文件全文採有界索引搜尋；通用截圖與參考資料降低排名，且參考資料預設隱藏。
- 新增 20＋20 試點匯入頁與手動背景解析 workflow；不啟用每五分鐘自動排程。
- 舊 `cpf_`、KMS 與 Quotation 均未修改，待 v2 試點驗證後再另行決定舊 CPF 退役。

## 版本規則

- 畫面顯示格式：`v2.00`；架構重建增加主版本，後續一般改版每次增加 `0.01`。
- 每次正式發布 CPF 前端、API、worker 或資料流程變更，版本增加 `0.01`。
- 每次改版必須先更新 `src/version.ts`，並在本檔新增日期、範圍與驗證結果。
- 單純重新執行既有匯入工作或修正資料內容，不增加程式版本。

## v1.14 — 2026-08-02

- 搜尋改為資料庫索引先取候選、再讀取必要關聯，不再在每次搜尋載入整個 CPF corpus 或對全庫 embedding 排序。
- 預設為精準關鍵字模式：型號、產品名稱、檔名、路徑與全文命中優先；語意擴大搜尋暫停，待獨立評估後才恢復。
- 保留「包含參考資料」篩選；展後整理、LINE 相簿與 phase out 預設不進搜尋。

## v1.13 — 2026-08-01

- 搜尋預設改為精準模式：型號、產品名稱、檔名、路徑與全文優先，不再自動呼叫語意 embedding 或混入相似圖片。
- 精準結果不存在時，使用者才可主動要求「查看相關結果」。
- 每筆產品／文件結果顯示命中原因。
- 展後整理、LINE 相簿與 phase out 文件預設隱藏；供應商、外購、RFP 與其他資料列為「參考」，可由篩選選擇納入。此分類不刪除原檔、AI 分析或既有關聯。

## v1.12 — 2026-08-01

- Product Finder 左上角新增與其他子系統一致的「← Portal」邊框按鈕，桌機與手機皆顯示。
- Product Dev 工作區首頁同步把 Portal 返回按鈕移至品牌左側。
- 正式發布 v1.10、v1.11 累積的 worker、API 與前端修正至 GitHub Pages。

## v1.11 — 2026-08-01

- 修正文件增加至 696 份後，Edge Function 以單一 `.in(...)` 請求載入全部版本而超過 PostgREST URL 上限的問題。
- 文件版本、產品廠商與產品文件關聯改採每批 100 筆查詢，恢復產品搜尋與文件詳情內容。
- 產品搜尋、文件搜尋與文件詳情新增明確錯誤提示，不再以空結果或無限載入掩蓋 API 錯誤。
- 明確區分 AI 成本：空白列表、詳情、預覽與下載不呼叫 OpenAI；非空白語意搜尋仍會建立查詢 embedding。

## v1.10 — 2026-08-01

- Worker 寫入 PDF／Office 抽取文字前移除 PostgreSQL 無法儲存的 NUL 控制字元。
- 不修改來源原檔，並保留其餘可辨識文字、全文索引與 AI 分析流程。
- 以實際異常 PDF 驗證重試成功；本批 200 份最終無失敗。

## v1.09 — 2026-08-01

- GitHub Actions 手動執行不再受到自動排程開關阻擋，可安全單次驗證新 Secret Key。
- 每五分鐘排程仍只有在 `CPF_WORKER_ENABLED=true` 時才會執行。
- 本版不啟用自動排程，也不修改 KMS。

## v1.08 — 2026-08-01

- CPF worker 與 AI proxy 支援 Supabase 新式 `sb_secret_...` 金鑰。
- `cpf-ai-worker` 優先驗證名為 `cpf_worker` 的新 Secret Key，遷移期間保留 legacy service-role 回退。
- Worker、主檔回填及 resumable upload 改以 `apikey` header 傳送 Supabase API key。
- 本版不變更 KMS 金鑰，也不停用 legacy API keys。

## v1.07 — 2026-08-01

- 修正長篇 Office／PDF 文件建立 embedding 時可能超過 8,192-token 上限的問題。
- 語意索引優先保留 AI 摘要與產品名稱、型號、功能、關鍵字，再補入來源原文。
- embedding 輸入採 6,000 字元安全上限；不影響原始文件、全文索引或 AI 結構化分析內容。
- worker 遇到單一文件失敗仍會停止該輪，只重試受影響工作，不重跑成功文件。

## v1.06 — 2026-08-01

- 修正 AI 的一般「缺資料／不應推定」說明被誤標為高優先例外的問題。
- 缺品牌、型號、規格、正式產品證據或僅有資料夾線索，改為自動略過並保留於資料完善清單。
- 只有廠商推定、疑似重複、整體信心低於 60%，以及同一文件包含多個完整產品時維持待審。
- 既有誤標的一般欄位提醒同步解除，不會再阻擋文件完成。
- 200 檔擴充批次採每輪 20 檔領取、失敗監控與 SHA-256 去重。

## v1.05 — 2026-08-01

- 工作模式改為「AI 結果直接可用，人工只處理高風險例外」。
- 一般提醒可一次略過，不再要求逐份文件確認，也不會把 AI 值冒充為人工確認。
- 廠商推定、疑似重複及高優先衝突保留於「AI 例外」。
- 缺分類、廠商、型號與代表圖改為選用的資料完善清單，不要求清零。
- 後續 worker 會自動結束一般分析工作，只有高風險例外維持待審。
- 產品候選與來源證據在略過後仍保留，日後可再建立或連結產品主檔。

## v1.04 — 2026-08-01

- AI 審核的產品主檔待補清單新增每列產品小縮圖。
- 尚未指定正式代表圖時，暫時使用可存取的來源文件縮圖協助人工判斷。
- 點擊縮圖可直接開啟產品詳情；沒有任何可用影像時明確顯示「無縮圖」。
- 來源縮圖只供審核顯示，不會自動寫入或取代正式代表圖。

## v1.03 — 2026-08-01

- 產品主檔待補清單支援批次勾選及全選目前可修改項目。
- 正式分類可一次套用至多個缺分類產品。
- 廠商與角色可一次套用至多個未連結廠商產品。
- 缺型號產品可逐列填入不同型號，再一次送出。
- 批次操作只補空缺，不覆寫既有人工值，並完整寫入稽核紀錄。

## v1.02 — 2026-08-01

- 完成「來源文件 → 產品主檔 → 正式分類／廠商」審核閉環。
- 文件詳情顯示已連結產品主檔、正式分類，以及所有廠商與角色。
- 非完整產品辨識項目可人工選擇建立新主檔、連結既有主檔，或只保留於文件索引。
- 建立／連結時可同時指定正式分類與多個廠商角色，所有決定寫入稽核紀錄。
- AI 審核頁新增產品主檔待補清單，可獨立篩選缺分類、廠商、型號或代表圖。
- 本版只提供處理工具，不會自動接受或修改現有產品資料。

## v1.01 — 2026-07-31

- 修正 PDF 預覽：直接使用 `cpf_source` 的短效 signed URL，不再錯誤要求不存在的 `preview_path`。
- 後端 `preview` 接口對 JPG、JPEG、PNG、PDF 統一回傳原始來源；Office 文件仍使用轉換後的 `cpf_preview`。

## v1.00 — 2026-07-31

- Product Finder 整合至 COMART Platform / Product Dev。
- 支援產品／文件搜尋、產品主檔、正式分類、廠商主檔、AI 審核及文件預覽。
- 圖片直接預覽原圖；PDF 直接預覽；Office 文件由 worker 產生 PDF 預覽。
- 文件詳情區分完整產品、候選產品、變體、設計資產、零件及舊版分析狀態。
- 正式分類在管理頁及產品詳情頁提高視覺層級。
