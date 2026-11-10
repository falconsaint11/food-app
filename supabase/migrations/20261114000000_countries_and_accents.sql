-- Restaurants abroad, and dish names with accents or other alphabets.
--
-- 1. Every restaurant gets a country, read from its Google address ("...,
--    Chandler, AZ 85224, USA" -> "USA", "..., Shibuya, Tokyo 150-0002,
--    Japan" -> "Japan"). Restaurants added by hand count as USA.
-- 2. Chains are grouped per country: McDonald's in Japan is its own brand,
--    with its own menu and ratings, apart from McDonald's in the US.
-- 3. Dish and chain names match across accents ("Phở" = "Pho", "Jalapeño" =
--    "Jalapeno") and keep letters from other alphabets ("ラーメン"), which
--    used to be dropped, leaving an empty name key.

create extension if not exists unaccent with schema extensions;

-- 1. Countries -------------------------------------------------------------

alter table public.restaurants add column if not exists country text;
alter table public.brands add column if not exists country text;

-- The last part of a Google formatted address is the country. Anything else
-- (a hand-typed address, no address) counts as USA.
create or replace function public.country_from_address(
  p_address text,
  p_google_place_id text
)
returns text
language plpgsql
immutable
as $$
declare
  v_last text;
begin
  if p_google_place_id is null or p_address is null or trim(p_address) = '' then
    return 'USA';
  end if;

  v_last := trim(regexp_replace(p_address, '^.*,', ''));

  -- "AZ 85224" with no country after it, or anything with digits, isn't a
  -- country name.
  if v_last = '' or v_last ~ '\d' then
    return 'USA';
  end if;

  if lower(v_last) in ('usa', 'us', 'united states', 'united states of america') then
    return 'USA';
  end if;

  return v_last;
end;
$$;

update public.restaurants
set country = public.country_from_address(address, google_place_id)
where country is null;

alter table public.restaurants alter column country set default 'USA';

-- 3 (first, since brands use it). Names --------------------------------------

-- Accents come off ("é" -> "e"), then only ASCII punctuation, spaces and
-- common Asian punctuation split words, so letters in any alphabet stay.
create or replace function public.simplify_name_text(p_text text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select trim(
    regexp_replace(
      lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, ''))),
      '[\u0001-/:-@[-`{-\u007f -¿‐-⁯　-〿・！-／：-＠]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.normalize_dish_name(p_name text)
returns text
language plpgsql
immutable
set search_path = public, extensions
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
  cleaned := public.simplify_name_text(cleaned);

  foreach word in array regexp_split_to_array(cleaned, '\s+') loop
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

-- "McDonald's" -> "mcdonalds", "The Halal Guys" -> "halal guys",
-- "Chipotle Mexican Grill - Downtown" -> "chipotle mexican grill",
-- "Café Rio" -> "cafe rio".
create or replace function public.normalize_brand_name(p_name text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        public.simplify_name_text(
          replace(
            regexp_replace(
              lower(split_part(split_part(coalesce(p_name, ''), ' - ', 1), ' | ', 1)),
              '[''’`]', '', 'g'
            ),
            '&', ' and '
          )
        ),
        '^the ', ''
      ),
      '\s+', ' ', 'g'
    ),
    ''
  );
$$;

-- Re-key every dish. Flavors point at their dish by its key, so they follow
-- wherever an old key maps to exactly one new one.
with keys as (
  select distinct name_key as old_key, public.normalize_dish_name(name) as new_key
  from public.dishes
  where name_key is not null
),
key_map as (
  select old_key, min(new_key) as new_key
  from keys
  group by old_key
  having count(distinct new_key) = 1
)
update public.dishes d
set variant_of = m.new_key
from key_map m
where d.variant_of = m.old_key
  and m.old_key <> m.new_key;

update public.dishes
set name_key = public.normalize_dish_name(name)
where name_key is distinct from public.normalize_dish_name(name);

update public.brands
set brand_key = coalesce(public.normalize_brand_name(name), lower(trim(name)))
where brand_key is distinct from coalesce(public.normalize_brand_name(name), lower(trim(name)));

-- 2. Chains per country -----------------------------------------------------

-- A brand takes the country most of its locations are in.
update public.brands b
set country = coalesce(
  (
    select r.country from public.restaurants r
    where r.brand_id = b.id
    group by r.country
    order by count(*) desc, r.country
    limit 1
  ),
  'USA'
)
where b.country is null;

alter table public.brands alter column country set default 'USA';
alter table public.brands alter column country set not null;

-- Locations in another country than their brand move to a brand of their own
-- country (one per brand and country).
do $$
declare
  v_pair record;
  v_new_brand uuid;
