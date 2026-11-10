-- A review can move to another flavor or type of its dish (Edit Review ->
-- "Flavor or type"). If that was the author's last review of the old dish,
-- its spot in their top dishes and top drinks moves to the new dish; if the
-- new dish is already ranked, the old spot is dropped and the picks below it
-- move up, like when a review is deleted.

create or replace function public.move_rankings_on_dish_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_row record;
begin
  if new.dish_id is not distinct from old.dish_id then
    return new;
  end if;

  if exists (
    select 1 from reviews
    where user_id = old.user_id and dish_id = old.dish_id
  ) then
    return new;
  end if;

  -- Top dishes: move the spot, or drop it if the new dish already has one.
  update dish_rankings
  set dish_id = new.dish_id
  where user_id = old.user_id and dish_id = old.dish_id
    and not exists (
      select 1 from dish_rankings
      where user_id = old.user_id and dish_id = new.dish_id
    );

  v_rank := null;

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

  -- Top drinks, the same way.
  update drink_rankings
  set dish_id = new.dish_id
  where user_id = old.user_id and dish_id = old.dish_id
    and not exists (
      select 1 from drink_rankings
      where user_id = old.user_id and dish_id = new.dish_id
    );

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

  return new;
end;
$$;

drop trigger if exists reviews_move_rankings_on_dish_change on public.reviews;
create trigger reviews_move_rankings_on_dish_change
  after update of dish_id on public.reviews
  for each row execute function public.move_rankings_on_dish_change();
