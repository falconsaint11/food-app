-- Exact scores and "Which was better?" comparisons.
--
-- Ratings can now have two decimals (4.37). Everyone still picks half-stars
-- when logging; exact scores are Premium. The comparison screen shows two of
-- the user's dishes (or restaurants) with about the same score and asks which
-- was better. compare_ratings() then nudges the winner up and the loser down,
-- but never out of their star level: a 4.5 stays between 4.25 and 4.74, so
-- the stars people chose keep their meaning.
--
-- Comparisons change the user's latest entry: their newest review of the
-- dish, or their newest rated visit to the restaurant.

-- reviews was created in the dashboard, so drop whatever rating checks it
-- has by looking them up instead of by name.
do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where conrelid in ('public.reviews'::regclass, 'public.restaurant_ratings'::regclass)
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%rating%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end;
$$;

alter table public.reviews alter column rating type numeric(3, 2);
alter table public.restaurant_ratings alter column rating type numeric(3, 2);

alter table public.reviews
  add constraint reviews_rating_range check (rating >= 0.5 and rating <= 5);
alter table public.restaurant_ratings
  add constraint restaurant_ratings_rating_range check (rating >= 0.5 and rating <= 5);

-- Premium members. There's no purchase flow yet; add people by hand:
--   insert into premium_members (user_id) values ('<user id>');
create table if not exists public.premium_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.premium_members enable row level security;

-- Users can only see their own row, which is how the app checks Premium.
drop policy if exists "Users can see their own premium membership" on public.premium_members;
create policy "Users can see their own premium membership"
  on public.premium_members for select
  to authenticated
  using (auth.uid() = user_id);

-- Only Premium members can save a score that isn't a half-star, except
-- through compare_ratings(). Leaving an existing exact score unchanged (for
-- example editing only the review text) is always allowed.
create or replace function public.enforce_rating_precision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rating is null or new.rating * 2 = floor(new.rating * 2) then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.rating = old.rating then
    return new;
  end if;

  if current_setting('wotri.rating_comparison', true) = 'on' then
    return new;
  end if;

  if exists (select 1 from premium_members where user_id = auth.uid()) then
    return new;
  end if;

  raise exception 'Exact scores are a Premium feature';
end;
$$;

drop trigger if exists reviews_enforce_rating_precision on public.reviews;
create trigger reviews_enforce_rating_precision
  before insert or update of rating on public.reviews
  for each row execute function public.enforce_rating_precision();

drop trigger if exists restaurant_ratings_enforce_rating_precision on public.restaurant_ratings;
create trigger restaurant_ratings_enforce_rating_precision
  before insert or update of rating on public.restaurant_ratings
  for each row execute function public.enforce_rating_precision();

-- Every answer, with the scores before and after, so comparisons can be
-- undone or recalculated later. For 'similar' the winner/loser order means
-- nothing and the scores don't change.
create table if not exists public.rating_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('dish', 'restaurant')),
  -- A dish id, or for restaurants the brand id (the location id for a
  -- restaurant without a brand). No foreign keys, since it can be either.
  winner_id uuid not null,
  loser_id uuid not null,
  result text not null check (result in ('way_better', 'little_better', 'similar')),
  winner_before numeric(3, 2),
  winner_after numeric(3, 2),
  loser_before numeric(3, 2),
  loser_after numeric(3, 2),
  created_at timestamptz not null default now(),
  check (winner_id <> loser_id)
);

create index if not exists rating_comparisons_user_idx
  on public.rating_comparisons (user_id, kind);

alter table public.rating_comparisons enable row level security;

-- Rows are only added through compare_ratings().
drop policy if exists "Users can see their own comparisons" on public.rating_comparisons;
create policy "Users can see their own comparisons"
  on public.rating_comparisons for select
  to authenticated
  using (auth.uid() = user_id);

-- Moves a score within its star level: 4.25 to 4.74 for 4.5, 4.75 to 5 for
-- 5, and 0.5 to 0.74 for 0.5.
create or replace function public.clamp_to_star_level(p_score numeric, p_level numeric)
returns numeric
language sql
immutable
as $$
  select round(
    least(least(5, p_level + 0.24), greatest(greatest(0.5, p_level - 0.25), p_score)),
    2
  );
$$;

