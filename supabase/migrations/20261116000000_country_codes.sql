-- Two-letter country codes (US, JP, MX) next to the country names Google
-- prints, so the app can show a flag beside restaurants abroad.

alter table public.restaurants add column if not exists country_code text;

-- Google's English country names (the end of a formatted address) to ISO
-- codes. Unknown names give null, and the app shows no flag.
create or replace function public.country_code_for(p_country text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_country, '')))
    when 'usa' then 'US'
    when 'united states' then 'US'
    when 'puerto rico' then 'PR'
    when 'canada' then 'CA'
    when 'mexico' then 'MX'
    when 'méxico' then 'MX'
    when 'guatemala' then 'GT'
    when 'belize' then 'BZ'
    when 'el salvador' then 'SV'
    when 'honduras' then 'HN'
    when 'nicaragua' then 'NI'
    when 'costa rica' then 'CR'
    when 'panama' then 'PA'
    when 'cuba' then 'CU'
    when 'jamaica' then 'JM'
    when 'bahamas' then 'BS'
    when 'the bahamas' then 'BS'
    when 'dominican republic' then 'DO'
    when 'haiti' then 'HT'
    when 'aruba' then 'AW'
    when 'curaçao' then 'CW'
    when 'barbados' then 'BB'
    when 'trinidad and tobago' then 'TT'
    when 'cayman islands' then 'KY'
    when 'u.s. virgin islands' then 'VI'
    when 'british virgin islands' then 'VG'
    when 'turks and caicos islands' then 'TC'
    when 'bermuda' then 'BM'
    when 'colombia' then 'CO'
    when 'venezuela' then 'VE'
    when 'ecuador' then 'EC'
    when 'peru' then 'PE'
    when 'bolivia' then 'BO'
    when 'chile' then 'CL'
    when 'argentina' then 'AR'
    when 'uruguay' then 'UY'
    when 'paraguay' then 'PY'
    when 'brazil' then 'BR'
    when 'united kingdom' then 'GB'
    when 'uk' then 'GB'
    when 'ireland' then 'IE'
    when 'france' then 'FR'
    when 'spain' then 'ES'
    when 'portugal' then 'PT'
    when 'italy' then 'IT'
    when 'germany' then 'DE'
    when 'netherlands' then 'NL'
    when 'the netherlands' then 'NL'
    when 'belgium' then 'BE'
    when 'luxembourg' then 'LU'
    when 'switzerland' then 'CH'
    when 'austria' then 'AT'
    when 'denmark' then 'DK'
    when 'norway' then 'NO'
    when 'sweden' then 'SE'
    when 'finland' then 'FI'
    when 'iceland' then 'IS'
    when 'poland' then 'PL'
    when 'czechia' then 'CZ'
    when 'czech republic' then 'CZ'
    when 'slovakia' then 'SK'
    when 'hungary' then 'HU'
    when 'romania' then 'RO'
    when 'bulgaria' then 'BG'
    when 'greece' then 'GR'
    when 'croatia' then 'HR'
    when 'slovenia' then 'SI'
    when 'serbia' then 'RS'
    when 'bosnia and herzegovina' then 'BA'
    when 'montenegro' then 'ME'
    when 'albania' then 'AL'
    when 'north macedonia' then 'MK'
    when 'malta' then 'MT'
    when 'cyprus' then 'CY'
    when 'estonia' then 'EE'
    when 'latvia' then 'LV'
    when 'lithuania' then 'LT'
    when 'ukraine' then 'UA'
    when 'moldova' then 'MD'
    when 'georgia' then 'GE'
    when 'armenia' then 'AM'
    when 'azerbaijan' then 'AZ'
    when 'türkiye' then 'TR'
    when 'turkey' then 'TR'
    when 'monaco' then 'MC'
    when 'andorra' then 'AD'
    when 'israel' then 'IL'
    when 'palestine' then 'PS'
    when 'lebanon' then 'LB'
    when 'jordan' then 'JO'
    when 'egypt' then 'EG'
    when 'morocco' then 'MA'
    when 'tunisia' then 'TN'
    when 'saudi arabia' then 'SA'
    when 'united arab emirates' then 'AE'
    when 'qatar' then 'QA'
    when 'bahrain' then 'BH'
    when 'kuwait' then 'KW'
    when 'oman' then 'OM'
    when 'south africa' then 'ZA'
    when 'kenya' then 'KE'
    when 'tanzania' then 'TZ'
    when 'nigeria' then 'NG'
    when 'ghana' then 'GH'
    when 'ethiopia' then 'ET'
    when 'mauritius' then 'MU'
    when 'india' then 'IN'
    when 'pakistan' then 'PK'
    when 'bangladesh' then 'BD'
    when 'sri lanka' then 'LK'
    when 'nepal' then 'NP'
    when 'maldives' then 'MV'
    when 'china' then 'CN'
    when 'hong kong' then 'HK'
    when 'macao' then 'MO'
    when 'macau' then 'MO'
    when 'taiwan' then 'TW'
    when 'japan' then 'JP'
    when 'south korea' then 'KR'
    when 'mongolia' then 'MN'
    when 'thailand' then 'TH'
    when 'vietnam' then 'VN'
    when 'cambodia' then 'KH'
    when 'laos' then 'LA'
    when 'myanmar (burma)' then 'MM'
    when 'myanmar' then 'MM'
    when 'malaysia' then 'MY'
    when 'singapore' then 'SG'
    when 'indonesia' then 'ID'
    when 'philippines' then 'PH'
    when 'brunei' then 'BN'
    when 'australia' then 'AU'
    when 'new zealand' then 'NZ'
    when 'fiji' then 'FJ'
    when 'french polynesia' then 'PF'
    when 'guam' then 'GU'
    else null
  end;
$$;

update public.restaurants
set country_code = public.country_code_for(country)
where country_code is null;

-- assign_restaurant_brand() again: also fills the code.
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
  new.country_code := public.country_code_for(new.country);

  if new.brand_id is null then
    new.brand_id := public.find_or_create_brand(new.name, new.website, new.country);
  end if;

  return new;
end;
$$;
