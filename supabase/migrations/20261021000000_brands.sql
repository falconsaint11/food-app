-- Brands: groups restaurant locations (rows in `restaurants`) under one chain,
-- e.g. every Chipotle location points at a single "Chipotle" brand.
--
-- Matching order when a restaurant is inserted without a brand_id:
--   1. website domain (eTLD+1, ignoring shared hosting/ordering platforms)
--   2. normalized name (only against brands whose domain doesn't conflict)
--   3. otherwise create a new brand

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand_key text not null,
  website_domain text unique,
  created_at timestamptz not null default now()
);

create index if not exists brands_brand_key_idx on public.brands (brand_key);

alter table public.restaurants
  add column if not exists brand_id uuid references public.brands (id) on delete set null,
  add column if not exists website text;

create index if not exists restaurants_brand_id_idx on public.restaurants (brand_id);

-- Fails if duplicate place IDs already exist; dedupe those rows first.
create unique index if not exists restaurants_google_place_id_key
  on public.restaurants (google_place_id)
  where google_place_id is not null;

alter table public.brands enable row level security;

drop policy if exists "Brands are viewable by everyone" on public.brands;
create policy "Brands are viewable by everyone"
  on public.brands for select
  using (true);

-- "McDonald's" -> "mcdonalds", "The Halal Guys" -> "halal guys",
-- "Chipotle Mexican Grill - Downtown" -> "chipotle mexican grill"
create or replace function public.normalize_brand_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(split_part(split_part(coalesce(p_name, ''), ' - ', 1), ' | ', 1)),
                '[''’`]', '', 'g'
              ),
              '&', ' and ', 'g'
            ),
            '[^a-z0-9]+', ' ', 'g'
          ),
          '^the ', ''
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

-- "https://locations.chipotle.com/ca/..." -> "chipotle.com".
-- Returns null for platforms many unrelated restaurants share, so they never
-- get merged into one brand by domain.
create or replace function public.brand_domain_from_url(p_url text)
returns text
language plpgsql
immutable
as $$
declare
  host text;
  labels text[];
  n int;
  domain text;
begin
  if p_url is null or trim(p_url) = '' then
    return null;
  end if;

  host := lower(substring(trim(p_url) from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/?#:]+)'));
  if host is null or position('.' in host) = 0 then
    return null;
  end if;

  labels := string_to_array(host, '.');
  n := array_length(labels, 1);

  -- Two-part public suffixes like co.uk / com.au keep three labels.
  if n >= 3 and labels[n - 1] in ('co', 'com', 'net', 'org', 'gov', 'ac', 'edu') and length(labels[n]) = 2 then
    domain := labels[n - 2] || '.' || labels[n - 1] || '.' || labels[n];
  else
    domain := labels[n - 1] || '.' || labels[n];
  end if;

  if domain in (
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
    'linktr.ee', 'yelp.com', 'google.com', 'business.site', 'goo.gl',
    'toasttab.com', 'square.site', 'squareup.com', 'clover.com',
    'wixsite.com', 'wix.com', 'squarespace.com', 'weebly.com',
    'godaddysites.com', 'wordpress.com', 'blogspot.com',
    'doordash.com', 'ubereats.com', 'grubhub.com', 'seamless.com',
    'postmates.com', 'order.online', 'chownow.com', 'menufy.com',
    'slicelife.com', 'beyondmenu.com', 'menupages.com', 'opentable.com',
    'resy.com', 'exploretock.com', 'spoton.com', 'popmenu.com'
  ) then
    return null;
  end if;

  return domain;
end;
$$;

create or replace function public.find_or_create_brand(p_name text, p_website text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text := public.brand_domain_from_url(p_website);
  v_key text := coalesce(public.normalize_brand_name(p_name), lower(trim(p_name)));
  v_brand_id uuid;
begin
  if v_key is null or v_key = '' then
    return null;
  end if;

  -- Serialize concurrent inserts for the same name so we don't create twins.
  perform pg_advisory_xact_lock(hashtext('brand:' || v_key));

  if v_domain is not null then
    select id into v_brand_id from brands where website_domain = v_domain;
    if v_brand_id is not null then
      return v_brand_id;
    end if;
  end if;

  -- Same name only counts if the domains don't contradict each other, so two
  -- unrelated "Joe's Pizza" shops with different websites stay separate.
  select id into v_brand_id
  from brands
  where brand_key = v_key
    and (v_domain is null or website_domain is null)
  order by created_at
  limit 1;

  if v_brand_id is not null then
    if v_domain is not null then
      update brands set website_domain = v_domain
      where id = v_brand_id and website_domain is null;
    end if;
    return v_brand_id;
  end if;

  begin
    insert into brands (name, brand_key, website_domain)
    values (trim(p_name), v_key, v_domain)
    returning id into v_brand_id;
  exception when unique_violation then
    -- Another insert claimed this domain under a different name.
    select id into v_brand_id from brands where website_domain = v_domain;
  end;

  return v_brand_id;
end;
$$;

revoke execute on function public.find_or_create_brand(text, text) from public, anon, authenticated;

create or replace function public.assign_restaurant_brand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.brand_id is null then
    new.brand_id := public.find_or_create_brand(new.name, new.website);
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_assign_brand on public.restaurants;
create trigger restaurants_assign_brand
  before insert on public.restaurants
  for each row execute function public.assign_restaurant_brand();

-- Backfill existing restaurants (name matching only, since no websites were saved).
update public.restaurants
set brand_id = public.find_or_create_brand(name, website)
where brand_id is null;
