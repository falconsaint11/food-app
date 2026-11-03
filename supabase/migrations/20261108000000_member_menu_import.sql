-- Anyone can add a menu from a photo while a restaurant's menu is small
-- (under 10 dishes, a chain's locations counting together), so new spots get
-- a menu from whoever eats there first. Curators and admins still can
-- anytime. Members get 5 scans a day and can only add dishes and fill in
-- blanks, not overwrite details on dishes already on the menu.

-- Dishes on a restaurant's menu: distinct names across the chain's
-- locations, not counting discontinued ones.
create or replace function public.menu_dish_count(p_restaurant_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct d.name_key)::int
  from dishes d
  join restaurants r on r.id = d.restaurant_id
  where d.discontinued_at is null
    and (
      r.id = p_restaurant_id
      or r.brand_id = (select brand_id from restaurants where id = p_restaurant_id)
    );
$$;

revoke execute on function public.menu_dish_count(uuid) from public, anon;
grant execute on function public.menu_dish_count(uuid) to authenticated;

-- Called by the menu-scan edge function before each photo. Each scan is a
-- paid Claude call: curators get 20 a day, members 5 (and only for small
-- menus), admins have no limit.
drop function if exists public.claim_menu_scan();

create or replace function public.claim_menu_scan(p_restaurant_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_curator boolean := public.is_app_curator();
  v_limit int := case when v_is_curator then 20 else 5 end;
begin
  if not v_is_curator then
    if p_restaurant_id is null
      or not exists (select 1 from restaurants where id = p_restaurant_id) then
      raise exception 'Restaurant not found';
    end if;

    if public.menu_dish_count(p_restaurant_id) >= 10 then
      raise exception 'This menu already has 10 or more dishes. Only curators can add to it.';
    end if;
  end if;

  if not public.is_app_admin() and (
    select count(*)
    from menu_scans
    where user_id = auth.uid()
      and created_at > now() - interval '1 day'
  ) >= v_limit then
    raise exception 'You''ve scanned % menu photos today. Try again tomorrow.', v_limit;
  end if;

  insert into menu_scans (user_id) values (auth.uid());
end;
$$;

revoke execute on function public.claim_menu_scan(uuid) from public, anon;
grant execute on function public.claim_menu_scan(uuid) to authenticated;

-- import_menu_dishes() again, now for members on small menus too. The
-- "update" flag only counts for curators.
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
  v_is_curator boolean := public.is_app_curator();
begin
  if not v_is_curator and public.menu_dish_count(p_restaurant_id) >= 10 then
    raise exception 'This menu already has 10 or more dishes. Only curators can add to it.';
  end if;

  if jsonb_array_length(p_items) > 300 then
    raise exception 'That''s too many dishes for one import';
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
    elsif v_is_curator and coalesce((v_item->>'update')::boolean, false) then
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
