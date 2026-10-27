-- Dish variants, discontinued dishes, the Secret Menu tag, and admin dish
-- editing.
--
-- Variants: "Steak Quesadilla" is its own dish (own ratings and photos) with
-- variant_of = the name_key of "Quesadilla" and variant_label = 'Steak'. The
-- restaurant page lists it under Quesadilla. Linking by name_key, not id,
-- makes it work across a brand's locations like the rest of the menu.
-- Diners can add variants when logging; admins can change them.
--
-- Discontinued: dishes the restaurant no longer serves. Nothing is deleted.
-- They leave the menu and Log tab suggestions but keep their reviews and show
-- a "Discontinued" label everywhere else.

alter table public.dishes add column if not exists variant_of text;
alter table public.dishes add column if not exists variant_label text;
alter table public.dishes add column if not exists discontinued_at timestamptz;

alter table public.dishes drop constraint if exists dishes_variant_label_length;
alter table public.dishes
  add constraint dishes_variant_label_length check (char_length(variant_label) <= 40);

create index if not exists dishes_variant_of_idx
  on public.dishes (variant_of) where variant_of is not null;

insert into public.tags (slug, label, sort_order, keywords, kind) values
  ('secret-menu', 'Secret Menu', 420, 'secret menu|animal style', 'availability')
on conflict (slug) do nothing;

-- Menu details (description, options), variant links and discontinued are
-- set by admins and the menu import. Regular users logging a dish can only
-- create a variant; anything else they send is dropped. Security definer
-- functions and the SQL editor run as another role and skip this.
create or replace function public.protect_dish_admin_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_app_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.description := null;
    new.options := '{}';
    new.discontinued_at := null;
    new.variant_label := nullif(trim(new.variant_label), '');

    if new.variant_of is null or new.variant_label is null then
      new.variant_of := null;
      new.variant_label := null;
    end if;
  else
    new.description := old.description;
    new.options := old.options;
    new.discontinued_at := old.discontinued_at;
    new.variant_of := old.variant_of;
    new.variant_label := old.variant_label;
  end if;

  return new;
end;
$$;

drop trigger if exists dishes_protect_admin_columns on public.dishes;
create trigger dishes_protect_admin_columns
  before insert or update on public.dishes
  for each row execute function public.protect_dish_admin_columns();

-- search_dishes() again: skips discontinued dishes unless asked (saving a log
-- still finds them, so it doesn't create a duplicate), and says whether a
-- dish has variants or options so the Log tab can ask "Which one?". The
-- return type changes, so drop the old version first.
drop function if exists public.search_dishes(uuid[], text, uuid, int);

create function public.search_dishes(
  p_location_ids uuid[],
  p_query text,
  p_current_restaurant_id uuid default null,
  p_limit int default 8,
  p_include_discontinued boolean default false
)
returns table (
  id uuid,
  name text,
  restaurant_id uuid,
  name_key text,
  score real,
  is_exact boolean,
  variant_of text,
  variant_label text,
  has_choices boolean
)
language sql
stable
set search_path = public, extensions
as $$
  with query as (
    select public.normalize_dish_name(p_query) as key
  ),
  matches as (
    select distinct on (d.name_key)
      d.id,
      d.name,
      d.restaurant_id,
      d.name_key,
      greatest(
        similarity(q.key, d.name_key),
        word_similarity(q.key, d.name_key),
        case when d.name_key like '%' || q.key || '%' then 0.9 else 0 end,
        case when d.name_key = q.key then 1 else 0 end
      )::real as score,
      d.name_key = q.key as is_exact,
      d.variant_of,
      d.variant_label,
      cardinality(d.options) > 0 or exists (
        select 1 from dishes v
        where v.restaurant_id = any (p_location_ids)
          and v.variant_of = d.name_key
          and v.discontinued_at is null
      ) as has_choices
    from dishes d
    cross join query q
    where d.restaurant_id = any (p_location_ids)
      and q.key <> ''
      and (p_include_discontinued or d.discontinued_at is null)
      and (
        d.name_key like '%' || q.key || '%'
        or word_similarity(q.key, d.name_key) >= 0.5
        or similarity(q.key, d.name_key) >= 0.3
      )
    order by d.name_key, (d.restaurant_id = p_current_restaurant_id) desc nulls last
  )
  select * from matches
  order by is_exact desc, score desc, name
  limit p_limit;
$$;

grant execute on function public.search_dishes(uuid[], text, uuid, int, boolean) to authenticated;

-- Admin edit from the dish page. Name, description, options, variant link
-- and discontinued apply to the dish at every location of the brand (rows
-- with the same name_key); price only to this location, since chains price
-- by location. Discontinuing a dish also discontinues its variants, and
-- bringing it back brings them back. Returns how many rows changed.
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
  v_count int;
begin
  if not public.is_app_admin() then
    raise exception 'Only admins can edit dishes';
  end if;

  select * into d from dishes where id = p_dish_id;

  if d.id is null then
    raise exception 'Dish not found';
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
      description = nullif(left(trim(coalesce(p_description, '')), 300), ''),
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

  return v_count;
end;
$$;

revoke execute on function public.admin_update_dish(uuid, text, numeric, text, text[], text, text, boolean)
  from public, anon;
grant execute on function public.admin_update_dish(uuid, text, numeric, text, text[], text, text, boolean)
  to authenticated;

-- import_menu_dishes() again. Items can list variants by label
-- (["Mango", "Strawberry"]); each becomes "Mango Slushie Margarita" under the
-- dish. A dish that's on the menu again stops being discontinued.
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
  v_key text;
  v_price numeric;
  v_section text;
  v_description text;
  v_options text[];
  v_label text;
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

    select id into v_dish_id
    from dishes
    where restaurant_id = p_restaurant_id and name_key = v_key
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

  return query select v_added, v_matched;
end;
$$;

revoke execute on function public.import_menu_dishes(uuid, jsonb) from public, anon;
grant execute on function public.import_menu_dishes(uuid, jsonb) to authenticated;
