-- PostgREST needs schema USAGE in addition to table grants.
-- Row-level security on public.leads remains the row-access boundary.
grant usage on schema public to authenticated;
