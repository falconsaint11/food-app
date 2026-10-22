import { supabase } from '@/lib/supabase';

// Each `restaurants` row is one physical location. Locations sharing a
// brand_id are the same restaurant publicly, so profile pages pool their
// dishes and reviews.
export async function getBrandLocationIds(
  restaurantId: string,
  brandId: string | null
) {
  if (!brandId) {
    return [restaurantId];
  }

  const { data, error } = await supabase
    .from('restaurants')
    .select('id')
    .eq('brand_id', brandId);

  if (error) {
    throw new Error(error.message);
  }

  const ids = (data ?? []).map((row) => row.id as string);

  return ids.length > 0 ? ids : [restaurantId];
}

// Dishes are stored per location, so "Big Mac" at two McDonald's are two rows.
export function dishKey(name: string) {
  return name.trim().toLowerCase();
}
