-- Restaurant ratings can now be for a whole brand instead of one location.
-- The restaurant page's Rate button saves a brand rating (no location picker);
-- the Log tab still rates the specific location for the future map. Each row
-- is exactly one of the two, and both count toward the restaurant page score.
--
-- brand_id deliberately has no foreign key: restaurant_ratings already links
-- to restaurants, and linking it to brands too could make PostgREST treat it as
-- a restaurants <-> brands join table, making `restaurants ... brands (...)`
-- queries ambiguous (the same problem dishes.cover_review_id caused).

alter table public.restaurant_ratings add column if not exists brand_id uuid;

alter table public.restaurant_ratings alter column restaurant_id drop not null;

alter table public.restaurant_ratings drop constraint if exists restaurant_ratings_one_target;
alter table public.restaurant_ratings
  add constraint restaurant_ratings_one_target
  check ((restaurant_id is null) <> (brand_id is null));

-- One brand rating per user; re-rating replaces it. Location ratings keep
-- their existing (user_id, restaurant_id) uniqueness.
alter table public.restaurant_ratings drop constraint if exists restaurant_ratings_user_brand_key;
alter table public.restaurant_ratings
  add constraint restaurant_ratings_user_brand_key unique (user_id, brand_id);

create index if not exists restaurant_ratings_brand_id_idx
  on public.restaurant_ratings (brand_id);
