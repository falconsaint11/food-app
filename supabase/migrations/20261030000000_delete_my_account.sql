-- Account deletion (required by the App Store). The Settings screen first
-- removes the user's photos through the Storage API, then calls
-- delete_my_account(), which deletes the user's data and their login.
--
-- Everything is deleted explicitly, children before parents, so it works
-- whatever ON DELETE rule each table was created with. It runs as one
-- transaction: if a table it doesn't know about still points at the user,
-- it fails and nothing is deleted.
--
-- Shared data stays: restaurants and dishes the user added belong to everyone.

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

-- Let users delete the files in their own photo folders
-- ("<user id>/<file>"), which account deletion does before calling the
-- function above. They can't touch anyone else's files.
drop policy if exists "Users can delete their own photos" on storage.objects;
create policy "Users can delete their own photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('review-photos', 'profile-photos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
