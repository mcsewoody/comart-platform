-- AI Woody：入職考試 ＋ 一致性檢查（2026-10-08，Woody 定案）
--
-- 🔴 四張表全部 RLS 開 ＋ 零 policy ＋ revoke，而且刻意不在 sb-proxy 的 ALLOWED_TABLES ——
--    存取一律經 ai-woody edge function（service role），由它判斷身分：
--    · 題庫（含評分要點）前端永遠拿不到 —— 拿得到就等於拿到答案。
--    · 考試成績：本人看自己的；Woody（C00001）與 admin 看全部（Woody 定案）。
--    · 一致性檢查：只有 Woody。
-- 題目與評分要點的「內容」不進 repo（公開），由本機腳本從 .local/woody/*.md 匯入。
--
-- 還原：drop table public.aw_eval_results, public.aw_eval_runs, public.aw_eval_items,
--       public.aw_exam_attempts, public.aw_exam_bank;

create table if not exists public.aw_exam_bank (
  id         text primary key,                 -- E01…
  category   text not null,
  question   text not null,
  points     jsonb not null default '[]'::jsonb,   -- 評分要點
  minus      jsonb not null default '[]'::jsonb,   -- 扣分方向
  source     text,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.aw_exam_attempts (
  id           uuid primary key default gen_random_uuid(),
  emp_id       text not null,
  emp_name     text,
  dept         text,
  site         text,
  question_ids text[] not null,
  answers      jsonb,
  results      jsonb,          -- [{id, score, comment}]
  total        integer,
  passed       boolean,
  status       text not null default 'open' check (status in ('open','graded','abandoned')),
  lang         text,
  started_at   timestamptz not null default now(),
  graded_at    timestamptz
);
create index if not exists aw_exam_attempts_emp_idx on public.aw_exam_attempts (emp_id, started_at desc);

create table if not exists public.aw_eval_items (
  id         text primary key,                 -- V01…
  category   text not null,
  question   text not null,
  must       jsonb not null default '[]'::jsonb,
  must_not   jsonb not null default '[]'::jsonb,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.aw_eval_runs (
  id              uuid primary key default gen_random_uuid(),
  persona_version text,
  docs_count      integer,
  status          text not null default 'running' check (status in ('running','done','failed')),
  total           integer,
  max_total       integer,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);

-- 一題一列：瀏覽器並行跑多題時各寫各的，不會互相蓋掉（同 chat_presence 的理由）
create table if not exists public.aw_eval_results (
  run_id     uuid not null references public.aw_eval_runs(id) on delete cascade,
  item_id    text not null,
  answer     text,
  score      integer,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (run_id, item_id)
);

alter table public.aw_exam_bank     enable row level security;
alter table public.aw_exam_attempts enable row level security;
alter table public.aw_eval_items    enable row level security;
alter table public.aw_eval_runs     enable row level security;
alter table public.aw_eval_results  enable row level security;
revoke all on public.aw_exam_bank, public.aw_exam_attempts, public.aw_eval_items,
              public.aw_eval_runs, public.aw_eval_results from anon, authenticated;
