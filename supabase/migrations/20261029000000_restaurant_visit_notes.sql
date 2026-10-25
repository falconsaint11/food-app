-- Optional notes about the restaurant itself (service, vibe, wait...) on each
-- visit, written alongside the restaurant stars in the Log tab or the
-- restaurant page's Rate button. Shown on the restaurant page under
-- "What people are saying".

alter table public.restaurant_ratings
  add column if not exists notes text;

alter table public.restaurant_ratings
  drop constraint if exists restaurant_ratings_notes_length;

alter table public.restaurant_ratings
  add constraint restaurant_ratings_notes_length
  check (notes is null or char_length(notes) <= 2000);