create or replace function public.compare_ratings(
  p_kind text,
  p_winner_id uuid,
  p_loser_id uuid,
  p_result text
)
returns table (winner_after numeric, loser_after numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_step numeric;
  v_winner_entry uuid;
  v_loser_entry uuid;
  v_winner_before numeric;
  v_loser_before numeric;
  v_winner_after numeric;
  v_loser_after numeric;
  v_middle numeric;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  if p_kind not in ('dish', 'restaurant') then
    raise exception 'Unknown kind %', p_kind;
  end if;

  v_step := case p_result
    when 'way_better' then 0.10
    when 'little_better' then 0.03
    when 'similar' then 0
  end;

  if v_step is null then
    raise exception 'Unknown result %', p_result;
  end if;

  if p_kind = 'dish' then
    select r.id, r.rating into v_winner_entry, v_winner_before
    from reviews r
    where r.user_id = v_me and r.dish_id = p_winner_id and r.rating is not null
    order by r.created_at desc
    limit 1;

    select r.id, r.rating into v_loser_entry, v_loser_before
    from reviews r
    where r.user_id = v_me and r.dish_id = p_loser_id and r.rating is not null
    order by r.created_at desc
    limit 1;
  else
    select rr.id, rr.rating into v_winner_entry, v_winner_before
    from restaurant_ratings rr
    left join restaurants loc on loc.id = rr.restaurant_id
    where rr.user_id = v_me
      and rr.rating is not null
      and coalesce(rr.brand_id, loc.brand_id, rr.restaurant_id) = p_winner_id
    order by rr.visited_at desc, rr.created_at desc
    limit 1;

    select rr.id, rr.rating into v_loser_entry, v_loser_before
    from restaurant_ratings rr
    left join restaurants loc on loc.id = rr.restaurant_id
    where rr.user_id = v_me
      and rr.rating is not null
      and coalesce(rr.brand_id, loc.brand_id, rr.restaurant_id) = p_loser_id
    order by rr.visited_at desc, rr.created_at desc
    limit 1;
  end if;

  if v_winner_entry is null or v_loser_entry is null then
    raise exception 'You haven''t rated both of these';
  end if;

  v_winner_after := clamp_to_star_level(v_winner_before + v_step, round(v_winner_before * 2) / 2);
  v_loser_after := clamp_to_star_level(v_loser_before - v_step, round(v_loser_before * 2) / 2);

  -- If the winner still isn't ahead (it started below the loser), split the
  -- difference so it ends up just above.
  if v_step > 0 and v_winner_after <= v_loser_after then
    v_middle := (v_winner_before + v_loser_before) / 2;
    v_winner_after := clamp_to_star_level(v_middle + v_step / 2, round(v_winner_before * 2) / 2);
    v_loser_after := clamp_to_star_level(v_middle - v_step / 2, round(v_loser_before * 2) / 2);
  end if;

  -- Lets enforce_rating_precision() accept the exact scores for free users.
  perform set_config('wotri.rating_comparison', 'on', true);

  if p_kind = 'dish' then
    update reviews set rating = v_winner_after where id = v_winner_entry;
    update reviews set rating = v_loser_after where id = v_loser_entry;
  else
    update restaurant_ratings set rating = v_winner_after where id = v_winner_entry;
    update restaurant_ratings set rating = v_loser_after where id = v_loser_entry;
  end if;

  perform set_config('wotri.rating_comparison', 'off', true);

  insert into rating_comparisons (
    user_id, kind, winner_id, loser_id, result,
    winner_before, winner_after, loser_before, loser_after
  )
  values (
    v_me, p_kind, p_winner_id, p_loser_id, p_result,
    v_winner_before, v_winner_after, v_loser_before, v_loser_after
  );

  return query select v_winner_after, v_loser_after;
end;
$$;

revoke execute on function public.compare_ratings(text, uuid, uuid, text) from public, anon;
grant execute on function public.compare_ratings(text, uuid, uuid, text) to authenticated;

-- delete_my_account() again, now also deleting comparisons and Premium.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not signed in';
  end if;

  -- Other people's comments, reactions and friend tags on this user's
  -- reviews, then the reviews.
  delete from review_comments
  where review_id in (select id from reviews where user_id = v_user_id);

  delete from review_reactions
  where review_id in (select id from reviews where user_id = v_user_id);

  delete from review_tags
  where review_id in (select id from reviews where user_id = v_user_id);

  -- This user's activity on other people's reviews.
  delete from review_comments where user_id = v_user_id;
  delete from review_reactions where user_id = v_user_id;
  delete from review_tags where tagged_user_id = v_user_id;

  delete from reviews where user_id = v_user_id;

  delete from list_items
  where list_id in (select id from lists where user_id = v_user_id);

  delete from lists where user_id = v_user_id;

  delete from dish_rankings where user_id = v_user_id;
  delete from restaurant_rankings where user_id = v_user_id;
  delete from restaurant_ratings where user_id = v_user_id;
  delete from rating_comparisons where user_id = v_user_id;
  delete from premium_members where user_id = v_user_id;
  delete from dish_tag_votes where user_id = v_user_id;
  delete from notification_reads where user_id = v_user_id;

  delete from follows
  where follower_id = v_user_id or following_id = v_user_id;

  delete from profiles where id = v_user_id;

  -- Finally the login itself.
  delete from auth.users where id = v_user_id;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
