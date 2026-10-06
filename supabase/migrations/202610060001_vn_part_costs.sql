-- 越南廠料號成本（報價系統「越南廠成本」頁籤，quotation v3.67）
--
-- 來源：越南廠同仁從 ERP「生產入庫料工費」報表整理的分析（原為一份內嵌全部數字的獨立 HTML）。
-- 🔴 只有結構進版控，數字不進（repo 公開）。資料由本機腳本經 service role 寫入。
-- 🔴 RLS 開著 ＋ 零 policy ＋ revoke：前端一律經 sb-proxy，而 sb-proxy 只放行
--    「業務部 ＋ admin」（與報價系統的部門限制同一條規則，但這裡是伺服器端的牆）。
--
-- 還原：drop table public.vn_part_costs; drop table public.vn_cost_meta;

create table if not exists public.vn_part_costs (
  pn         text primary key,          -- 越南廠 ERP 料號
  nm         text not null default '',  -- 品名（ERP 原文，不翻譯）
  cat        text not null default '',  -- 成品類／半成品類／原物料類(自製件)
  lots       integer not null default 0,        -- 有效工單數
  q          numeric not null default 0,        -- 生產總量 pcs
  mat        numeric not null default 0,        -- 期間加權平均 單位材料（VND）
  lab        numeric not null default 0,        -- 人工
  oh         numeric not null default 0,        -- 製費
  pr         numeric not null default 0,        -- 加工
  lmon       text,                               -- 最近生產月 YYYY-MM
  lmat       numeric not null default 0,        -- 最近生產月的 材料／人工／製費／加工
  llab       numeric not null default 0,
  loh        numeric not null default 0,
  lpr        numeric not null default 0,
  umin       numeric,                            -- 期間單位成本最低／最高
  umax       numeric,
  cv         numeric,                            -- 單位成本變異係數
  lot        numeric,                            -- 工單中位批量
  mo         jsonb not null default '[]'::jsonb, -- [[月份, 入庫量, 單位成本], …]
  updated_at timestamptz not null default now()
);

-- 全廠分析（成本結構、規模彈性、分組驗證）＋ 資料批次資訊；只有一列 id='current'
create table if not exists public.vn_cost_meta (
  id          text primary key,
  meta        jsonb not null,
  source      text,
  imported_at timestamptz not null default now()
);

alter table public.vn_part_costs enable row level security;
alter table public.vn_cost_meta  enable row level security;
revoke all on public.vn_part_costs from anon, authenticated;
revoke all on public.vn_cost_meta  from anon, authenticated;
