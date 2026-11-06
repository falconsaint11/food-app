-- Friends tagged on a restaurant rating ("Who'd you go with?"), so a visit
-- logged without any dishes can still say who came along. Works like
-- review_tags: the rating's author tags people, and either side can remove
-- the tag.

create table if not exists public.restaurant_rating_tags (
  id uuid primary key default gen_random_uuid(),
  restaurant_rating_id uuid not null
    references public.restaurant_ratings (id) on delete cascade,
  tagged_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (restaurant_rating_id, tagged_user_id)
);

create index if not exists restaurant_rating_tags_user_idx
  on public.restaurant_rating_tags (tagged_user_id);

alter table public.restaurant_rating_tags enable row level security;

drop policy if exists "Anyone signed in can see restaurant rating tags" on public.restaurant_rating_tags;
create policy "Anyone signed in can see restaurant rating tags"
  on public.restaurant_rating_tags for select
  to authenticated
  using (true);

drop policy if exists "Authors can tag friends on their ratings" on public.restaurant_rating_tags;
create policy "Authors can tag friends on their ratings"
  on public.restaurant_rating_tags for insert
  to authenticated
  with check (
    tagged_user_id <> auth.uid()
    and exists (
      select 1 from public.restaurant_ratings rr
      where rr.id = restaurant_rating_id and rr.user_id = auth.uid()
    )
  );

drop policy if exists "Authors and tagged users can remove tags" on public.restaurant_rating_tags;
create policy "Authors and tagged users can remove tags"
  on public.restaurant_rating_tags for delete
  to authenticated
  using (
    tagged_user_id = auth.uid()
    or exists (
      select 1 from public.restaurant_ratings rr
      where rr.id = restaurant_rating_id and rr.user_id = auth.uid()
    )
  );

-- Blocked users can't tag each other, like on dish reviews.
create or replace function public.prevent_blocked_restaurant_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.users_blocked(
    new.tagged_user_id,
    (select user_id from restaurant_ratings where id = new.restaurant_rating_id)
  ) then
    raise exception 'You can''t tag this user';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurant_rating_tags_prevent_blocked on public.restaurant_rating_tags;
create trigger restaurant_rating_tags_prevent_blocked
  before insert on public.restaurant_rating_tags
  for each row execute function public.prevent_blocked_restaurant_tag();
