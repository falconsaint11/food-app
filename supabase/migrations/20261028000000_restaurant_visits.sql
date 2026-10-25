-- restaurant_ratings becomes a visit log: one row per visit instead of one
-- rating per user that gets replaced. Every Log tab save adds a row for that
-- location (rating is null if the user skipped the restaurant stars), and the
-- restaurant page's Rate button adds a brand-wide row. The number of a user's
-- rows for a brand is how many times they've been there.
--
-- The restaurant page score averages each user's non-null ratings first, then
-- averages across users, so frequent visitors still count as one voice.
--
-- The table keeps its name so existing queries keep working.

alter table public.restaurant_ratings
  drop constraint if exists restaurant_ratings_user_id_restaurant_id_key;

alter table public.restaurant_ratings
  drop constraint if exists restaurant_ratings_user_brand_key;

-- A visit without restaurant stars. The existing range check still applies
-- whenever a rating is given.
alter table public.restaurant_ratings alter column rating drop not null;

alter table public.restaurant_ratings
  add column if not exists visited_at timestamptz not null default now();

update public.restaurant_ratings set visited_at = created_at;

create index if not exists restaurant_ratings_user_restaurant_idx
  on public.restaurant_ratings (user_id, restaurant_id);

create index if not exists restaurant_ratings_user_brand_idx
  on public.restaurant_ratings (user_id, brand_id);
