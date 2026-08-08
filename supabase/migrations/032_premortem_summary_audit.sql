-- 032_premortem_summary_audit.sql
-- 事前驗屍：AI 評論與總結是「會永久存檔的會議正式結論」，一旦被覆寫就再也回不去。
-- 這支 trigger 讓覆寫**留下痕跡**：每次 ai_summary 有變動，就先把舊版原封存進 log。
--
-- 為什麼用 trigger 而不是 RLS：
--   RLS 會被 service_role 繞過（sb-proxy 正是用 service_role 轉發），所以 RLS 對本站無效；
--   **trigger 不會被 service_role 繞過**，任何經 PostgREST 的寫入都會觸發，這是唯一
--   前端與代理都繞不過的一層。
--
-- log 表刻意**不加進 sb-proxy 的 ALLOWED_TABLES**：稽核紀錄不該能被應用程式讀取或刪除，
-- 只能從 Supabase 後台查。要查歷史版本：
--   select changed_at, phase, summary_edited_by, left(ai_summary_a, 80)
--     from premortem_summary_log where session_id = '<id>' order by changed_at desc;

create table if not exists public.premortem_summary_log (
  id                bigserial primary key,
  session_id        text not null,
  ai_summary        text,          -- 被覆寫掉的「舊版」內容
  ai_summary_a      text,
  ai_summary_b      text,
  phase             text,          -- 當時的階段（定稿後被改動特別值得注意）
  summary_at        timestamptz,   -- 舊版的 AI 產生時間
  summary_edited_at timestamptz,   -- 舊版最後一次人工修訂時間
  summary_edited_by text,
  changed_at        timestamptz not null default now()
);

create index if not exists premortem_summary_log_session_idx
  on public.premortem_summary_log (session_id, changed_at desc);

-- 與 board 其餘表同一套安全模型：啟用 RLS 且不給任何 anon policy，
-- 擋掉以 anon key 直連 REST 的讀取（service_role 仍可寫入，trigger 需要）。
alter table public.premortem_summary_log enable row level security;

create or replace function public.premortem_log_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 只在「原本有內容且內容被改動」時留存；第一次由 null 寫入不算覆寫，不必記
  if coalesce(old.ai_summary, '') <> ''
     and (old.ai_summary   is distinct from new.ai_summary
       or old.ai_summary_a is distinct from new.ai_summary_a
       or old.ai_summary_b is distinct from new.ai_summary_b) then
    insert into public.premortem_summary_log
      (session_id, ai_summary, ai_summary_a, ai_summary_b, phase,
       summary_at, summary_edited_at, summary_edited_by)
    values
      (old.id, old.ai_summary, old.ai_summary_a, old.ai_summary_b, old.phase,
       old.summary_at, old.summary_edited_at, old.summary_edited_by);
  end if;
  return new;
end;
$$;

drop trigger if exists premortem_summary_audit on public.premortem_sessions;
create trigger premortem_summary_audit
  before update on public.premortem_sessions
  for each row
  execute function public.premortem_log_summary();
