-- Steam-style user tags on restaurants ("Date Night", "Patio", "Late Night").
-- Anyone signed in can add a tag to a restaurant or vote for one that's
-- already there; tags with the most votes show first. Tags are free text,
-- matched case- and space-insensitively, and count per location since things
-- like a patio differ between a chain's locations.

create table if not exists public.restaurant_tag_votes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  -- Lowercased with spaces collapsed, set by the trigger below.
  tag_key text not null,
  -- How this person typed it.
  label text not null
    check (
      char_length(label) between 2 and 24
      and label ~ '^[[:alnum:]][[:alnum:] &''+./-]*$'
    ),
  created_at timestamptz not null default now(),
  primary key (user_id, restaurant_id, tag_key)
);

create index if not exists restaurant_tag_votes_restaurant_idx
  on public.restaurant_tag_votes (restaurant_id);

create index if not exists restaurant_tag_votes_tag_key_idx
  on public.restaurant_tag_votes (tag_key);

create or replace function public.prepare_restaurant_tag_vote()
returns trigger
language plpgsql
as $$
begin
  new.label := regexp_replace(btrim(new.label), '\s+', ' ', 'g');
  new.tag_key := lower(new.label);

  -- Plenty for real use; stops anyone spamming one place with tags.
  if (
    select count(*)
    from restaurant_tag_votes
    where user_id = new.user_id and restaurant_id = new.restaurant_id
  ) >= 20 then
    raise exception 'You can add up to 20 tags to one restaurant';
  end if;

  return new;
end;
$$;

drop trigger if exists restaurant_tag_votes_prepare on public.restaurant_tag_votes;
create trigger restaurant_tag_votes_prepare
before insert on public.restaurant_tag_votes
for each row execute function public.prepare_restaurant_tag_vote();

alter table public.restaurant_tag_votes enable row level security;

drop policy if exists "Restaurant tag votes are viewable by signed-in users" on public.restaurant_tag_votes;
create policy "Restaurant tag votes are viewable by signed-in users"
  on public.restaurant_tag_votes for select to authenticated
  using (true);

drop policy if exists "Users can add their own restaurant tag votes" on public.restaurant_tag_votes;
create policy "Users can add their own restaurant tag votes"
  on public.restaurant_tag_votes for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can remove their own restaurant tag votes" on public.restaurant_tag_votes;
create policy "Users can remove their own restaurant tag votes"
  on public.restaurant_tag_votes for delete to authenticated
  using (user_id = auth.uid());

-- A restaurant's tags, most votes first. The label shown is the most common
-- way people typed it.
create or replace function public.restaurant_tags(p_restaurant_id uuid)
returns table (tag_key text, label text, votes int, mine boolean)
language sql
stable
set search_path = public
as $$
  select
    v.tag_key,
    mode() within group (order by v.label) as label,
    count(*)::int as votes,
    bool_or(v.user_id = auth.uid()) as mine
  from restaurant_tag_votes v
  where v.restaurant_id = p_restaurant_id
  group by v.tag_key
  order by count(*) desc, min(v.created_at);
$$;

grant execute on function public.restaurant_tags(uuid) to authenticated;

-- The tags used on the most restaurants, for suggestions when adding one.
create or replace function public.popular_restaurant_tags(p_limit int default 20)
returns table (tag_key text, label text, restaurants int)
language sql
stable
set search_path = public
as $$
  select
    v.tag_key,
    mode() within group (order by v.label) as label,
    count(distinct v.restaurant_id)::int as restaurants
  from restaurant_tag_votes v
  group by v.tag_key
  order by count(distinct v.restaurant_id) desc, count(*) desc
  limit least(greatest(p_limit, 1), 50);
$$;

grant execute on function public.popular_restaurant_tags(int) to authenticated;
