-- Curators and admins can pin a restaurant photo (one added without a
-- review) as the restaurant's cover, like pinning a review photo. A brand,
-- or a location without one, has at most one pinned cover: pinning either
-- kind replaces the other.

alter table public.brands
  add column if not exists cover_photo_id uuid
  references public.restaurant_photos (id) on delete set null;

alter table public.restaurants
  add column if not exists cover_photo_id uuid
  references public.restaurant_photos (id) on delete set null;

-- Pinning a review photo (pin_cover_photo) unpins any restaurant photo.
create or replace function public.one_pinned_cover()
returns trigger
language plpgsql
as $$
begin
  if new.cover_review_id is not null
    and new.cover_review_id is distinct from old.cover_review_id then
    new.cover_photo_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists brands_one_pinned_cover on public.brands;
create trigger brands_one_pinned_cover
  before update of cover_review_id on public.brands
  for each row execute function public.one_pinned_cover();

drop trigger if exists restaurants_one_pinned_cover on public.restaurants;
create trigger restaurants_one_pinned_cover
  before update of cover_review_id on public.restaurants
  for each row execute function public.one_pinned_cover();

-- Pins (or unpins) a restaurant photo as the cover of its brand, or of its
-- location when it has no brand.
create or replace function public.pin_restaurant_photo(p_photo_id uuid, p_pin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_brand_id uuid;
begin
  if not public.is_app_curator() then
    raise exception 'Only curators and admins can pin photos';
  end if;

  select p.restaurant_id, r.brand_id
  into v_restaurant_id, v_brand_id
  from restaurant_photos p
  join restaurants r on r.id = p.restaurant_id
  where p.id = p_photo_id;

  if v_restaurant_id is null then
    raise exception 'Photo not found';
  end if;

  if v_brand_id is not null then
    update brands
    set cover_photo_id = case when p_pin then p_photo_id end,
        cover_review_id = case when p_pin then null else cover_review_id end
    where id = v_brand_id
      and (p_pin or cover_photo_id = p_photo_id);
  else
    update restaurants
    set cover_photo_id = case when p_pin then p_photo_id end,
        cover_review_id = case when p_pin then null else cover_review_id end
    where id = v_restaurant_id
      and (p_pin or cover_photo_id = p_photo_id);
  end if;

  insert into curator_edits (action, restaurant_id, after)
  values (
    'pin_cover',
    v_restaurant_id,
    jsonb_build_object('photo_id', p_photo_id, 'target', 'restaurant', 'pinned', p_pin)
  );
end;
$$;

revoke execute on function public.pin_restaurant_photo(uuid, boolean) from public, anon;
grant execute on function public.pin_restaurant_photo(uuid, boolean) to authenticated;
