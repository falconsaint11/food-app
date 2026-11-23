-- Limits Google Places searches per user. Each search is a paid Google call,
-- and the google-places-autocomplete function used to answer anyone who
-- called it, signed in or not. Now it requires a signed-in user and calls
-- claim_places_search() first.

-- One row per search, kept for an hour.
create table if not exists public.places_searches (
  user_id uuid not null references auth.users (id) on delete cascade,
  cost int not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists places_searches_user_id_idx
  on public.places_searches (user_id, created_at desc);

-- No policies: only claim_places_search() reads and writes it.
alter table public.places_searches enable row level security;

-- A typed search costs 1 and "Show more locations near you" costs 5 (it's a
-- pricier Google call). 300 an hour is far more than anyone types; it only
-- stops a script or a stuck loop. Admins have no limit.
create or replace function public.claim_places_search(p_cost int default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit constant int := 300;
  v_cost int := greatest(1, least(coalesce(p_cost, 1), 20));
begin
  if auth.uid() is null then
    raise exception 'Sign in to search';
  end if;

  delete from places_searches
  where user_id = auth.uid()
    and created_at < now() - interval '1 hour';

  if not public.is_app_admin() and (
    select coalesce(sum(cost), 0)
    from places_searches
    where user_id = auth.uid()
  ) + v_cost > v_limit then
    raise exception 'Too many searches. Try again in a few minutes.';
  end if;

  insert into places_searches (user_id, cost) values (auth.uid(), v_cost);
end;
$$;

revoke execute on function public.claim_places_search(int) from public, anon;
grant execute on function public.claim_places_search(int) to authenticated;
