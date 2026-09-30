-- KMS 原始檔 bucket 改私有（KMS v2.46，2026-10-01）
--
-- 🔴 改之前的狀態（實測）：
--   - kms-files 是 public bucket，而且有一條 policy「public read kms files」——
--     1,209 份文件的原始檔（約 2 GB，含機密等級 2／3）只要知道網址，
--     **不必登入就能下載**。網址格式是 uploads/<毫秒時間戳>_<檔名>，並不難猜。
--   - 另一條「anon upload kms files」讓**印在網頁原始碼裡的 anon key**
--     就能往這個 bucket 寫任意檔案。
--
-- 之後：
--   - 讀：kms-secure-docs 的 fileUrl（先用與清單同一套規則判斷看不看得到這份文件，
--     再簽 10 分鐘網址）
--   - 寫：kms-secure-docs 的 uploadUrl（要有效 session，路徑由伺服器決定）
--   - sb-proxy 的 storage 轉發對 kms-files 一律 403（那裡無法依機密等級判斷）
--
-- ⚠️ kms_documents.file_url 的格式刻意不改（仍是 .../object/public/kms-files/...），
--    它現在只是定位字串，本身打不開。
--
-- 還原（若需要）：
--   update storage.buckets set public = true where id = 'kms-files';
--   create policy "public read kms files" on storage.objects for select using (bucket_id = 'kms-files');
--   create policy "anon upload kms files" on storage.objects for insert with check (bucket_id = 'kms-files');

begin;

update storage.buckets set public = false where id = 'kms-files';

drop policy if exists "public read kms files" on storage.objects;
drop policy if exists "anon upload kms files" on storage.objects;

commit;