begin
  for v_pair in
    select distinct r.brand_id, r.country, b.name, b.brand_key
    from public.restaurants r
    join public.brands b on b.id = r.brand_id
    where r.country is distinct from b.country
  loop
    insert into public.brands (name, brand_key, website_domain, country)
    values (v_pair.name, v_pair.brand_key, null, v_pair.country)
    returning id into v_new_brand;

    update public.restaurants
    set brand_id = v_new_brand
    where brand_id = v_pair.brand_id and country = v_pair.country;
  end loop;
end;
$$;

-- The same website can now belong to one brand per country.
alter table public.brands drop constraint if exists brands_website_domain_key;
drop index if exists public.brands_website_domain_key;
create unique index if not exists brands_website_domain_country_key
  on public.brands (website_domain, country);

create index if not exists brands_key_country_idx
  on public.brands (brand_key, country);

-- find_brand() and find_or_create_brand() again, matching only brands in the
-- restaurant's country. The Log tab passes the Google address of a place it
-- hasn't saved yet; older app versions don't, and count as USA.
drop function if exists public.find_or_create_brand(text, text);
drop function if exists public.find_brand(text, text);

create or replace function public.find_brand(
  p_name text,
  p_website text,
  p_address text default null
)
returns uuid
language plpgsql
stable
set search_path = public
as $$
begin
  -- Only Google places are looked up before saving, so the address is
  -- Google's.
  return public.find_brand_in_country(
    p_name,
    p_website,
    public.country_from_address(
      p_address,
      case when p_address is null then null else 'google' end
    )
  );
end;
$$;

grant execute on function public.find_brand(text, text, text) to authenticated;

create or replace function public.find_brand_in_country(
  p_name text,
  p_website text,
  p_country text
)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_domain text := public.brand_domain_from_url(p_website);
  v_key text := coalesce(public.normalize_brand_name(p_name), lower(trim(p_name)));
  v_country text := coalesce(p_country, 'USA');
  v_brand_id uuid;
begin
  if v_key is null or v_key = '' then
    return null;
  end if;

  if v_domain is not null then
    select id into v_brand_id
    from brands
    where website_domain = v_domain and country = v_country;
    if v_brand_id is not null then
      return v_brand_id;
    end if;
  end if;

  -- Same name only counts if the domains don't contradict each other, so two
  -- unrelated "Joe's Pizza" shops with different websites stay separate.
  select id into v_brand_id
  from brands
  where brand_key = v_key
    and country = v_country
    and (v_domain is null or website_domain is null)
  order by created_at
  limit 1;

  return v_brand_id;
end;
$$;

revoke execute on function public.find_brand_in_country(text, text, text) from public, anon;
grant execute on function public.find_brand_in_country(text, text, text) to authenticated;

create or replace function public.find_or_create_brand(
  p_name text,
  p_website text,
  p_country text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text := public.brand_domain_from_url(p_website);
  v_key text := coalesce(public.normalize_brand_name(p_name), lower(trim(p_name)));
  v_country text := coalesce(p_country, 'USA');
  v_brand_id uuid;
begin
  if v_key is null or v_key = '' then
    return null;
  end if;

  -- Serialize concurrent inserts for the same name so we don't create twins.
  perform pg_advisory_xact_lock(hashtext('brand:' || v_country || ':' || v_key));

  v_brand_id := public.find_brand_in_country(p_name, p_website, v_country);

  if v_brand_id is not null then
    -- A name match picks up the website domain if the brand didn't have one.
    if v_domain is not null then
      update brands set website_domain = v_domain
      where id = v_brand_id and website_domain is null
        and not exists (
          select 1 from brands
          where website_domain = v_domain and country = v_country
        );
    end if;
    return v_brand_id;
  end if;

  begin
    insert into brands (name, brand_key, website_domain, country)
    values (trim(p_name), v_key, v_domain, v_country)
    returning id into v_brand_id;
  exception when unique_violation then
    -- Another insert claimed this domain under a different name.
    select id into v_brand_id
    from brands
    where website_domain = v_domain and country = v_country;
  end;

  return v_brand_id;
end;
$$;

revoke execute on function public.find_or_create_brand(text, text, text) from public, anon, authenticated;

-- New restaurants get their country from the address, then a brand in that
-- country.
create or replace function public.assign_restaurant_brand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The column defaults to USA, so only another country sent on purpose
  -- is kept; otherwise the address decides.
  new.country := coalesce(
    nullif(new.country, 'USA'),
    public.country_from_address(new.address, new.google_place_id)
  );

  if new.brand_id is null then
    new.brand_id := public.find_or_create_brand(new.name, new.website, new.country);
  end if;

  return new;
end;
$$;

drop trigger if exists restaurants_assign_brand on public.restaurants;
create trigger restaurants_assign_brand
  before insert on public.restaurants
  for each row execute function public.assign_restaurant_brand();
