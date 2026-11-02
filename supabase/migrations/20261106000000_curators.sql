-- Curators: trusted members, picked by admins, who look after menus.
--
-- Curators (and admins) can:
--   - scan and import a menu at any time, at any menu size, and choose to
--     update existing dishes' price, description and options from the scan
--     (20 menu photos a day; admins have no limit)
--   - edit a dish's name, price, description, options and variant link
--   - add or remove a dish's tags right away, without votes
--   - pin a review photo as a dish's or restaurant's cover
-- Marking dishes discontinued and merging dishes stay admin-only.
--
-- Every curator change is written to curator_edits (who, what, before and
-- after) so admins can see and undo bad edits.
--
-- Make someone a curator from the app (an admin taps "Make curator" on their
-- profile) or from the SQL editor:
--   insert into app_curators (user_id) values ('<user id>');

create table if not exists public.app_curators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Kept when the admin's account is deleted.
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.app_curators enable row level security;

-- Public, so profiles can show a Curator badge.
drop policy if exists "Curators are viewable by everyone" on public.app_curators;
create policy "Curators are viewable by everyone"
  on public.app_curators for select
  to authenticated
  using (true);

-- Admins count as curators.
create or replace function public.is_app_curator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_admin()
    or exists (select 1 from app_curators where user_id = auth.uid());
$$;

revoke execute on function public.is_app_curator() from public, anon;
grant execute on function public.is_app_curator() to authenticated;

