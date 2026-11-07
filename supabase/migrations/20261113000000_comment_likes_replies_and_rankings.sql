-- Comment likes and replies, and top dishes/drinks that follow deleted
-- reviews.
--
-- Replies are one level deep, like most apps: replying to a reply attaches
-- it to the same top-level comment. Deleting a comment deletes its replies.
--
-- review_comments was created in the dashboard, so its id type is read from
-- the table rather than assumed.

do $$
declare
  v_id_type text;
begin
  select format_type(atttypid, atttypmod)
  into v_id_type
  from pg_attribute
  where attrelid = 'public.review_comments'::regclass and attname = 'id';

  execute format(
    'alter table public.review_comments
       add column if not exists parent_id %s
       references public.review_comments (id) on delete cascade',
    v_id_type
  );

  execute format(
    'create table if not exists public.review_comment_likes (
       comment_id %s not null references public.review_comments (id) on delete cascade,
       user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
       created_at timestamptz not null default now(),
       primary key (comment_id, user_id)
     )',
    v_id_type
  );
end;
$$;

create index if not exists review_comments_parent_idx
  on public.review_comments (parent_id);

-- A reply belongs to a comment on the same review; a reply to a reply goes
-- under the top-level comment.
create or replace function public.review_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent record;
begin
  if new.parent_id is null then
    return new;
  end if;

  select review_id, parent_id into v_parent
  from review_comments
  where id = new.parent_id;

  if not found or v_parent.review_id <> new.review_id then
    raise exception 'That comment isn''t on this review';
  end if;

  if v_parent.parent_id is not null then
    new.parent_id := v_parent.parent_id;
  end if;

  return new;
end;
$$;

drop trigger if exists review_comments_parent on public.review_comments;
create trigger review_comments_parent
  before insert on public.review_comments
  for each row execute function public.review_comment_parent();

alter table public.review_comment_likes enable row level security;

drop policy if exists "Anyone signed in can see comment likes" on public.review_comment_likes;
create policy "Anyone signed in can see comment likes"
  on public.review_comment_likes for select
  to authenticated
  using (true);

drop policy if exists "Users can like comments" on public.review_comment_likes;
create policy "Users can like comments"
  on public.review_comment_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can unlike comments" on public.review_comment_likes;
create policy "Users can unlike comments"
  on public.review_comment_likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- Deleting your last review of a dish takes it out of your top dishes and
-- top drinks; the picks below it move up.
create or replace function public.drop_unreviewed_rankings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_row record;
begin
  if exists (
    select 1 from reviews
    where user_id = old.user_id and dish_id = old.dish_id
  ) then
    return old;
  end if;

  delete from dish_rankings
  where user_id = old.user_id and dish_id = old.dish_id
  returning rank into v_rank;

  if v_rank is not null then
    -- One at a time, lowest first, so (user, rank) stays unique.
    for v_row in
      select id from dish_rankings
      where user_id = old.user_id and rank > v_rank
      order by rank
    loop
      update dish_rankings set rank = rank - 1 where id = v_row.id;
    end loop;
  end if;

  v_rank := null;

  delete from drink_rankings
  where user_id = old.user_id and dish_id = old.dish_id
  returning rank into v_rank;

  if v_rank is not null then
    for v_row in
      select id from drink_rankings
      where user_id = old.user_id and rank > v_rank
      order by rank
    loop
      update drink_rankings set rank = rank - 1 where id = v_row.id;
    end loop;
  end if;

  return old;
end;
$$;

drop trigger if exists reviews_drop_unreviewed_rankings on public.reviews;
create trigger reviews_drop_unreviewed_rankings
  after delete on public.reviews
  for each row execute function public.drop_unreviewed_rankings();

-- Clean up picks already left behind by deleted reviews.
delete from public.dish_rankings dr
where not exists (
  select 1 from public.reviews r
  where r.user_id = dr.user_id and r.dish_id = dr.dish_id
);

delete from public.drink_rankings dr
where not exists (
  select 1 from public.reviews r
  where r.user_id = dr.user_id and r.dish_id = dr.dish_id
);
