import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';

type RestaurantOption = {
  id: string;
  name: string;
  city: string | null;
};

type SavedRanking = {
  restaurant_id: string;
  rank: number;
};

export default function RankRestaurantsScreen() {
  const [restaurants, setRestaurants] = useState<RestaurantOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadRestaurants();
    }, [])
  );

  async function loadRestaurants() {
    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);
      Alert.alert('Error', 'No signed-in user found.');
      return;
    }

    const { data: reviewData, error: reviewError } = await supabase
      .from('reviews')
      .select(`
        dishes (
          restaurants (
            id,
            name,
            city
          )
        )
      `)
      .eq('user_id', user.id);

    if (reviewError) {
      setLoading(false);
      Alert.alert('Error', reviewError.message);
      return;
    }

    const uniqueMap = new Map<string, RestaurantOption>();

    for (const row of reviewData ?? []) {
      const restaurant =
        (row.dishes as any)?.restaurants as RestaurantOption | null;

      if (restaurant) {
        uniqueMap.set(restaurant.id, restaurant);
      }
    }

    setRestaurants(Array.from(uniqueMap.values()));

    const { data: rankingData, error: rankingError } = await supabase
      .from('restaurant_rankings')
      .select('restaurant_id, rank')
      .eq('user_id', user.id)
      .order('rank', { ascending: true });

    setLoading(false);

    if (rankingError) {
      Alert.alert('Ranking error', rankingError.message);
      return;
    }

    const savedRankings = (rankingData ?? []) as SavedRanking[];

    setSelected(
      savedRankings.map((item) => item.restaurant_id)
    );
  }

  function toggleRestaurant(id: string) {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.filter((restaurantId) => restaurantId !== id);
      }

      if (current.length >= 4) {
        Alert.alert('Top 4 only', 'Choose up to 4 restaurants for now.');
        return current;
      }

      return [...current, id];
    });
  }

  async function saveRankings() {
    if (selected.length === 0) {
      Alert.alert(
        'No restaurants selected',
        'Choose at least one restaurant.'
      );
      return;
    }

    setSaving(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSaving(false);
      Alert.alert('Error', 'No signed-in user found.');
      return;
    }

    const { error: deleteError } = await supabase
      .from('restaurant_rankings')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      setSaving(false);
      Alert.alert('Error', deleteError.message);
      return;
    }

    const rows = selected.map((restaurantId, index) => ({
      user_id: user.id,
      restaurant_id: restaurantId,
      rank: index + 1,
    }));

    const { error: insertError } = await supabase
      .from('restaurant_rankings')
      .insert(rows);

    setSaving(false);

    if (insertError) {
      Alert.alert('Error', insertError.message);
      return;
    }

    Alert.alert('Saved', 'Your top restaurants were updated.');
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Rank Top Restaurants</Text>

      <Text style={styles.subtitle}>
        Tap restaurants in the order you want them ranked.
      </Text>

      {selected.length > 0 ? (
        <View style={styles.selectedBox}>
          <Text style={styles.selectedTitle}>Your ranking</Text>

          {selected.map((id, index) => {
            const restaurant = restaurants.find(
              (item) => item.id === id
            );

            return (
              <Text key={id} style={styles.selectedItem}>
                {index + 1}.{' '}
                {restaurant?.name ?? 'Unknown restaurant'}
              </Text>
            );
          })}
        </View>
      ) : null}

      {restaurants.map((restaurant) => {
        const rankIndex = selected.indexOf(restaurant.id);

        return (
          <TouchableOpacity
            key={restaurant.id}
            style={[
              styles.restaurantCard,
              rankIndex !== -1 &&
                styles.restaurantCardSelected,
            ]}
            onPress={() => toggleRestaurant(restaurant.id)}
          >
            <View style={styles.restaurantInfo}>
              <Text style={styles.restaurantName}>
                {restaurant.name}
              </Text>

              {restaurant.city ? (
                <Text style={styles.city}>
                  {restaurant.city}
                </Text>
              ) : null}
            </View>

            {rankIndex !== -1 ? (
              <Text style={styles.rankNumber}>
                #{rankIndex + 1}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity
        style={styles.button}
        onPress={saveRankings}
        disabled={saving}
      >
        <Text style={styles.buttonText}>
          {saving ? 'Saving...' : 'Save Rankings'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 40,
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginTop: 6,
    marginBottom: 24,
  },
  selectedBox: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 12,
    marginBottom: 20,
  },
  selectedTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  selectedItem: {
    fontSize: 15,
    marginTop: 4,
  },
  restaurantCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  restaurantCardSelected: {
    backgroundColor: '#f7f7f7',
  },
  restaurantInfo: {
    flex: 1,
    paddingRight: 16,
  },
  restaurantName: {
    fontSize: 17,
    fontWeight: '600',
  },
  city: {
    fontSize: 14,
    color: '#666666',
    marginTop: 3,
  },
  rankNumber: {
    fontSize: 17,
    fontWeight: '700',
  },
  button: {
    backgroundColor: '#111111',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});