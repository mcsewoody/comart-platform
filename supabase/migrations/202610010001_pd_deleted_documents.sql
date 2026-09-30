-- Product Finder：刪除後不再匯入（Finder 2.39，2026-10-01）
--
-- 🔴 問題：批次匯入判斷「匯入過沒有」唯一的依據是「伺服器上還有沒有同一個
--    sha256」。刪除把整列拿掉之後，對下一次掃描來說它跟全新的檔案一模一樣 ——
--    本機（或另一台電腦、另一位同事的電腦）只要還有那個檔，就會被匯入回來。
--    刪除對話框的「同時刪除本機檔案」只刪得到**當下那一台**的預設目錄，擋不住。
--
-- 這張表記下「刻意刪掉的內容指紋」。依據是 sha256，所以不管在哪一台電腦、
-- 檔名或路徑怎麼變都擋得住。擋的位置在伺服器（initUpload／completeUpload），
-- 前端的略過只是讓盤點畫面講得清楚 —— 改前端繞不過去。
--
-- 還原：只有 admin（與刪除同一個權限）能帶 restore:true 重新匯入，
-- 完成後這一列才移除。

begin;

create table if not exists public.pd_deleted_documents (
  dataset text not null check (dataset in ('mfg', 'buy')),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  relative_path text not null default '',
  title text not null default '',
  deleted_by text not null default '',
  deleted_by_name text not null default '',
  deleted_at timestamptz not null default now(),
  primary key (dataset, sha256)
);

comment on table public.pd_deleted_documents is
  '刻意刪除的 Product Finder 文件指紋；批次匯入與上傳一律略過，admin 以 restore 重新匯入時移除';

-- 🔴 RLS 開著、零 policy：存取一律經 pd-documents-api（service role）。
alter table public.pd_deleted_documents enable row level security;
revoke all on public.pd_deleted_documents from anon, authenticated;

-- 稽核動作多一種 'restore'（admin 把刪過的文件重新匯入）
alter table public.pd_transfer_audit
  drop constraint if exists pd_transfer_audit_action_check;
alter table public.pd_transfer_audit
  add constraint pd_transfer_audit_action_check
  check (action in ('upload', 'download_request', 'delete', 'restore'));

-- 補回既有的刪除：pd_transfer_audit 從 2.37 起保留 delete 紀錄。
-- 只補「目前資料庫裡已經沒有這個 sha256」的 —— 刪了之後又被匯入回來的，
-- 現在是一份正常的文件，不該突然變成被擋。
insert into public.pd_deleted_documents (dataset, sha256, relative_path, deleted_by, deleted_by_name, deleted_at)
select distinct on (a.dataset, a.sha256)
  a.dataset, a.sha256, a.relative_path, a.emp_id,
  coalesce(nullif(u.name_zh, ''), nullif(u.name_en, ''), a.emp_id),
  a.created_at
from public.pd_transfer_audit a
left join public.users u on u.emp_id = a.emp_id
where a.action = 'delete'
  and not exists (select 1 from public.pd_mfg_documents d where a.dataset = 'mfg' and d.sha256 = a.sha256)
  and not exists (select 1 from public.pd_buy_documents d where a.dataset = 'buy' and d.sha256 = a.sha256)
order by a.dataset, a.sha256, a.created_at desc
on conflict (dataset, sha256) do nothing;

commit;
