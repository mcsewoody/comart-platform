-- 202608080022_poll_tables.sql
--
-- 通用投票／意見徵集系統（board 新頁籤「🗳 投票」）四張表。
-- 存取一律經 sb-proxy(service_role)+x-session；啟用 RLS、不加 anon policy
-- （與 board 其餘表同一套安全模型）。id 用 text(前端 uid())。
-- 欄位一次備齊(含後續階段的雙語/圖片/數量/決策等旗標)，避免日後再遷移。

create table if not exists public.poll_sessions (
  id            text primary key,
  title         text not null default '',
  description   text default '',            -- 背景說明
  desc_a        text, desc_b text,          -- 背景雙語(bilingual 時)
  bg_images     jsonb default '[]'::jsonb,  -- 背景附圖(Storage 連結)
  multi         boolean default false,      -- 複選
  multi_cap     int,                        -- 複選上限(null=不限)
  decision_mode boolean default false,      -- 決策模式(自動判定勝出)
  anonymous     boolean default false,      -- 匿名(後台仍記 voter_emp_id)
  reveal        text default 'live',        -- live=即時可見 / closed=截止後揭曉
  allow_comment boolean default false,      -- 可書寫整體意見
  quantity_mode boolean default false,      -- 數量模式(點餐/物資)
  bilingual     boolean default false,      -- 題目/選項自動雙語
  lang_a        text default 'zh-TW', lang_b text default 'vi',
  persist       boolean default true,       -- 存檔(false=結束即刪)
  scope_type    text default 'all',         -- all | site | list
  scope_site    text,
  scope_members jsonb default '[]'::jsonb,
  close_at      timestamptz,                -- 自動截止時間(null=不自動)
  status        text default 'open',        -- open | closed
  creator_emp_id text, creator_name text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists public.poll_options (
  id          text primary key,
  session_id  text not null references public.poll_sessions(id) on delete cascade,
  label       text default '',
  label_a     text, label_b text,           -- 選項雙語
  image_url   text,                          -- 選項配圖(Storage)
  sort_order  int default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_poll_options_session on public.poll_options(session_id);

create table if not exists public.poll_votes (
  id          text primary key,
  session_id  text not null references public.poll_sessions(id) on delete cascade,
  option_id   text not null references public.poll_options(id) on delete cascade,
  voter_emp_id text,                          -- 匿名時畫面不顯示，後台仍記(防重複/稽核)
  voter_name  text,
  quantity    int default 1,                  -- 數量模式用
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_poll_votes_session on public.poll_votes(session_id);

create table if not exists public.poll_comments (
  id          text primary key,
  session_id  text not null references public.poll_sessions(id) on delete cascade,
  voter_emp_id text, voter_name text,
  text        text default '',
  text_a      text, text_b text,
  created_at  timestamptz default now()
);
create index if not exists idx_poll_comments_session on public.poll_comments(session_id);

alter table public.poll_sessions enable row level security;
alter table public.poll_options  enable row level security;
alter table public.poll_votes    enable row level security;
alter table public.poll_comments enable row level security;
