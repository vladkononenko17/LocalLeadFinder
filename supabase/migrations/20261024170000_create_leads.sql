create table if not exists public.leads (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  osm_id text not null,
  name text not null,
  category text,
  address text,
  phone text,
  email text,
  website text,
  source_url text not null,
  latitude double precision,
  longitude double precision,
  website_status text not null default 'unknown' check (website_status in ('unknown','unverified','checked','weak')),
  score smallint not null default 0 check (score between 0 and 100),
  score_reason text not null default '',
  audit_json jsonb,
  lead_status text not null default 'new' check (lead_status in ('new','contacted','replied','won','lost')),
  excluded boolean not null default false,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, osm_id)
);

alter table public.leads enable row level security;
revoke all on table public.leads from anon;
grant select, insert, update, delete on table public.leads to authenticated;

create policy "Users manage only their own leads" on public.leads
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists leads_user_active_score_idx
  on public.leads (user_id, score desc, checked_at desc)
  where excluded = false;
