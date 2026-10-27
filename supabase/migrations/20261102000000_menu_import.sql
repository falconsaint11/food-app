-- Menu import and dietary tags.
--
-- Admins can photograph a restaurant's menu; the menu-scan edge function
-- reads it with Claude and the app shows the dishes for review. Saving calls
-- import_menu_dishes(), which adds the dishes (skipping ones already on that
-- location's menu) and their tags.
--
-- Tags from a menu go in dish_menu_tags and show publicly right away. Tags
-- people vote on when logging still need 2 people to agree.
--
-- Add an admin:
--   insert into app_admins (user_id) values ('<user id>');

-- Dietary tags, listed after the food tags. "Gluten-Friendly" is for dishes a
-- menu calls gluten-friendly or "can be made gluten-free" (cross-contact
-- possible), as opposed to Gluten-Free.
alter table public.tags
  add column if not exists kind text not null default 'food'
  check (kind in ('food', 'dietary'));

insert into public.tags (slug, label, sort_order, keywords, kind) values
  ('gluten-free', 'Gluten-Free', 300, 'gluten free', 'dietary'),
  ('gluten-friendly', 'Gluten-Friendly', 310, 'gluten friendly', 'dietary'),
  ('dairy-free', 'Dairy-Free', 320, 'dairy free|non dairy', 'dietary'),
  ('vegetarian', 'Vegetarian', 330, 'vegetarian|veggie', 'dietary'),
  ('vegan', 'Vegan', 340, 'vegan|plant based', 'dietary')
on conflict (slug) do nothing;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

-- Users can only see their own row, which is how the app checks for admin.
drop policy if exists "Users can see their own admin row" on public.app_admins;
create policy "Users can see their own admin row"
  on public.app_admins for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

create table if not exists public.dish_menu_tags (
  dish_id uuid not null references public.dishes (id) on delete cascade,
  tag text not null references public.tags (slug) on delete cascade,
  -- Kept when the admin's account is deleted.
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (dish_id, tag)
);

create index if not exists dish_menu_tags_tag_idx on public.dish_menu_tags (tag);

alter table public.dish_menu_tags enable row level security;

-- Rows are only added through import_menu_dishes().
drop policy if exists "Menu tags are viewable by everyone" on public.dish_menu_tags;
create policy "Menu tags are viewable by everyone"
  on public.dish_menu_tags for select
  using (true);

drop policy if exists "Admins can remove menu tags" on public.dish_menu_tags;
create policy "Admins can remove menu tags"
  on public.dish_menu_tags for delete
  to authenticated
  using (public.is_app_admin());

-- Adds reviewed menu dishes to one location. p_items is a JSON array of
-- {name, price, section, tags}. A dish whose name_key is already on the
-- location's menu is reused: it gets the tags, and the price and section if
-- it had none. Returns how many dishes were added and how many already
-- existed.
create or replace function public.import_menu_dishes(
  p_restaurant_id uuid,
  p_items jsonb
)
returns table (added int, matched int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_name text;
  v_price numeric;
  v_section text;
  v_dish_id uuid;
  v_added int := 0;
  v_matched int := 0;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can import menus';
  end if;

  if not exists (select 1 from restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant not found';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_name := trim(coalesce(v_item->>'name', ''));

    if v_name = '' or char_length(v_name) > 120 then
      continue;
    end if;

    v_price := case
      when (v_item->>'price') ~ '^\d{1,5}(\.\d{1,2})?$' then (v_item->>'price')::numeric
    end;
    v_section := nullif(left(trim(coalesce(v_item->>'section', '')), 60), '');

    select id into v_dish_id
    from dishes
    where restaurant_id = p_restaurant_id
      and name_key = public.normalize_dish_name(v_name)
    limit 1;

    if v_dish_id is null then
      insert into dishes (restaurant_id, name, price, category)
      values (p_restaurant_id, v_name, v_price, v_section)
      returning id into v_dish_id;

      v_added := v_added + 1;
    else
      update dishes
      set price = coalesce(price, v_price),
          category = coalesce(category, v_section)
      where id = v_dish_id;

      v_matched := v_matched + 1;
    end if;

    insert into dish_menu_tags (dish_id, tag, added_by)
    select v_dish_id, t.slug, auth.uid()
    from tags t
    where t.slug in (
      select jsonb_array_elements_text(coalesce(v_item->'tags', '[]'::jsonb))
    )
    on conflict do nothing;
  end loop;

  return query select v_added, v_matched;
end;
$$;

revoke execute on function public.import_menu_dishes(uuid, jsonb) from public, anon;
grant execute on function public.import_menu_dishes(uuid, jsonb) to authenticated;

-- Public tags now include menu tags, and say which are dietary. The return
-- type changes, so drop the old version first.
drop function if exists public.dish_public_tags(uuid[]);

create function public.dish_public_tags(p_dish_ids uuid[])
returns table (
  slug text,
  label text,
  kind text
)
language sql
stable
set search_path = public
as $$
  select t.slug, t.label, t.kind
  from tags t
  where exists (
      select 1 from dish_menu_tags m
      where m.dish_id = any (p_dish_ids) and m.tag = t.slug
    )
    or (
      select count(distinct v.user_id)
      from dish_tag_votes v
      where v.dish_id = any (p_dish_ids) and v.tag = t.slug
    ) >= public.dish_tag_vote_threshold()
  order by t.sort_order;
$$;

grant execute on function public.dish_public_tags(uuid[]) to authenticated;

-- top_dishes_by_tag() again, counting menu tags as public.
create or replace function public.top_dishes_by_tag(
  p_tag text,
  p_limit int default 10
)
returns table (
  dish_id uuid,
  name text,
  restaurant_name text,
  average_rating numeric,
  review_count int
)
language sql
stable
set search_path = public
as $$
  with dish_groups as (
    select
      d.id,
      d.name,
      d.name_key,
      coalesce(r.brand_id, r.id) as group_id,
      coalesce(b.name, r.name) as restaurant_name
    from dishes d
    join restaurants r on r.id = d.restaurant_id
    left join brands b on b.id = r.brand_id
  ),
  tagged as (
    select g.group_id, g.name_key
    from dish_tag_votes v
    join dish_groups g on g.id = v.dish_id
    where v.tag = p_tag
    group by g.group_id, g.name_key
    having count(distinct v.user_id) >= public.dish_tag_vote_threshold()
    union
    select g.group_id, g.name_key
    from dish_menu_tags m
    join dish_groups g on g.id = m.dish_id
    where m.tag = p_tag
  ),
  per_dish as (
    select
      g.group_id,
      g.name_key,
      g.id as dish_id,
      g.name,
      g.restaurant_name,
      count(*) as n,
      sum(rv.rating) as total
    from tagged t
    join dish_groups g on g.group_id = t.group_id and g.name_key = t.name_key
    join reviews rv on rv.dish_id = g.id
    group by g.group_id, g.name_key, g.id, g.name, g.restaurant_name
  ),
  per_group as (
    select
      (array_agg(dish_id order by n desc))[1] as dish_id,
      (array_agg(name order by n desc))[1] as name,
      max(restaurant_name) as restaurant_name,
      sum(n) as n,
      sum(total) as total
    from per_dish
    group by group_id, name_key
  ),
  overall as (
    select coalesce(avg(rating), 3) as mean from reviews
  )
  select
    p.dish_id,
    p.name,
    p.restaurant_name,
    round(p.total / p.n, 2) as average_rating,
    p.n::int as review_count
  from per_group p
  cross join overall o
  order by (p.total + 5 * o.mean) / (p.n + 5) desc, p.n desc
  limit p_limit;
$$;

grant execute on function public.top_dishes_by_tag(text, int) to authenticated;

-- merge_dishes() again, now also moving menu tags.
create or replace function public.merge_dishes(p_from uuid, p_into uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  from_dish dishes;
  into_dish dishes;
  v_brand_id uuid;
  v_location_ids uuid[];
  d dishes;
  v_target uuid;
  v_count int := 0;
begin
  if p_from = p_into then
    raise exception 'Cannot merge a dish into itself';
  end if;

  select * into from_dish from dishes where id = p_from;
  select * into into_dish from dishes where id = p_into;

  if from_dish.id is null or into_dish.id is null then
    raise exception 'Dish not found';
  end if;

  select brand_id into v_brand_id from restaurants where id = from_dish.restaurant_id;

  if v_brand_id is null then
    v_location_ids := array[from_dish.restaurant_id];
  else
    select array_agg(id) into v_location_ids from restaurants where brand_id = v_brand_id;
  end if;

  if not into_dish.restaurant_id = any (v_location_ids) then
    raise exception 'Both dishes must belong to the same restaurant brand';
  end if;

  for d in
    select * from dishes
    where restaurant_id = any (v_location_ids)
      and name_key = from_dish.name_key
      and id <> p_into
  loop
    select id into v_target
    from dishes
    where restaurant_id = d.restaurant_id
      and name_key = into_dish.name_key
      and id <> d.id
    order by (id = p_into) desc
    limit 1;

    if v_target is null then
      update dishes set name = into_dish.name where id = d.id;
    else
      update reviews set dish_id = v_target where dish_id = d.id;

      -- Someone who ranked both keeps their ranking of the surviving dish.
      delete from dish_rankings
      where dish_id = d.id
        and user_id in (select user_id from dish_rankings where dish_id = v_target);
      update dish_rankings set dish_id = v_target where dish_id = d.id;

      delete from list_items
      where dish_id = d.id
        and list_id in (select list_id from list_items where dish_id = v_target);
      update list_items set dish_id = v_target where dish_id = d.id;

      delete from dish_tag_votes v
      where v.dish_id = d.id
        and exists (
          select 1 from dish_tag_votes keep
          where keep.dish_id = v_target
            and keep.user_id = v.user_id
            and keep.tag = v.tag
        );
      update dish_tag_votes set dish_id = v_target where dish_id = d.id;

      delete from dish_menu_tags m
      where m.dish_id = d.id
        and exists (
          select 1 from dish_menu_tags keep
          where keep.dish_id = v_target and keep.tag = m.tag
        );
      update dish_menu_tags set dish_id = v_target where dish_id = d.id;

      -- Fails (and rolls everything back) if another table still points here.
      delete from dishes where id = d.id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.merge_dishes(uuid, uuid) from public, anon, authenticated;
