-- Жёсткий месячный лимит запросов к Google Places, чтобы не выходить за бесплатную квоту
-- (Text Search Enterprise: 1 000 запросов в месяц).
-- Месяц считается по тихоокеанскому времени, как в биллинге Google Cloud.
-- Потолок 1000 зашит в SQL: даже ошибка в env приложения не позволит его превысить.

create table if not exists public.google_usage (
  period text primary key,                -- 'YYYY-MM' по America/Los_Angeles
  requests integer not null default 0 check (requests >= 0),
  updated_at timestamptz not null default now()
);

alter table public.google_usage enable row level security;
revoke all on table public.google_usage from anon, authenticated;
-- Политик нет намеренно: доступ только через функции ниже.

create or replace function public.google_usage_period()
returns text language sql stable as $$
  select to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM')
$$;

-- Резервирует до `want` запросов в пределах лимита. Возвращает, сколько выдано (0 = лимит исчерпан).
create or replace function public.reserve_google_requests(want integer, monthly_cap integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p text := public.google_usage_period();
  cap integer := least(greatest(coalesce(monthly_cap, 0), 0), 1000);
  used integer;
  granted integer;
begin
  insert into public.google_usage (period) values (p) on conflict (period) do nothing;
  select requests into used from public.google_usage where period = p for update;
  granted := greatest(0, least(greatest(want, 0), cap - used));
  if granted > 0 then
    update public.google_usage set requests = requests + granted, updated_at = now() where period = p;
  end if;
  return granted;
end;
$$;

-- Возвращает неиспользованную часть резерва после поиска.
create or replace function public.release_google_requests(unused integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.google_usage
    set requests = greatest(0, requests - greatest(unused, 0)), updated_at = now()
    where period = public.google_usage_period();
end;
$$;

create or replace function public.google_usage_current()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select requests from public.google_usage where period = public.google_usage_period()), 0)
$$;

revoke all on function public.reserve_google_requests(integer, integer) from public, anon;
revoke all on function public.release_google_requests(integer) from public, anon;
revoke all on function public.google_usage_current() from public, anon;
grant execute on function public.reserve_google_requests(integer, integer) to authenticated;
grant execute on function public.release_google_requests(integer) to authenticated;
grant execute on function public.google_usage_current() to authenticated;