create table if not exists public.curator_edits (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  -- update_dish, set_tag, pin_cover, import_menu, import_update, set_curator
  action text not null,
  dish_id uuid references public.dishes (id) on delete set null,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists curator_edits_created_at_idx
  on public.curator_edits (created_at desc);
create index if not exists curator_edits_dish_id_idx
  on public.curator_edits (dish_id);

alter table public.curator_edits enable row level security;

-- Rows are only added by the functions below.
drop policy if exists "Admins can see curator edits" on public.curator_edits;
create policy "Admins can see curator edits"
  on public.curator_edits for select
  to authenticated
  using (public.is_app_admin());

create or replace function public.set_curator(p_user_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can choose curators';
  end if;

  if p_on then
    insert into app_curators (user_id, added_by)
    values (p_user_id, auth.uid())
    on conflict do nothing;
  else
    delete from app_curators where user_id = p_user_id;
  end if;

  insert into curator_edits (action, after)
  values ('set_curator', jsonb_build_object('user_id', p_user_id, 'curator', p_on));
end;
$$;

revoke execute on function public.set_curator(uuid, boolean) from public, anon;
grant execute on function public.set_curator(uuid, boolean) to authenticated;

-- One row per menu photo sent to the menu-scan edge function.
create table if not exists public.menu_scans (
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists menu_scans_user_id_idx
  on public.menu_scans (user_id, created_at desc);

-- No policies: only claim_menu_scan() reads and writes it.
alter table public.menu_scans enable row level security;

-- Called by the menu-scan edge function before each photo. Each scan is a
-- paid Claude call, so curators get 20 a day; admins have no limit.
create or replace function public.claim_menu_scan()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_curator() then
    raise exception 'Only curators and admins can scan menus';
  end if;

  if not public.is_app_admin() and (
    select count(*)
    from menu_scans
    where user_id = auth.uid()
      and created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'You''ve scanned 20 menu photos today. Try again tomorrow.';
  end if;

  insert into menu_scans (user_id) values (auth.uid());
end;
$$;

revoke execute on function public.claim_menu_scan() from public, anon;
grant execute on function public.claim_menu_scan() to authenticated;

-- Restaurants without a brand keep their pinned cover here (brands use
-- brands.cover_review_id). Same type as reviews.id.
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
    'alter table public.restaurants add column if not exists cover_review_id %s references public.reviews (id) on delete set null',
    v_review_id_type
  );
end;
$$;

-- Pins (or unpins) a review's photo as the cover of its dish (every location
-- of the brand) or of its restaurant (the brand, or the location when it has
-- no brand).
create or replace function public.pin_cover_photo(
  p_review_id text,
  p_target text,
  p_pin boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_location_ids uuid[];
begin
  if not public.is_app_curator() then
    raise exception 'Only curators and admins can pin photos';
  end if;

  if p_target not in ('dish', 'restaurant') then
    raise exception 'Pin to a dish or a restaurant';
  end if;

  select
    r.id as review_id,
    r.photo_path,
    d.id as dish_id,
    d.name_key,
    d.restaurant_id,
    rest.brand_id
  into v
  from reviews r
  join dishes d on d.id = r.dish_id
  join restaurants rest on rest.id = d.restaurant_id
  where r.id::text = p_review_id;

  if v.review_id is null then
    raise exception 'Review not found';
  end if;

  if p_pin and v.photo_path is null then
    raise exception 'This review has no photo';
  end if;

  if v.brand_id is null then
    v_location_ids := array[v.restaurant_id];
  else
    select array_agg(id) into v_location_ids from restaurants where brand_id = v.brand_id;
  end if;

  if p_target = 'dish' then
    update dishes
    set cover_review_id = case when p_pin then v.review_id end
    where restaurant_id = any (v_location_ids)
      and name_key = v.name_key
      and (p_pin or cover_review_id::text = p_review_id);
  elsif v.brand_id is not null then
    update brands
    set cover_review_id = case when p_pin then v.review_id end
    where id = v.brand_id
      and (p_pin or cover_review_id::text = p_review_id);
  else
    update restaurants
    set cover_review_id = case when p_pin then v.review_id end
    where id = v.restaurant_id
      and (p_pin or cover_review_id::text = p_review_id);
  end if;

  insert into curator_edits (action, dish_id, restaurant_id, after)
  values (
    'pin_cover',
    v.dish_id,
    v.restaurant_id,
    jsonb_build_object('review_id', p_review_id, 'target', p_target, 'pinned', p_pin)
  );
end;
$$;

revoke execute on function public.pin_cover_photo(text, text, boolean) from public, anon;
grant execute on function public.pin_cover_photo(text, text, boolean) to authenticated;

-- Whether a review's photo is pinned anywhere, for the pin buttons.
create or replace function public.cover_pin_status(p_review_id text)
returns table (dish_pinned boolean, restaurant_pinned boolean)
language sql
stable
set search_path = public
as $$
  select
    exists (select 1 from dishes where cover_review_id::text = p_review_id),
    exists (select 1 from brands where cover_review_id::text = p_review_id)
      or exists (select 1 from restaurants where cover_review_id::text = p_review_id);
$$;

grant execute on function public.cover_pin_status(text) to authenticated;

-- Adds or removes a tag on a dish (every location of the brand) right away.
-- Removing also clears people's votes for it, or it would come back.
create or replace function public.set_dish_tag(
  p_dish_id uuid,
  p_tag text,
  p_on boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d dishes;
  v_brand_id uuid;
  v_location_ids uuid[];
  v_votes int;
begin
  if not public.is_app_curator() then
    raise exception 'Only curators and admins can change tags';
  end if;

  if not exists (select 1 from tags where slug = p_tag) then
    raise exception 'Unknown tag';
  end if;

  select * into d from dishes where id = p_dish_id;

  if d.id is null then
    raise exception 'Dish not found';
  end if;

  select brand_id into v_brand_id from restaurants where id = d.restaurant_id;

  if v_brand_id is null then
    v_location_ids := array[d.restaurant_id];
  else
    select array_agg(id) into v_location_ids from restaurants where brand_id = v_brand_id;
  end if;

  if p_on then
    insert into dish_menu_tags (dish_id, tag, added_by)
    values (p_dish_id, p_tag, auth.uid())
    on conflict do nothing;
  else
    delete from dish_menu_tags
    where tag = p_tag
      and dish_id in (
        select id from dishes
        where restaurant_id = any (v_location_ids) and name_key = d.name_key
      );

    delete from dish_tag_votes
    where tag = p_tag
      and dish_id in (
        select id from dishes
        where restaurant_id = any (v_location_ids) and name_key = d.name_key
      );

    get diagnostics v_votes = row_count;
  end if;

  insert into curator_edits (action, dish_id, restaurant_id, after)
  values (
    'set_tag',
    p_dish_id,
    d.restaurant_id,
    jsonb_build_object('tag', p_tag, 'on', p_on, 'votes_removed', coalesce(v_votes, 0))
  );
end;
$$;

revoke execute on function public.set_dish_tag(uuid, text, boolean) from public, anon;
grant execute on function public.set_dish_tag(uuid, text, boolean) to authenticated;

-- admin_update_dish() again: curators can use it too, except for marking a
-- dish discontinued (or bringing one back), which stays admin-only. Every
-- edit is logged with the dish's values before and after.
create or replace function public.admin_update_dish(
  p_dish_id uuid,
  p_name text,
  p_price numeric,
  p_description text,
  p_options text[],
  p_variant_of text,
  p_variant_label text,
  p_discontinued boolean
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d dishes;
  v_brand_id uuid;
  v_location_ids uuid[];
  v_name text := trim(coalesce(p_name, ''));
  v_new_key text;
  v_variant_of text := nullif(trim(coalesce(p_variant_of, '')), '');
  v_variant_label text := nullif(left(trim(coalesce(p_variant_label, '')), 40), '');
  v_options text[];
  v_description text := nullif(left(trim(coalesce(p_description, '')), 300), '');
  v_count int;
begin
  if not public.is_app_curator() then
    raise exception 'Only curators and admins can edit dishes';
  end if;

  select * into d from dishes where id = p_dish_id;

  if d.id is null then
    raise exception 'Dish not found';
  end if;

  if p_discontinued <> (d.discontinued_at is not null) and not public.is_app_admin() then
    raise exception 'Only admins can mark dishes discontinued';
  end if;

  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Give the dish a name (up to 120 characters)';
  end if;

  select brand_id into v_brand_id from restaurants where id = d.restaurant_id;

  if v_brand_id is null then
    v_location_ids := array[d.restaurant_id];
  else
    select array_agg(id) into v_location_ids from restaurants where brand_id = v_brand_id;
  end if;

  v_new_key := public.normalize_dish_name(v_name);

  if v_new_key <> d.name_key and exists (
    select 1 from dishes
    where restaurant_id = any (v_location_ids) and name_key = v_new_key
  ) then
    raise exception 'Another dish on this menu already has that name. Merge the two instead.';
  end if;

  if v_variant_of = v_new_key then
    raise exception 'A dish can''t be a variant of itself';
  end if;

  if v_variant_of is null or v_variant_label is null then
    v_variant_of := null;
    v_variant_label := null;
  end if;

  select coalesce(array_agg(o), '{}')
  into v_options
  from (
    select left(trim(o), 80) as o
    from unnest(coalesce(p_options, '{}')) o
    where trim(o) <> ''
    limit 10
  ) opts;

  update dishes
  set name = v_name,
      description = v_description,
      options = v_options,
      variant_of = v_variant_of,
      variant_label = v_variant_label,
      discontinued_at = case when p_discontinued then coalesce(discontinued_at, now()) end
  where restaurant_id = any (v_location_ids) and name_key = d.name_key;

  get diagnostics v_count = row_count;

  update dishes set price = p_price where id = p_dish_id;

  -- Variants follow their dish's new name, and its discontinued state when
  -- that changed (a variant discontinued on its own stays that way).
  update dishes
  set variant_of = v_new_key,
      discontinued_at = case
        when (d.discontinued_at is not null) = p_discontinued then discontinued_at
        when p_discontinued then coalesce(discontinued_at, now())
      end
  where restaurant_id = any (v_location_ids) and variant_of = d.name_key;

  insert into curator_edits (action, dish_id, restaurant_id, before, after)
  values (
    'update_dish',
    p_dish_id,
    d.restaurant_id,
    jsonb_build_object(
      'name', d.name,
      'price', d.price,
      'description', d.description,
      'options', d.options,
      'variant_of', d.variant_of,
      'variant_label', d.variant_label,
      'discontinued', d.discontinued_at is not null
    ),
    jsonb_build_object(
      'name', v_name,
      'price', p_price,
      'description', v_description,
      'options', v_options,
      'variant_of', v_variant_of,
      'variant_label', v_variant_label,
      'discontinued', p_discontinued
    )
  );

  return v_count;
end;
$$;

-- The dishes a menu import would match at this location, so the import
-- screen can show what an update would change.
create or replace function public.menu_import_matches(
  p_restaurant_id uuid,
  p_names text[]
)
returns table (
  name text,
  dish_id uuid,
  price numeric,
  description text,
  options text[]
)
language sql
stable
set search_path = public
as $$
  select n.name, d.id, d.price, d.description, d.options
  from unnest(p_names) as n(name)
  join dishes d
    on d.restaurant_id = p_restaurant_id
   and d.name_key = public.normalize_dish_name(n.name);
$$;

grant execute on function public.menu_import_matches(uuid, text[]) to authenticated;

-- import_menu_dishes() again: for curators too, with no menu-size limit. An
-- item with "update": true overwrites the matched dish's price, description
-- and options with the scanned ones it has (blank scanned fields never clear
-- anything). Other matched dishes are still only filled in where blank.
-- Returns how many were added, matched and updated.
drop function if exists public.import_menu_dishes(uuid, jsonb);

create function public.import_menu_dishes(
  p_restaurant_id uuid,
  p_items jsonb
)
returns table (added int, matched int, updated int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_name text;
  v_key text;
  v_price numeric;
  v_section text;
  v_description text;
  v_options text[];
  v_label text;
  v_dish dishes;
  v_dish_id uuid;
  v_added int := 0;
  v_matched int := 0;
  v_updated int := 0;
begin
  if not public.is_app_curator() then
    raise exception 'Only curators and admins can import menus';
  end if;

  if not exists (select 1 from restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant not found';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_name := trim(coalesce(v_item->>'name', ''));

    if v_name = '' or char_length(v_name) > 120 then
      continue;
    end if;

    v_key := public.normalize_dish_name(v_name);
    v_price := case
      when (v_item->>'price') ~ '^\d{1,5}(\.\d{1,2})?$' then (v_item->>'price')::numeric
    end;
    v_section := nullif(left(trim(coalesce(v_item->>'section', '')), 60), '');
    v_description := nullif(left(trim(coalesce(v_item->>'description', '')), 300), '');

    select coalesce(array_agg(o), '{}')
    into v_options
    from (
      select left(trim(o), 80) as o
      from jsonb_array_elements_text(coalesce(v_item->'options', '[]'::jsonb)) o
      where trim(o) <> ''
      limit 10
    ) opts;

    select * into v_dish
    from dishes
    where restaurant_id = p_restaurant_id and name_key = v_key
    limit 1;

    if v_dish.id is null then
      insert into dishes (restaurant_id, name, price, category, description, options)
      values (p_restaurant_id, v_name, v_price, v_section, v_description, v_options)
      returning id into v_dish_id;

      v_added := v_added + 1;
    elsif coalesce((v_item->>'update')::boolean, false) then
      v_dish_id := v_dish.id;

      update dishes
      set price = coalesce(v_price, price),
          category = coalesce(category, v_section),
          description = coalesce(v_description, description),
          options = case when cardinality(v_options) > 0 then v_options else options end,
          discontinued_at = null
      where id = v_dish_id;

      insert into curator_edits (action, dish_id, restaurant_id, before, after)
      values (
        'import_update',
        v_dish_id,
        p_restaurant_id,
        jsonb_build_object(
          'price', v_dish.price,
          'description', v_dish.description,
          'options', v_dish.options
        ),
        jsonb_build_object(
          'price', coalesce(v_price, v_dish.price),
          'description', coalesce(v_description, v_dish.description),
          'options', case when cardinality(v_options) > 0 then v_options else v_dish.options end
        )
      );

      v_matched := v_matched + 1;
      v_updated := v_updated + 1;
    else
      v_dish_id := v_dish.id;

      update dishes
      set price = coalesce(price, v_price),
          category = coalesce(category, v_section),
          description = coalesce(description, v_description),
          options = case when cardinality(options) = 0 then v_options else options end,
          discontinued_at = null
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

    for v_label in
      select left(trim(l), 40)
      from jsonb_array_elements_text(coalesce(v_item->'variants', '[]'::jsonb)) l
      where trim(l) <> ''
      limit 20
    loop
      select id into v_dish_id
      from dishes
      where restaurant_id = p_restaurant_id
        and name_key = public.normalize_dish_name(v_label || ' ' || v_name)
      limit 1;

      if v_dish_id is null then
        insert into dishes (restaurant_id, name, category, variant_of, variant_label)
        values (p_restaurant_id, v_label || ' ' || v_name, v_section, v_key, v_label);

        v_added := v_added + 1;
      else
        update dishes
        set variant_of = coalesce(variant_of, v_key),
            variant_label = coalesce(variant_label, v_label),
            discontinued_at = null
        where id = v_dish_id;

        v_matched := v_matched + 1;
      end if;
    end loop;
  end loop;

  insert into curator_edits (action, restaurant_id, after)
  values (
    'import_menu',
    p_restaurant_id,
    jsonb_build_object(
      'added', v_added,
      'matched', v_matched,
      'updated', v_updated,
      'items', p_items
    )
  );

  return query select v_added, v_matched, v_updated;
end;
$$;

revoke execute on function public.import_menu_dishes(uuid, jsonb) from public, anon;
grant execute on function public.import_menu_dishes(uuid, jsonb) to authenticated;
