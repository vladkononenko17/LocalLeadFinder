-- Несколько источников (OpenStreetMap + Google Maps) для одного лида.
-- Колонка osm_id остаётся ключом upsert: для мест только из Google в ней хранится "google/<place_id>".
alter table public.leads
  add column if not exists sources text[] not null default array['osm'],
  add column if not exists google_place_id text,
  add column if not exists maps_url text,
  add column if not exists rating real,
  add column if not exists review_count integer,
  add column if not exists website_kind text not null default 'none'
    check (website_kind in ('none', 'social', 'site'));

update public.leads
  set website_kind = case when website is null then 'none' else 'site' end
  where website_kind = 'none' and website is not null;

create index if not exists leads_user_google_place_idx
  on public.leads (user_id, google_place_id)
  where google_place_id is not null;
