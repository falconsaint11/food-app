import * as Location from 'expo-location';

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

export type BrandLocation = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function describeLocation(location: BrandLocation) {
  return (
    location.address ||
    [location.city, location.state].filter(Boolean).join(', ') ||
    location.name
  );
}

// The brand's saved locations, nearest to the user first so ratings and logs
// default to where they probably are. Without location permission (we never
// prompt here), the location the page was opened from comes first.
export async function getBrandLocationsNearestFirst(
  restaurantId: string,
  brandId: string | null
) {
  const query = supabase
    .from('restaurants')
    .select('id, name, address, city, state, latitude, longitude');

  const { data, error } = brandId
    ? await query.eq('brand_id', brandId)
    : await query.eq('id', restaurantId);

  if (error) {
    throw new Error(error.message);
  }

  const locations = (data ?? []) as BrandLocation[];

  let here: { latitude: number; longitude: number } | null = null;

  try {
    const permission = await Location.getForegroundPermissionsAsync();

    if (permission.granted) {
      const position =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }));

      here = position.coords;
    }
  } catch (locationError) {
    console.log('Could not get location for nearest restaurant:', locationError);
  }

  function distance(location: BrandLocation) {
    if (!here) {
      return location.id === restaurantId ? 0 : 1;
    }

    if (location.latitude === null || location.longitude === null) {
      return Number.MAX_VALUE;
    }

    // Equirectangular approximation; plenty for ordering nearby places.
    const x =
      (Number(location.longitude) - here.longitude) *
      Math.cos((here.latitude * Math.PI) / 180);
    const y = Number(location.latitude) - here.latitude;

    return x * x + y * y;
  }

  return locations.sort((a, b) => distance(a) - distance(b));
}
