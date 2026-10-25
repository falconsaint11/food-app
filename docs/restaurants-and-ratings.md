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
| How many per user | One per log | One per **visit**: every Log tab save adds one (stars optional), and so does each Rate button save |
| Shown on | Dish rows, Top Items, the dish page | The restaurant page header |

`restaurant_ratings` is a visit log: each row is one visit (`visited_at`), and
`rating` is null when the user skipped the restaurant stars. How many rows a
user has for a brand is how many times they've been there; the restaurant page
shows "You've been here N times". A visit can also have `notes` about the
restaurant itself (up to 2,000 characters); the latest 5 across the brand show
on the restaurant page under "What people are saying". Each row is for exactly one of
`restaurant_id` (a location) or `brand_id` (the whole restaurant). `brand_id` has no foreign key
on purpose; see the comment in `20261027000000_brand_ratings.sql`.

The restaurant page header averages **each person's** ratings across the brand
(every visit with stars, location and brand-wide) first, then averages those
people. Someone who rated five McDonald's counts as
one vote. Dish reviews never count toward the restaurant rating; a restaurant
nobody has rated shows "No ratings yet".

Ways to rate:
- **Log tab ("Log a Visit"):** pick the restaurant once, then add any number of
  dish cards (name + stars; notes, photo and tags tucked under "+ Notes, photo,
  tags"). "How was …?" restaurant stars and "Who'd you go with?" apply to the
  whole visit, and friends are tagged on every dish review. Each dish gets the
  duplicate check ("Did you mean …?") when saving.
- **Log tab with no dishes:** just the restaurant stars, saved for that
  location ("Save Restaurant Rating"). Tagging friends needs a dish.
- **Restaurant notes:** a "What stood out about the restaurant?" box appears in
  the Log tab once the restaurant is rated, and in the Rate pop-up.
- **Restaurant page, ★ Rate:** a pop-up with only the stars and the user's
  history ("You've rated it 3 times · last 4★"). Each save adds a new
  brand-wide visit, so there's no location to pick.
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

### Restaurants Google doesn't have

The Log tab only lets you pick restaurants from search (saved ones or Google).
For a place Google doesn't list, "Can't find it? Add … by name" creates it by
name only. The optional "I'm here right now" switch saves the phone's location
as the restaurant's coordinates and fills in the city and state from it. A
by-name restaurant is only reused for another log if the name, city and state
match.

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

Run in order in the Supabase SQL editor. All except `20261031000000_report_and_block.sql`
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
| `20261028000000_restaurant_visits.sql` | Turns `restaurant_ratings` into a visit log: no more one-per-user limit, optional `rating`, `visited_at` |
| `20261029000000_restaurant_visit_notes.sql` | Optional `notes` on each visit (max 2,000 characters) |
| `20261030000000_delete_my_account.sql` | `delete_my_account()` and a storage rule letting users delete their own photo folders |
| `20261031000000_report_and_block.sql` | `reports` and `blocks` tables, `block_user()`, `my_hidden_user_ids()`, triggers refusing follows/comments/tags between blocked users |

Don't add a foreign key from `dishes` to `reviews`. `reviews.dish_id` already
links them, and a second link breaks every `reviews … dishes (…)` query.

## Settings and account deletion

`app/settings.tsx` (⚙️ Settings on your profile, next to Edit Profile) has
change email (Supabase emails a confirmation link), change password, Log Out,
and Delete account.

Deleting an account (type DELETE to confirm):
1. Removes the user's photos from `review-photos` and `profile-photos`
   (their `<user id>/` folders) through the Storage API, and stops if any
   are left.
2. Calls `delete_my_account()`, which deletes their reviews (with everyone's
   comments, reactions and friend tags on them), their own comments,
   reactions and tags elsewhere, lists and list items, rankings, visits, tag
   votes, notification reads, follows both ways, profile, and login, in one
   transaction. Restaurants and dishes they added stay.

**If you add a table that points at users or reviews, add it to
`delete_my_account()`.** Otherwise deleting an account fails with an error
(nothing is deleted), which blocks App Store-required deletion.

## Reporting and blocking

Required by the App Store for apps where people post content.

- **⋯ menu** (`components/content-menu.tsx`) on reviews, comments, restaurant
  notes and profiles: **Report** (pick a reason) and **Block**. It doesn't
  show on your own content.
- **Reports** go to the `reports` table. **Check open reports in Supabase
  (`status = 'open'`) at least daily**: Apple expects action within about a
  day. Delete the content (or the account) if needed, then set `status` to
  `resolved` or `dismissed`. One report per person per item.
- **Blocking** (`block_user()`) removes follows both ways and friend tags on
  each other's reviews. Database triggers refuse new follows, comments and
  friend tags between the two.
- **Hiding:** `my_hidden_user_ids()` returns everyone blocked either way
  without saying which. `lib/moderation.ts` caches it and
  `withoutHiddenUsers()` filters lists: review comments, restaurant and dish
  review lists, restaurant notes, notifications and user search. A blocked
  person's review page and profile show as unavailable (or "You blocked this
  user" with Unblock). Their ratings still count toward averages.
- **Settings → Blocked users** lists who you blocked, with Unblock.

**New screens that show other people's posts should filter them with
`withoutHiddenUsers()` and add a `<ContentMenu>`.**

## Known gaps

- **Dish rankings and lists** point at a single location's dish row. Ranking
  "Fries" from two McDonald's shows it twice. The fix is making dishes
  brand-level, which is a larger change.
- **Covers follow viewers' permissions:** `cover_photos()` runs with the
  viewer's permissions, so private reviews can make covers differ per person.
- **No photo moderation** yet. Ideas: a "Report photo" option, or automatic
  checks for non-food photos.
