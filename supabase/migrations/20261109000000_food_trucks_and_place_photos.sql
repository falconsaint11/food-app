-- Food trucks and restaurant photos.
--
-- Food trucks move around, so they never keep a location: they don't show on
-- maps or in "Best near you". Whoever adds a restaurant can mark it as a food
-- truck; curators and admins can change it later.
--
-- Restaurant photos: anyone can add photos of a place (outside, inside, the
-- menu board) without writing a review. They live in the review-photos
-- bucket under the uploader's folder, so account deletion removes them.

alter table public.restaurants
  add column if not exists is_food_truck boolean not null default false;

-- Clears the location whenever a restaurant is (or becomes) a food truck,
-- whichever way it was saved.
create or replace function public.food_truck_without_location()
returns trigger
language plpgsql
as $$
begin
  if new.is_food_truck then
    new.latitude := null;
    new.longitude := null;
  end if;

  return new;
end;
$$;

drop trigger if exists restaurants_food_truck_without_location on public.restaurants;
create trigger restaurants_food_truck_without_location
  before insert or update of is_food_truck, latitude, longitude
  on public.restaurants
  for each row
  execute function public.food_truck_without_location();

create or replace function public.set_food_truck(p_restaurant_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_curator() then
    raise exception 'Only curators and admins can change this';
  end if;

  update restaurants set is_food_truck = p_on where id = p_restaurant_id;

  if not found then
    raise exception 'Restaurant not found';
  end if;

  insert into curator_edits (action, restaurant_id, after)
  values ('set_food_truck', p_restaurant_id, jsonb_build_object('on', p_on));
end;
$$;

revoke execute on function public.set_food_truck(uuid, boolean) from public, anon;
grant execute on function public.set_food_truck(uuid, boolean) to authenticated;

create table if not exists public.restaurant_photos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- "<user id>/<file>" in the review-photos bucket.
  photo_path text not null,
  created_at timestamptz not null default now(),
  check (photo_path like user_id::text || '/%')
);

create index if not exists restaurant_photos_restaurant_idx
  on public.restaurant_photos (restaurant_id, created_at desc);

create index if not exists restaurant_photos_user_idx
  on public.restaurant_photos (user_id, created_at desc);

alter table public.restaurant_photos enable row level security;

drop policy if exists "Anyone signed in can see restaurant photos" on public.restaurant_photos;
create policy "Anyone signed in can see restaurant photos"
  on public.restaurant_photos for select
  to authenticated
  using (true);

-- Up to 30 photos a day each, to keep spam down.
drop policy if exists "Users can add restaurant photos" on public.restaurant_photos;
create policy "Users can add restaurant photos"
  on public.restaurant_photos for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      select count(*)
      from public.restaurant_photos mine
      where mine.user_id = auth.uid()
        and mine.created_at > now() - interval '1 day'
    ) < 30
  );

-- Your own photos, or any photo for admins (to act on reports).
drop policy if exists "Users can delete their restaurant photos" on public.restaurant_photos;
create policy "Users can delete their restaurant photos"
  on public.restaurant_photos for delete
  to authenticated
  using (auth.uid() = user_id or public.is_app_admin());

-- Restaurant photos can be reported like other posts.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('review', 'comment', 'restaurant_note', 'user', 'restaurant_photo'));
