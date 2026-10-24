# Restaurants, dishes and ratings

How restaurant data is organized, how ratings, tags and photos work, and the SQL
commands for cleaning things up. The database changes live in
`supabase/migrations/` (see [Migrations](#migrations)).

## Brands and locations

- A row in `restaurants` is **one physical location**, usually one Google
  place (`google_place_id` is unique). Every location keeps its own address
  and coordinates for the future map.
- A row in `brands` groups locations into one public restaurant, so all
  Chipotle locations point at a single "Chipotle" brand
  (`restaurants.brand_id`).
- The restaurant page (`app/restaurant/[id].tsx`) is one profile per brand.
  Opening any McDonald's shows the same page, which combines dishes, reviews
  and ratings from every McDonald's location. It doesn't list locations.

### How a new location gets its brand

A database trigger assigns the brand whenever a restaurant row is inserted, so
the app never has to do it. It tries, in order:

1. **Website domain.** `https://locations.chipotle.com/ca/...` becomes
   `chipotle.com`. Domains many unrelated restaurants share (Toast, Square,
   Wix, Facebook, DoorDash, Yelp and so on) are ignored, so they never merge
   unrelated places.
2. **Normalized name.** "McDonald's" becomes `mcdonalds`, "The Halal Guys"
   becomes `halal guys`, and anything after " - " is dropped. A name match is
   skipped if the two places have *different* known websites, so two unrelated
   "Joe's Pizza" shops stay separate.
3. **Otherwise a new brand is created.**

The app saves the place's website when it creates a restaurant (`website`
column), but the Google `google-place-details` edge function lives only in the
Supabase dashboard. It has to request `websiteUri` and return it as `website`.
Until it does, matching falls back to the name.

Fix a wrong grouping by changing that restaurant's `brand_id`.

## Ratings

There are two separate kinds of rating:

| | Dish rating | Restaurant rating |
|---|---|---|
| Table | `reviews` (via `dishes`) | `restaurant_ratings` |
| Required when logging? | Only if a dish is entered | Only if no dish is entered |
| How many per user | One per log | One per **location** (Log tab) and one per **brand** (Rate button); rating again replaces it |
| Shown on | Dish rows, Top Items, the dish page | The restaurant page header |

Each `restaurant_ratings` row is for exactly one of `restaurant_id` (a
location) or `brand_id` (the whole restaurant). `brand_id` has no foreign key
on purpose; see the comment in `20261027000000_brand_ratings.sql`.

The restaurant page header averages **each person's** ratings across the brand
(location and brand-wide ratings) first, then averages those people. Someone who rated five McDonald's counts as
one vote. Dish reviews never count toward the restaurant rating; a restaurant
nobody has rated shows "No ratings yet".

Ways to rate:
- **Log tab with a dish:** dish stars (required) and "How was the restaurant?"
  (optional), saved for that location.
- **Log tab with no dish:** just the restaurant stars, saved for that location
  ("Save Restaurant Rating"). Notes, photos and friends need a dish.
- **Restaurant page, ★ Rate:** a pop-up with only the stars. It saves one
  brand-wide rating, so there's no location to pick.
- **Restaurant page, + Log a dish** and **dish page, ★ Rate this dish:** open
  the Log tab pre-filled through the `restaurantId` and `dishName` params,
  using the nearest location.

"Nearest" uses the phone's location only if permission was already granted.
These buttons never ask for it. Without it, the location the page was opened
from is used.

## Dishes and duplicates

- Dishes belong to a **location** (`dishes.restaurant_id`), so each review
  stays tied to where it was eaten. "Big Mac" at two McDonald's are two rows;
  the pages combine them.
- `dishes.name_key` is a cleaned-up name set by a trigger: lowercase, no
  punctuation, singular, and size words removed. "Fries", "Large Fries" and
  "fry" all become `fry`. Pages group dishes by `name_key`. People still see the
  name as typed.
- **Log tab suggestions** come from the whole brand's menu and use fuzzy search
  (`search_dishes()`, `pg_trgm`), so typing "fry" suggests "French Fries".
- **Before creating a new dish:** an exact `name_key` match is reused without
  asking. A close match pops up "Did you mean …?" (similarity ≥ 0.5, see
  `SIMILAR_DISH_PROMPT_SCORE` in `app/(tabs)/log.tsx`).
- Picking a dish that only exists at another location creates a row for it at
  the current location, using the existing name.

## Dish tags

Tags like Burger, Dessert or Alcoholic Drink let people browse "top burgers"
on Discover.

- **A fixed list** lives in the `tags` table, so there are no
  "burger / burgers / hamburger" duplicates. A dish can have several tags (a
  milkshake is Dessert + Drink).
- **People vote when logging.** The Log tab shows optional tag chips,
  pre-selected from the dish name using each tag's `keywords`
  (`guess_dish_tags()`). Guesses are only suggestions; the person logging
  still has to confirm. Each pick is stored as a vote in `dish_tag_votes`.
- **A tag shows publicly only once 2 different people agree**
  (`dish_tag_vote_threshold()`). Votes on the same dish at different locations
  of a brand count together; the same person voting twice counts once.
- **Discover → Top Rated Dishes** has tag chips. Picking one lists the best
  dishes with that public tag (`top_dishes_by_tag()`), one entry per dish
  across a brand's locations. The ranking is a Bayesian average: each dish
  starts with 5 imaginary reviews at the app-wide average, so one lucky 5★
  review can't beat a dish many people rated 4.6★.
- **Dish page:** shows the dish's public tags under its name.

## Cover photos

Restaurant and dish pages show the top 5 review photos as a swipeable strip
(`components/cover-photos.tsx`, `cover_photos()` in SQL):

- Only photos from reviews rated **3.5★ or higher** qualify.
- Score = 2 points per reaction + the star rating − about 1 point per 6 months
  of age.
- Restaurant page: photos from any dish at any location of the brand. Dish
  page: photos of that dish (same `name_key`) at every location.
- With no qualifying photos, the page shows an orange glow behind the initial.
- A pinned review's photo always comes first (see below).

## Admin SQL

Run these in the Supabase SQL editor. App users can't run them.

```sql
-- Merge a duplicate dish into another across the whole brand. Each review
-- stays at its own location; rankings and list entries move with it.
select id, name from dishes where name ilike '%fr%';
select merge_dishes('<id of "Fry">', '<id of "French Fries">');

-- Pin a cover photo (any review id with a photo)
update brands set cover_review_id = '<review id>' where id = '<brand id>';
update dishes set cover_review_id = '<review id>' where id = '<dish id>';

-- Add a dish tag (keywords pre-select it in the Log tab)
insert into tags (slug, label, sort_order, keywords)
values ('vegan', 'Vegan', 220, 'vegan|plant based');

-- Require 3 people to agree instead of 2
create or replace function dish_tag_vote_threshold() returns int
language sql immutable as $$ select 3; $$;

-- Move a location to a different brand
update restaurants set brand_id = '<brand id>' where id = '<restaurant id>';
```

`merge_dishes()` also moves tag votes. It removes a user's ranking of the
duplicate if they also ranked the surviving dish, which can leave a gap in
their ranking numbers.

## Migrations

Run in order in the Supabase SQL editor. All except `20261027000000_brand_ratings.sql`
have already been run on the shared project.

| File | What it does |
|---|---|
| `20261021000000_brands.sql` | `brands` table, `restaurants.brand_id` / `website`, brand-matching trigger, unique `google_place_id`, backfill |
| `20261022000000_restaurant_ratings.sql` | `restaurant_ratings` table and its access rules |
| `20261023000000_find_brand.sql` | Read-only `find_brand()` lookup used by the Log tab for unsaved Google places |
| `20261024000000_dish_matching.sql` | `dishes.name_key`, `pg_trgm`, `search_dishes()`, `merge_dishes()` |
| `20261025000000_cover_photos.sql` | `cover_review_id` pins and `cover_photos()` |
| `20261025000001_drop_dish_cover_fk.sql` | Removes a foreign key that made `reviews → dishes` queries ambiguous (it broke the feed) |
| `20261026000000_dish_tags.sql` | `tags` list, `dish_tag_votes`, tag guesses, public tags (2-vote rule), `top_dishes_by_tag()`, and `merge_dishes()` moving tag votes |
| `20261027000000_brand_ratings.sql` | Brand-wide restaurant ratings: `restaurant_ratings.brand_id`, exactly one of location or brand per row |

Don't add a foreign key from `dishes` to `reviews`. `reviews.dish_id` already
links them, and a second link breaks every `reviews … dishes (…)` query.

## Known gaps

- **Dish rankings and lists** point at a single location's dish row. Ranking
  "Fries" from two McDonald's shows it twice. The fix is making dishes
  brand-level, which is a larger change.
- **Covers follow viewers' permissions:** `cover_photos()` runs with the
  viewer's permissions, so private reviews can make covers differ per person.
- **No photo moderation** yet. Ideas: a "Report photo" option, or automatic
  checks for non-food photos.
