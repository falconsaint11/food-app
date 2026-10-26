import { PickOption, TopPicksEditor } from '@/components/top-picks-editor';
import { supabase } from '@/lib/supabase';

type LocationRow = {
  id: string;
  name: string;
  city: string | null;
  brand_id: string | null;
};

// Every restaurant the user reviewed a dish at or rated, plus their saved
// top 4. Restaurants are grouped by brand, so Chipotle shows up once however
// many Chipotles they've been to; places without a brand are their location.
async function loadRestaurantOptions(userId: string) {
  const [reviewsResult, ratingsResult, rankingsResult] = await Promise.all([
    supabase
      .from('reviews')
      .select(`
        dishes (
          restaurants (
            id,
            name,
            city,
            brand_id
          )
        )
      `)
      .eq('user_id', userId),
    supabase
      .from('restaurant_ratings')
      .select(`
        brand_id,
        restaurants (
          id,
          name,
          city,
          brand_id
        )
      `)
      .eq('user_id', userId),
    supabase
      .from('restaurant_rankings')
      .select(`
        rank,
        restaurants (
          id,
          name,
          city,
          brand_id
        )
      `)
      .eq('user_id', userId)
      .order('rank', { ascending: true }),
  ]);

  if (reviewsResult.error) throw new Error(reviewsResult.error.message);
  if (ratingsResult.error) throw new Error(ratingsResult.error.message);
  if (rankingsResult.error) throw new Error(rankingsResult.error.message);

  // One location per brand (or per unbranded place). Ranked locations go
  // first so re-saving keeps the location that was already saved.
  const locations = new Map<string, LocationRow>();
  const selectedKeys: string[] = [];
  // Brand-wide ratings have no location yet.
  const brandOnlyIds = new Set<string>();

  function addLocation(location: LocationRow | null) {
    if (!location) return null;

    const key = location.brand_id ?? location.id;
    if (!locations.has(key)) locations.set(key, location);

    return key;
  }

  for (const row of rankingsResult.data ?? []) {
    const key = addLocation(row.restaurants as unknown as LocationRow | null);
    if (key && !selectedKeys.includes(key)) selectedKeys.push(key);
  }

  for (const row of reviewsResult.data ?? []) {
    const dish = row.dishes as unknown as {
      restaurants: LocationRow | null;
    } | null;
    addLocation(dish?.restaurants ?? null);
  }

  for (const row of ratingsResult.data ?? []) {
    if (row.brand_id) {
      brandOnlyIds.add(row.brand_id);
    } else {
      addLocation(row.restaurants as unknown as LocationRow | null);
    }
  }

  const missingBrandIds = [...brandOnlyIds].filter((id) => !locations.has(id));
  const brandIds = [
    ...new Set([
      ...missingBrandIds,
      ...[...locations.values()]
        .map((location) => location.brand_id)
        .filter((id): id is string => Boolean(id)),
    ]),
  ];

  const brandNames = new Map<string, string>();

  if (brandIds.length > 0) {
    const [brandsResult, brandLocationsResult] = await Promise.all([
      supabase.from('brands').select('id, name').in('id', brandIds),
      missingBrandIds.length > 0
        ? supabase
            .from('restaurants')
            .select('id, name, city, brand_id')
            .in('brand_id', missingBrandIds)
        : Promise.resolve({ data: [] as LocationRow[], error: null }),
    ]);

    if (brandsResult.error) throw new Error(brandsResult.error.message);
    if (brandLocationsResult.error) {
      throw new Error(brandLocationsResult.error.message);
    }

    for (const brand of brandsResult.data ?? []) {
      brandNames.set(brand.id, brand.name);
    }

    for (const location of brandLocationsResult.data ?? []) {
      addLocation(location);
    }
  }

  const options: PickOption[] = [...locations.entries()].map(
    ([key, location]) => ({
      key,
      saveId: location.id,
      name:
        (location.brand_id && brandNames.get(location.brand_id)) ||
        location.name,
      subtitle: location.city,
    })
  );

  return { options, selectedKeys };
}

export default function RankRestaurantsScreen() {
  return (
    <TopPicksEditor
      noun="restaurants"
      rankingTable="restaurant_rankings"
      idColumn="restaurant_id"
      loadOptions={loadRestaurantOptions}
    />
  );
}
