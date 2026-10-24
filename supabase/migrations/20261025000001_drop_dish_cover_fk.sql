-- dishes.cover_review_id -> reviews made a second relationship between dishes
-- and reviews (alongside reviews.dish_id -> dishes), so every
-- `reviews ... dishes (...)` query failed with "more than one relationship".
-- Keep the pin column as a plain value; cover_photos() ignores a pin whose
-- review no longer exists.
alter table public.dishes drop constraint if exists dishes_cover_review_id_fkey;
