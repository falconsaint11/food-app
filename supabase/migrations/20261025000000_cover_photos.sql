-- Cover photos for restaurant and dish pages, picked from users' review photos.
-- A photo qualifies if its review is rated 3.5+; the best are the most liked,
-- then highest rated, with older photos slowly sinking. A pinned review's
-- photo always comes first.
--
-- Pin a cover from the SQL editor:
--   update brands set cover_review_id = '<review id>' where id = '<brand id>';
--   update dishes set cover_review_id = '<review id>' where id = '<dish id>';

-- The pin columns match whatever type reviews.id uses.
do $$
declare
  v_review_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into v_review_id_type
  from pg_attribute a
  where a.attrelid = 'public.reviews'::regclass
    and a.attname = 'id';

  execute format(
    'alter table public.brands add column if not exists cover_review_id %s references public.reviews (id) on delete set null',
    v_review_id_type
  );

  -- No foreign key here: reviews.dish_id already links reviews and dishes,
  -- and a second link makes `reviews -> dishes` embeds ambiguous.
  execute format(
    'alter table public.dishes add column if not exists cover_review_id %s',
    v_review_id_type
  );
end;
$$;

create or replace function public.cover_photos(
  p_dish_ids uuid[],
  p_pinned_review_id text default null,
  p_limit int default 5
)
returns table (
  review_id text,
  photo_path text
)
language sql
stable
set search_path = public
as $$
  select r.id::text, r.photo_path
  from reviews r
  left join lateral (
    select count(*) as n
    from review_reactions rr
    where rr.review_id = r.id
  ) likes on true
  where r.dish_id = any (p_dish_ids)
    and r.photo_path is not null
    and (r.rating >= 3.5 or r.id::text = p_pinned_review_id)
  order by
    (r.id::text = p_pinned_review_id) desc nulls last,
    -- Each like is worth 2 points, each star 1, and a photo loses 1 point
    -- per ~6 months of age.
    likes.n * 2
      + r.rating
      - extract(epoch from now() - r.created_at) / 86400.0 / 180 desc
  limit p_limit;
$$;

grant execute on function public.cover_photos(uuid[], text, int) to authenticated;
