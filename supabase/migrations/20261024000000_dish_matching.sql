-- Dish de-duplication: a normalized name_key so "Fries", "fries" and
-- "Large Fries" count as one dish, fuzzy search so "fry" suggests
-- "French Fries", and merge_dishes() to clean up duplicates that slip through.

create extension if not exists pg_trgm with schema extensions;

-- "Large French Fries" -> "french fry", "6-inch Subs" -> "sub",
-- "Kid's Chicken Tenders" -> "chicken tender". Sizes are dropped on purpose:
-- people rate the item, not the size.
create or replace function public.normalize_dish_name(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
  word text;
  words text[] := '{}';
  all_words text[] := '{}';
begin
  cleaned := lower(coalesce(p_name, ''));
  cleaned := regexp_replace(cleaned, '[''’`]', '', 'g');
  cleaned := replace(cleaned, '&', ' and ');
  cleaned := regexp_replace(cleaned, '\m\d+\s*-?\s*(inch|in|oz|ounce|piece|pc|pcs|count|ct)\M', ' ', 'g');
  cleaned := regexp_replace(cleaned, '[^a-z0-9]+', ' ', 'g');

  foreach word in array regexp_split_to_array(trim(cleaned), '\s+') loop
    if word = '' then
      continue;
    end if;

    -- Singularize: fries -> fry, tacos -> taco, sandwiches -> sandwich.
    if length(word) > 4 and word ~ 'ies$' then
      word := left(word, -3) || 'y';
    elsif length(word) > 4 and word ~ '((ch|sh|x|ss)es|oes)$' then
      word := left(word, -2);
    elsif length(word) > 3 and word ~ 's$' and word !~ '(ss|us|is)$' then
      word := left(word, -1);
    end if;

    -- "cookie" and "cookies" (-> "cooky") must land on the same key.
    if length(word) > 3 and word ~ 'ie$' then
      word := left(word, -2) || 'y';
    end if;

    all_words := all_words || word;

    if word not in ('small', 'medium', 'large', 'regular', 'kid', 'kids', 'xl', 'sm', 'md', 'lg', 'jr', 'junior', 'mini') then
      words := words || word;
    end if;
  end loop;

  -- A dish named only by a size word ("Large") keeps it.
  if array_length(words, 1) is null then
    words := all_words;
  end if;

  return array_to_string(words, ' ');
end;
$$;

alter table public.dishes add column if not exists name_key text;

create or replace function public.set_dish_name_key()
returns trigger
language plpgsql
as $$
begin
  new.name_key := public.normalize_dish_name(new.name);
  return new;
end;
$$;

drop trigger if exists dishes_set_name_key on public.dishes;
create trigger dishes_set_name_key
  before insert or update of name on public.dishes
  for each row execute function public.set_dish_name_key();

update public.dishes set name_key = public.normalize_dish_name(name);

create index if not exists dishes_restaurant_name_key_idx
  on public.dishes (restaurant_id, name_key);

create index if not exists dishes_name_key_trgm_idx
  on public.dishes using gin (name_key extensions.gin_trgm_ops);

-- Dishes at the given locations matching what the user typed, best first,
-- one row per name_key (preferring the row at p_current_restaurant_id).
create or replace function public.search_dishes(
  p_location_ids uuid[],
  p_query text,
  p_current_restaurant_id uuid default null,
  p_limit int default 8
)
returns table (
  id uuid,
  name text,
  restaurant_id uuid,
  name_key text,
  score real,
  is_exact boolean
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
      d.name_key = q.key as is_exact
    from dishes d
    cross join query q
    where d.restaurant_id = any (p_location_ids)
      and q.key <> ''
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

grant execute on function public.search_dishes(uuid[], text, uuid, int) to authenticated;

-- Merge one dish into another across the whole brand, keeping every review at
-- its own location. Run it from the SQL editor, e.g.
--   select merge_dishes('<id of "Fry">', '<id of "French Fries">');
-- At each location of the brand, the "from" dish's reviews, rankings and list
-- entries move to that location's "into" dish (or the "from" dish is simply
-- renamed if the location has no "into" dish). Returns rows merged/renamed.
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

      -- Fails (and rolls everything back) if another table still points here.
      delete from dishes where id = d.id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.merge_dishes(uuid, uuid) from public, anon, authenticated;
