-- Read-only brand lookup, so the Log tab can suggest a chain's existing menu
-- for a Google place that hasn't been saved as a restaurant yet.
-- find_or_create_brand now shares this matching logic.

create or replace function public.find_brand(p_name text, p_website text)
returns uuid
language plpgsql
stable
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

  return v_brand_id;
end;
$$;

grant execute on function public.find_brand(text, text) to authenticated;

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

  v_brand_id := public.find_brand(p_name, p_website);

  if v_brand_id is not null then
    -- A name match picks up the website domain if the brand didn't have one.
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
