-- Dish tags ("Burger", "Dessert", "Alcoholic Drink"...). People vote tags onto
-- dishes when logging; a tag only shows publicly once enough different people
-- agree (dish_tag_vote_threshold, 2). Votes on the same dish at different
-- locations of a brand count together, like the restaurant page's menu.
--
-- Add a tag:
--   insert into tags (slug, label, sort_order, keywords)
--   values ('vegan', 'Vegan', 220, 'vegan|plant based');

create table if not exists public.tags (
  slug text primary key,
  label text not null,
  sort_order int not null default 0,
  -- Regex alternatives matched as whole words against normalize_dish_name()
  -- to pre-select the tag in the Log tab. Suggestions only, never votes.
  keywords text
);

alter table public.tags enable row level security;

drop policy if exists "Tags are viewable by everyone" on public.tags;
create policy "Tags are viewable by everyone"
  on public.tags for select
  using (true);

-- Keywords are written against normalized names: singular, lowercase, no
-- punctuation ("Fries" -> "fry", "Cookies" -> "cooky", "Brownies" -> "browny").
insert into public.tags (slug, label, sort_order, keywords) values
  ('burger', 'Burger', 10, 'burger|cheeseburger|hamburger|whopper|smashburger|slider'),
  ('sandwich', 'Sandwich', 20, 'sandwich|sub|hoagie|wrap|panini|blt|club|melt|grilled cheese|hot dog|po boy|cheesesteak'),
  ('pizza', 'Pizza', 30, 'pizza|calzone|stromboli'),
  ('mexican', 'Tacos & Mexican', 40, 'taco|burrito|quesadilla|nacho|enchilada|fajita|tamale|tostada|elote|chimichanga|carnitas|birria'),
  ('sushi', 'Sushi', 50, 'sushi|nigiri|sashimi|maki|poke|hand roll'),
  ('pasta', 'Pasta', 60, 'pasta|spaghetti|penne|fettuccine|alfredo|lasagna|ravioli|mac and cheese|gnocchi|carbonara|linguine|rigatoni|tortellini'),
  ('noodles', 'Noodles & Ramen', 70, 'ramen|pho|noodle|udon|lo mein|pad thai|soba|chow mein|pad see ew'),
  ('chicken', 'Chicken', 80, 'chicken|nugget|tender|rotisserie|katsu'),
  ('wings', 'Wings', 90, 'wing'),
  ('seafood', 'Seafood', 100, 'shrimp|fish|salmon|tuna|crab|lobster|oyster|clam|calamari|scallop|mussel|cod|tilapia'),
  ('steak', 'Steak', 110, 'steak|ribeye|sirloin|filet|filet mignon|new york strip|porterhouse|t bone'),
  ('bbq', 'BBQ', 120, 'bbq|barbecue|brisket|rib|pulled pork|burnt end|smoked'),
  ('salad', 'Salad', 130, 'salad|caesar'),
  ('soup', 'Soup', 140, 'soup|chowder|bisque|chili|gumbo|stew|miso'),
  ('breakfast', 'Breakfast', 150, 'breakfast|pancake|waffle|omelet|omelette|french toast|hash brown|bagel|benedict|crepe|biscuit and gravy|breakfast burrito'),
  ('side', 'Side', 160, 'fry|side|onion ring|tot|coleslaw|mashed potato|chip|mac and cheese|corn|rice'),
  ('appetizer', 'Appetizer', 170, 'appetizer|mozzarella stick|dip|spring roll|egg roll|dumpling|edamame|bruschetta|pretzel|potsticker|gyoza'),
  ('dessert', 'Dessert', 180, 'dessert|cake|cooky|browny|ice cream|sundae|milkshake|shake|mcflurry|pie|donut|doughnut|cupcake|cheesecake|gelato|churro|cannoli|tiramisu|pudding|cobbler|blizzard|frozen yogurt|froyo'),
  ('coffee-tea', 'Coffee & Tea', 190, 'coffee|latte|espresso|cappuccino|mocha|americano|cold brew|macchiato|tea|matcha|chai|boba|frappuccino'),
  ('drink', 'Drink', 200, 'drink|soda|lemonade|juice|smoothy|milkshake|shake|coke|pepsi|sprite|water|boba|frappuccino|refresher|slushy|slushie'),
  ('alcoholic-drink', 'Alcoholic Drink', 210, 'beer|ipa|lager|ale|stout|pilsner|wine|margarita|mojito|martini|cocktail|sangria|mimosa|whiskey|whisky|bourbon|tequila|vodka|sake|cider|hard seltzer|negroni|old fashioned|spritz|daiquiri|pina colada|bloody mary|paloma')
on conflict (slug) do nothing;

create table if not exists public.dish_tag_votes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dish_id uuid not null references public.dishes (id) on delete cascade,
  tag text not null references public.tags (slug) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, dish_id, tag)
);

create index if not exists dish_tag_votes_dish_id_idx on public.dish_tag_votes (dish_id);
create index if not exists dish_tag_votes_tag_idx on public.dish_tag_votes (tag);

alter table public.dish_tag_votes enable row level security;

drop policy if exists "Dish tag votes are viewable by everyone" on public.dish_tag_votes;
create policy "Dish tag votes are viewable by everyone"
  on public.dish_tag_votes for select
  using (true);

drop policy if exists "Users can add their own dish tag votes" on public.dish_tag_votes;
create policy "Users can add their own dish tag votes"
  on public.dish_tag_votes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own dish tag votes" on public.dish_tag_votes;
create policy "Users can remove their own dish tag votes"
  on public.dish_tag_votes for delete
  to authenticated
  using (auth.uid() = user_id);

-- How many different people must agree before a tag shows publicly.
create or replace function public.dish_tag_vote_threshold()
returns int
language sql
immutable
as $$
  select 2;
$$;

-- Tags to pre-select in the Log tab for a dish name. Suggestions only.
create or replace function public.guess_dish_tags(p_name text)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(t.slug order by t.sort_order), '{}')
  from tags t
  where t.keywords is not null
    and public.normalize_dish_name(p_name) ~ ('\m(' || t.keywords || ')\M');
$$;

grant execute on function public.guess_dish_tags(text) to authenticated;

-- Public tags for a dish, given all its rows across the brand's locations.
create or replace function public.dish_public_tags(p_dish_ids uuid[])
returns table (
  slug text,
  label text
)
language sql
stable
set search_path = public
as $$
  select t.slug, t.label
  from dish_tag_votes v
  join tags t on t.slug = v.tag
  where v.dish_id = any (p_dish_ids)
  group by t.slug, t.label, t.sort_order
  having count(distinct v.user_id) >= public.dish_tag_vote_threshold()
  order by t.sort_order;
$$;

grant execute on function public.dish_public_tags(uuid[]) to authenticated;

-- Best dishes with a public tag. Same-named dishes at a brand's locations
-- count as one entry. Ranked by a Bayesian average: each dish starts with 5
-- imaginary reviews at the app-wide average, so one lucky 5-star review can't
-- beat a dish many people rated 4.6.
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

-- merge_dishes() now also moves tag votes (same as rankings and list items).
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

      -- Fails (and rolls everything back) if another table still points here.
      delete from dishes where id = d.id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.merge_dishes(uuid, uuid) from public, anon, authenticated;
