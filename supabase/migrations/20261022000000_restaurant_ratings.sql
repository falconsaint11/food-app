-- Restaurant ratings, separate from dish reviews. Stored per location (one
-- rating per user per location, re-rating replaces it) so a future map can
-- show location-level scores. The public restaurant page averages them across
-- the whole brand.

create table if not exists public.restaurant_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  rating numeric(2, 1) not null check (rating >= 0.5 and rating <= 5 and rating * 2 = floor(rating * 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, restaurant_id)
);

create index if not exists restaurant_ratings_restaurant_id_idx
  on public.restaurant_ratings (restaurant_id);

alter table public.restaurant_ratings enable row level security;

drop policy if exists "Restaurant ratings are viewable by everyone" on public.restaurant_ratings;
create policy "Restaurant ratings are viewable by everyone"
  on public.restaurant_ratings for select
  using (true);

drop policy if exists "Users can add their own restaurant ratings" on public.restaurant_ratings;
create policy "Users can add their own restaurant ratings"
  on public.restaurant_ratings for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own restaurant ratings" on public.restaurant_ratings;
create policy "Users can update their own restaurant ratings"
  on public.restaurant_ratings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own restaurant ratings" on public.restaurant_ratings;
create policy "Users can delete their own restaurant ratings"
  on public.restaurant_ratings for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.touch_restaurant_rating_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists restaurant_ratings_touch_updated_at on public.restaurant_ratings;
create trigger restaurant_ratings_touch_updated_at
  before update on public.restaurant_ratings
  for each row execute function public.touch_restaurant_rating_updated_at();
