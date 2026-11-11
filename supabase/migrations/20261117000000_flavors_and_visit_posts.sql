-- 1. Several flavors on one review: a bowl with chicken, shrimp and steak, or
--    two flavors of frozen yogurt. The review goes on the plain dish and
--    review_flavors lists the flavors picked. A review with one flavor still
--    points straight at that flavor's dish, as before.
-- 2. Restaurant ratings become posts: a photo, likes, and comments with
--    replies and comment likes, like dish reviews.

-- 1. Flavors ------------------------------------------------------------------

-- reviews and dishes were created in the dashboard, so their id types are
-- read from the tables rather than assumed.
do $$
declare
  v_review_id_type text;
  v_dish_id_type text;
begin
  select format_type(atttypid, atttypmod) into v_review_id_type
  from pg_attribute
  where attrelid = 'public.reviews'::regclass and attname = 'id';

  select format_type(atttypid, atttypmod) into v_dish_id_type
  from pg_attribute
  where attrelid = 'public.dishes'::regclass and attname = 'id';

  execute format(
    'create table if not exists public.review_flavors (
       review_id %s not null references public.reviews (id) on delete cascade,
       dish_id %s not null references public.dishes (id) on delete cascade,
       created_at timestamptz not null default now(),
       id uuid primary key default gen_random_uuid()
     )',
    v_review_id_type,
    v_dish_id_type
  );
end;
$$;

-- Its own id rather than a (review_id, dish_id) key on purpose: with that
-- key the API would read this as a link table between reviews and dishes,
-- and every query embedding a review's dishes would become ambiguous. The
-- app replaces a review's flavors all at once, so pairs don't repeat.
create index if not exists review_flavors_review_idx
  on public.review_flavors (review_id);

create index if not exists review_flavors_dish_idx
  on public.review_flavors (dish_id);

alter table public.review_flavors enable row level security;

drop policy if exists "Anyone signed in can see review flavors" on public.review_flavors;
create policy "Anyone signed in can see review flavors"
  on public.review_flavors for select
  to authenticated
  using (true);

drop policy if exists "Authors can add flavors to their reviews" on public.review_flavors;
create policy "Authors can add flavors to their reviews"
  on public.review_flavors for insert
  to authenticated
  with check (
    exists (
      select 1 from public.reviews r
      where r.id = review_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "Authors can remove flavors from their reviews" on public.review_flavors;
create policy "Authors can remove flavors from their reviews"
  on public.review_flavors for delete
  to authenticated
  using (
    exists (
      select 1 from public.reviews r
      where r.id = review_id and r.user_id = auth.uid()
    )
  );

-- 2. Restaurant rating posts --------------------------------------------------

-- "<user id>/<file>" in the review-photos bucket, like review photos, so
-- account deletion removes it.
alter table public.restaurant_ratings
  add column if not exists photo_path text;

create table if not exists public.restaurant_rating_likes (
  restaurant_rating_id uuid not null
    references public.restaurant_ratings (id) on delete cascade,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (restaurant_rating_id, user_id)
);

create index if not exists restaurant_rating_likes_user_idx
  on public.restaurant_rating_likes (user_id);

alter table public.restaurant_rating_likes enable row level security;

drop policy if exists "Anyone signed in can see restaurant rating likes" on public.restaurant_rating_likes;
create policy "Anyone signed in can see restaurant rating likes"
  on public.restaurant_rating_likes for select
  to authenticated
  using (true);

drop policy if exists "Users can like restaurant ratings" on public.restaurant_rating_likes;
create policy "Users can like restaurant ratings"
  on public.restaurant_rating_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can unlike restaurant ratings" on public.restaurant_rating_likes;
create policy "Users can unlike restaurant ratings"
  on public.restaurant_rating_likes for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.restaurant_rating_comments (
  id uuid primary key default gen_random_uuid(),
  restaurant_rating_id uuid not null
    references public.restaurant_ratings (id) on delete cascade,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  -- Replies are one level deep, like on dish reviews.
  parent_id uuid references public.restaurant_rating_comments (id) on delete cascade,
  comment_text text not null
    check (char_length(trim(comment_text)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists restaurant_rating_comments_rating_idx
  on public.restaurant_rating_comments (restaurant_rating_id, created_at);

create index if not exists restaurant_rating_comments_parent_idx
  on public.restaurant_rating_comments (parent_id);

alter table public.restaurant_rating_comments enable row level security;

drop policy if exists "Anyone signed in can see restaurant rating comments" on public.restaurant_rating_comments;
create policy "Anyone signed in can see restaurant rating comments"
  on public.restaurant_rating_comments for select
  to authenticated
  using (true);

drop policy if exists "Users can comment on restaurant ratings" on public.restaurant_rating_comments;
create policy "Users can comment on restaurant ratings"
  on public.restaurant_rating_comments for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Your own comments, comments on your rating, or any for admins.
drop policy if exists "Users can delete restaurant rating comments" on public.restaurant_rating_comments;
create policy "Users can delete restaurant rating comments"
  on public.restaurant_rating_comments for delete
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.restaurant_ratings rr
      where rr.id = restaurant_rating_id and rr.user_id = auth.uid()
    )
    or public.is_app_admin()
  );

-- A reply belongs to a comment on the same rating; a reply to a reply goes
-- under the top-level comment. Blocked users can't comment on each other.
create or replace function public.restaurant_rating_comment_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent record;
begin
  if public.users_blocked(
    new.user_id,
    (select user_id from restaurant_ratings where id = new.restaurant_rating_id)
  ) then
    raise exception 'You can''t comment on this post';
  end if;

  if new.parent_id is null then
    return new;
  end if;

  select restaurant_rating_id, parent_id into v_parent
  from restaurant_rating_comments
  where id = new.parent_id;

  if not found or v_parent.restaurant_rating_id <> new.restaurant_rating_id then
    raise exception 'That comment isn''t on this post';
  end if;

  if v_parent.parent_id is not null then
    new.parent_id := v_parent.parent_id;
  end if;

  return new;
end;
$$;

drop trigger if exists restaurant_rating_comments_checks on public.restaurant_rating_comments;
create trigger restaurant_rating_comments_checks
  before insert on public.restaurant_rating_comments
  for each row execute function public.restaurant_rating_comment_checks();

create table if not exists public.restaurant_rating_comment_likes (
  comment_id uuid not null
    references public.restaurant_rating_comments (id) on delete cascade,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.restaurant_rating_comment_likes enable row level security;

drop policy if exists "Anyone signed in can see restaurant comment likes" on public.restaurant_rating_comment_likes;
create policy "Anyone signed in can see restaurant comment likes"
  on public.restaurant_rating_comment_likes for select
  to authenticated
  using (true);

drop policy if exists "Users can like restaurant comments" on public.restaurant_rating_comment_likes;
create policy "Users can like restaurant comments"
  on public.restaurant_rating_comment_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can unlike restaurant comments" on public.restaurant_rating_comment_likes;
create policy "Users can unlike restaurant comments"
  on public.restaurant_rating_comment_likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- The new comments can be reported like other posts.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in (
    'review', 'comment', 'restaurant_note', 'user', 'restaurant_photo',
    'restaurant_comment'
  ));

-- Review authors can delete comments on their own reviews too (policies add
-- up, so commenters keep deleting their own).
drop policy if exists "Review authors can delete comments on their reviews" on public.review_comments;
create policy "Review authors can delete comments on their reviews"
  on public.review_comments for delete
  to authenticated
  using (
    exists (
      select 1 from public.reviews r
      where r.id = review_id and r.user_id = auth.uid()
    )
  );
