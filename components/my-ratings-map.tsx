import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MapRestaurant, RestaurantMap } from '@/components/restaurant-map';
import { Palette } from '@/constants/theme';
import { fetchLatestRestaurantScores } from '@/lib/ratings';
import { supabase } from '@/lib/supabase';

type Location = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  brand_id: string | null;
  brands: { name: string } | null;
};

// Every location the user has been to (rated a visit or logged a dish at)
// with a restaurant rating, pinned with that rating. The rating is their
// latest score for the restaurant, a chain counting as one, like the ratings
// chart.
async function fetchMyRatedLocations(userId: string) {
  const [scores, visits, reviews] = await Promise.all([
    fetchLatestRestaurantScores(userId),
    supabase
      .from('restaurant_ratings')
      .select('restaurant_id')
      .eq('user_id', userId)
      .not('restaurant_id', 'is', null),
    supabase
      .from('reviews')
      .select('dishes (restaurant_id)')
      .eq('user_id', userId),
  ]);

  if (visits.error) throw new Error(visits.error.message);
  if (reviews.error) throw new Error(reviews.error.message);

  const scoreByKey = new Map(scores.map((item) => [item.id, item.rating]));

  const locationIds = new Set<string>();
  for (const row of visits.data ?? []) {
    locationIds.add(row.restaurant_id as string);
  }
  for (const row of reviews.data ?? []) {
    const dish = row.dishes as unknown as { restaurant_id: string } | null;
    if (dish) locationIds.add(dish.restaurant_id);
  }

  if (locationIds.size === 0) return [];

  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, city, state, latitude, longitude, brand_id, brands (name)')
    .in('id', [...locationIds])
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Location[]).flatMap<MapRestaurant>(
    (location) => {
      const rating = scoreByKey.get(location.brand_id ?? location.id);
      if (rating === undefined) return [];

      return [
        {
          id: location.id,
          name: location.brands?.name ?? location.name,
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          rating,
          subtitle: [location.city, location.state].filter(Boolean).join(', '),
          meta: 'Your rating',
          photoPath: null,
        },
      ];
    }
  );
}

export function MyRatingsMap({ userId }: { userId: string }) {
  const [locations, setLocations] = useState<MapRestaurant[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      fetchMyRatedLocations(userId)
        .then((result) => {
          if (active) setLocations(result);
        })
        .catch((error) => console.log('My ratings map error:', error));

      return () => {
        active = false;
      };
    }, [userId])
  );

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Your Map</Text>
      <Text style={styles.subtitle}>
        {locations && locations.length > 0
          ? `${locations.length} ${locations.length === 1 ? 'place' : 'places'} you’ve rated`
          : 'Rate restaurants and they’ll show up here.'}
      </Text>

      {locations && locations.length > 0 ? (
        <View style={styles.map}>
          {/* Keyed by count so it re-fits when places are added. */}
          <RestaurantMap
            key={locations.length}
            restaurants={locations}
            userLocation={null}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 32,
  },
  title: {
    color: Palette.text,
    fontSize: 21,
    fontWeight: '700',
  },
  subtitle: {
    color: Palette.textMuted,
    fontSize: 14,
    marginTop: 2,
  },
  map: {
    height: 320,
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Palette.border,
  },
});
