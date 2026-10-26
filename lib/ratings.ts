import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

// Whether the signed-in user has Premium (a row in premium_members). Cached
// per user so switching accounts checks again.
let premiumCache: { userId: string; promise: Promise<boolean> } | null = null;

export async function fetchIsPremium() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  if (premiumCache?.userId !== user.id) {
    const promise = (async () => {
      const { data, error } = await supabase
        .from('premium_members')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        premiumCache = null;
        console.log('Premium check error:', error.message);
        return false;
      }

      return data !== null;
    })();

    premiumCache = { userId: user.id, promise };
  }

  return premiumCache.promise;
}

export function useIsPremium() {
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    let active = true;

    fetchIsPremium().then((value) => {
      if (active) setIsPremium(value);
    });

    return () => {
      active = false;
    };
  }, []);

  return isPremium;
}

// The star level a score belongs to: 4.37 is a 4.5.
export function toStarLevel(rating: number) {
  return Math.round(rating * 2) / 2;
}

// Ratings can have two decimals (comparisons and Premium edits). Premium
// members see the exact score; everyone else sees the half-star it rounds to.
export function formatRating(rating: number | string, exact: boolean) {
  const value = Number(rating);

  if (exact && value !== toStarLevel(value)) {
    return value.toFixed(2);
  }

  return String(toStarLevel(value));
}

// One dish or restaurant with a user's latest score for it.
export type ScoredItem = {
  // Dish id, or brand id for restaurants (location id when there's no brand).
  id: string;
  // The review or restaurant_ratings row holding the latest score.
  entryId: string;
  name: string;
  subtitle: string | null;
  rating: number;
  // Where tapping the name goes.
  linkId: string;
};

// A user's latest score for each dish they've reviewed.
export async function fetchLatestDishScores(
  userId: string
): Promise<ScoredItem[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select(`
      id,
      dish_id,
      rating,
      dishes (
        id,
        name,
        restaurants (
          name
        )
      )
    `)
    .eq('user_id', userId)
    .not('rating', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  // Newest first, so the first review of each dish is the latest entry.
  const items = new Map<string, ScoredItem>();

  for (const row of data ?? []) {
    const dish = row.dishes as unknown as {
      id: string;
      name: string;
      restaurants: { name: string } | null;
    } | null;

    if (!dish || items.has(dish.id)) continue;

    items.set(dish.id, {
      id: dish.id,
      entryId: row.id,
      name: dish.name,
      subtitle: dish.restaurants?.name ?? null,
      rating: Number(row.rating),
      linkId: dish.id,
    });
  }

  return Array.from(items.values());
}

// A user's latest score for each restaurant (brand) they've rated.
export async function fetchLatestRestaurantScores(
  userId: string
): Promise<ScoredItem[]> {
  const { data, error } = await supabase
    .from('restaurant_ratings')
    .select(`
      id,
      rating,
      restaurant_id,
      brand_id,
      restaurants (
        id,
        name,
        brand_id
      )
    `)
    .eq('user_id', userId)
    .not('rating', 'is', null)
    .order('visited_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    rating: number;
    restaurant_id: string | null;
    brand_id: string | null;
    restaurants: { id: string; name: string; brand_id: string | null } | null;
  };

  const rows = (data ?? []) as unknown as Row[];

  // A restaurant is its brand, like the restaurant page. The first row per
  // brand is the latest visit with a score.
  const latest = new Map<string, Row>();

  for (const row of rows) {
    const key = row.brand_id ?? row.restaurants?.brand_id ?? row.restaurant_id;
    if (key && !latest.has(key)) latest.set(key, row);
  }

  const brandIds = Array.from(latest.entries())
    .filter(([, row]) => row.brand_id ?? row.restaurants?.brand_id)
    .map(([key]) => key);

  const brandNames = new Map<string, string>();
  // Brand-wide visits have no location, so link to any of the brand's.
  const brandLocations = new Map<string, string>();

  if (brandIds.length > 0) {
    const [brandsResult, locationsResult] = await Promise.all([
      supabase.from('brands').select('id, name').in('id', brandIds),
      supabase.from('restaurants').select('id, brand_id').in('brand_id', brandIds),
    ]);

    if (brandsResult.error) throw new Error(brandsResult.error.message);
    if (locationsResult.error) throw new Error(locationsResult.error.message);

    for (const brand of brandsResult.data ?? []) {
      brandNames.set(brand.id, brand.name);
    }

    for (const location of locationsResult.data ?? []) {
      if (location.brand_id && !brandLocations.has(location.brand_id)) {
        brandLocations.set(location.brand_id, location.id);
      }
    }
  }

  const items: ScoredItem[] = [];

  for (const [key, row] of latest) {
    const linkId = row.restaurant_id ?? brandLocations.get(key);
    const name = brandNames.get(key) ?? row.restaurants?.name;

    if (!linkId || !name) continue;

    items.push({
      id: key,
      entryId: row.id,
      name,
      subtitle: null,
      rating: Number(row.rating),
      linkId,
    });
  }

  return items;
}
