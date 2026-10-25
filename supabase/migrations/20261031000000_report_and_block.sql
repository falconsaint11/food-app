-- Reporting and blocking (required by the App Store for apps with
-- user-posted content).
--
-- reports: anyone can report a review, comment, restaurant note or user. Check
-- open reports in the Supabase table editor (status = 'open') and act within a
-- day; set status to 'resolved' or 'dismissed' when done.
--
-- blocks: blocking someone removes follows both ways and their friend tags,
-- and the database refuses new follows, comments and friend tags between the
-- two. The app hides each person's content from the other using
-- my_hidden_user_ids().

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_type text not null
    check (target_type in ('review', 'comment', 'restaurant_note', 'user')),
  -- Text, since review and comment ids may not be uuids.
  target_id text not null,
  -- Who posted it, to spot repeat offenders. No foreign key, so a report
  -- survives the reported account being deleted.
  reported_user_id uuid,
  reason text not null
    check (reason in ('spam', 'offensive', 'harassment', 'not_food', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  -- One report per person per item.
  unique (reporter_id, target_type, target_id)
);

create index if not exists reports_status_idx on public.reports (status, created_at);

alter table public.reports enable row level security;

drop policy if exists "Users can report content" on public.reports;
create policy "Users can report content"
  on public.reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "Users can see their own reports" on public.reports;
create policy "Users can see their own reports"
  on public.reports for select
  to authenticated
  using (auth.uid() = reporter_id);

create table if not exists public.blocks (
  blocker_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_id_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

-- Users see only who they blocked (for the Blocked users list), not who
-- blocked them.
drop policy if exists "Users can see who they blocked" on public.blocks;
create policy "Users can see who they blocked"
  on public.blocks for select
  to authenticated
  using (auth.uid() = blocker_id);

drop policy if exists "Users can unblock" on public.blocks;
create policy "Users can unblock"
  on public.blocks for delete
  to authenticated
  using (auth.uid() = blocker_id);

-- True if either user has blocked the other.
create or replace function public.users_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from blocks
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke execute on function public.users_blocked(uuid, uuid) from public, anon, authenticated;

-- Everyone whose content the current user shouldn't see: people they blocked
-- and people who blocked them, without revealing which is which.
create or replace function public.my_hidden_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct other_id), '{}')
  from (
    select blocked_id as other_id from blocks where blocker_id = auth.uid()
    union
    select blocker_id from blocks where blocked_id = auth.uid()
  ) others;
$$;

revoke execute on function public.my_hidden_user_ids() from public, anon;
grant execute on function public.my_hidden_user_ids() to authenticated;

-- Blocks a user and cuts existing ties: follows both ways and friend tags on
-- each other's reviews.
create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  if p_user_id = v_me then
    raise exception 'You can''t block yourself';
  end if;

  insert into blocks (blocker_id, blocked_id)
  values (v_me, p_user_id)
  on conflict do nothing;

  delete from follows
  where (follower_id = v_me and following_id = p_user_id)
     or (follower_id = p_user_id and following_id = v_me);

  delete from review_tags
  where (tagged_user_id = v_me
         and review_id in (select id from reviews where user_id = p_user_id))
     or (tagged_user_id = p_user_id
         and review_id in (select id from reviews where user_id = v_me));
end;
$$;

revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- Refuse new follows, comments and friend tags between blocked users.
create or replace function public.prevent_blocked_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.users_blocked(new.follower_id, new.following_id) then
    raise exception 'You can''t follow this user';
  end if;
  return new;
end;
$$;

drop trigger if exists follows_prevent_blocked on public.follows;
create trigger follows_prevent_blocked
  before insert on public.follows
  for each row execute function public.prevent_blocked_follow();

create or replace function public.prevent_blocked_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.users_blocked(
    new.user_id,
    (select user_id from reviews where id = new.review_id)
  ) then
    raise exception 'You can''t comment on this review';
  end if;
  return new;
end;
$$;

drop trigger if exists review_comments_prevent_blocked on public.review_comments;
create trigger review_comments_prevent_blocked
  before insert on public.review_comments
  for each row execute function public.prevent_blocked_comment();

create or replace function public.prevent_blocked_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.users_blocked(
    new.tagged_user_id,
    (select user_id from reviews where id = new.review_id)
  ) then
    raise exception 'You can''t tag this user';
  end if;
  return new;
end;
$$;

drop trigger if exists review_tags_prevent_blocked on public.review_tags;
create trigger review_tags_prevent_blocked
  before insert on public.review_tags
  for each row execute function public.prevent_blocked_tag();
