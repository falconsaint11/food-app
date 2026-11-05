-- A place with a location on the map isn't a food truck: food trucks are
-- only places without one. (Replaces the earlier rule that cleared the
-- location of anything marked as a food truck.)
create or replace function public.food_truck_without_location()
returns trigger
language plpgsql
as $$
begin
  if new.is_food_truck and (new.latitude is not null or new.longitude is not null) then
    raise exception 'Places with a location on the map can''t be food trucks';
  end if;

  return new;
end;
$$;

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

  if p_on and exists (
    select 1 from restaurants
    where id = p_restaurant_id and (latitude is not null or longitude is not null)
  ) then
    raise exception 'This place has a location on the map, so it can''t be a food truck';
  end if;

  update restaurants set is_food_truck = p_on where id = p_restaurant_id;

  if not found then
    raise exception 'Restaurant not found';
  end if;

  insert into curator_edits (action, restaurant_id, after)
  values ('set_food_truck', p_restaurant_id, jsonb_build_object('on', p_on));
end;
$$;

-- Restaurant photos can be the menu (pages saved from a menu scan) or the
-- place itself.
alter table public.restaurant_photos
  add column if not exists kind text not null default 'place'
  check (kind in ('place', 'menu'));

-- Top drinks: a profile's top 4 drinks, next to its top dishes and
-- restaurants.
create table if not exists public.drink_rankings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dish_id uuid not null references public.dishes (id) on delete cascade,
  rank int not null check (rank between 1 and 4),
  created_at timestamptz not null default now(),
  unique (user_id, rank),
  unique (user_id, dish_id)
);

alter table public.drink_rankings enable row level security;

drop policy if exists "Anyone signed in can see top drinks" on public.drink_rankings;
create policy "Anyone signed in can see top drinks"
  on public.drink_rankings for select
  to authenticated
  using (true);

drop policy if exists "Users can set their top drinks" on public.drink_rankings;
create policy "Users can set their top drinks"
  on public.drink_rankings for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can clear their top drinks" on public.drink_rankings;
create policy "Users can clear their top drinks"
  on public.drink_rankings for delete
  to authenticated
  using (auth.uid() = user_id);

-- Which of these dishes are drinks: tagged drink, coffee & tea or alcoholic
-- (from a menu import, or enough votes) on that dish or the same-named dish
-- at another location of the brand.
create or replace function public.drink_dish_ids(p_dish_ids uuid[])
returns setof uuid
language sql
stable
set search_path = public
as $$
  select d.id
  from dishes d
  join restaurants r on r.id = d.restaurant_id
  where d.id = any (p_dish_ids)
    and exists (
      select 1
      from dishes o
      join restaurants o_r on o_r.id = o.restaurant_id
      where o.name_key = d.name_key
        and (o_r.id = r.id or (r.brand_id is not null and o_r.brand_id = r.brand_id))
        and (
          exists (
            select 1 from dish_menu_tags m
            where m.dish_id = o.id
              and m.tag in ('drink', 'coffee-tea', 'alcoholic-drink')
          )
          or (
            select count(distinct v.user_id)
            from dish_tag_votes v
            where v.dish_id = o.id
              and v.tag in ('drink', 'coffee-tea', 'alcoholic-drink')
          ) >= public.dish_tag_vote_threshold()
        )
    );
$$;

grant execute on function public.drink_dish_ids(uuid[]) to authenticated;
