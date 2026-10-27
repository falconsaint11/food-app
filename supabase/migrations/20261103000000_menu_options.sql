-- Menu descriptions and options, and a limit on menu imports.
--
-- A menu item stays one dish ("Quesadilla"), not one dish per protein. What's
-- printed under it ("Flour Tortilla, Jack Cheese") goes in description, and
-- choices ("Add protein +$3", "Soft or crunchy", "Small $3.25 / Big $6") go in
-- options. Diners can say what they picked in their review.
--
-- Menu import is for getting a restaurant started, so it's refused once the
-- restaurant (all locations of its brand) has 10 or more dishes.

alter table public.dishes add column if not exists description text;
alter table public.dishes add column if not exists options text[] not null default '{}';

-- import_menu_dishes() again. Items can now carry description and options,
-- which are kept on dishes that already have them.
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
  v_description text;
  v_options text[];
  v_brand_id uuid;
  v_dish_id uuid;
  v_added int := 0;
  v_matched int := 0;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can import menus';
  end if;

  select brand_id into v_brand_id from restaurants where id = p_restaurant_id;

  if not found then
    raise exception 'Restaurant not found';
  end if;

  -- Counted the way the restaurant page lists the menu: same-named dishes
  -- across the brand's locations count once.
  if (
    select count(distinct d.name_key)
    from dishes d
    join restaurants r on r.id = d.restaurant_id
    where r.id = p_restaurant_id
      or (v_brand_id is not null and r.brand_id = v_brand_id)
  ) >= 10 then
    raise exception 'This restaurant already has 10 or more dishes, so its menu can''t be imported';
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
    v_description := nullif(left(trim(coalesce(v_item->>'description', '')), 300), '');

    select coalesce(array_agg(o), '{}')
    into v_options
    from (
      select left(trim(o), 80) as o
      from jsonb_array_elements_text(coalesce(v_item->'options', '[]'::jsonb)) o
      where trim(o) <> ''
      limit 10
    ) opts;

    select id into v_dish_id
    from dishes
    where restaurant_id = p_restaurant_id
      and name_key = public.normalize_dish_name(v_name)
    limit 1;

    if v_dish_id is null then
      insert into dishes (restaurant_id, name, price, category, description, options)
      values (p_restaurant_id, v_name, v_price, v_section, v_description, v_options)
      returning id into v_dish_id;

      v_added := v_added + 1;
    else
      update dishes
      set price = coalesce(price, v_price),
          category = coalesce(category, v_section),
          description = coalesce(description, v_description),
          options = case when cardinality(options) = 0 then v_options else options end
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
