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

type DishOption = {
  id: string;
  name: string;
  restaurants: {
    name: string;
  } | null;
};

export default function RankDishesScreen() {
  const [dishes, setDishes] = useState<DishOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadDishes();
    }, [])
  );

  async function loadDishes() {
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

    const { data, error } = await supabase
      .from('reviews')
      .select(`
        dish_id,
        dishes (
          id,
          name,
          restaurants (
            name
          )
        )
      `)
      .eq('user_id', user.id);

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    const uniqueMap = new Map<string, DishOption>();

    for (const row of data ?? []) {
      const dish = row.dishes as unknown as DishOption | null;

      if (dish) {
        uniqueMap.set(dish.id, dish);
      }
    }

    setDishes(Array.from(uniqueMap.values()));
  }

  function toggleDish(id: string) {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.filter((dishId) => dishId !== id);
      }

      if (current.length >= 4) {
        Alert.alert('Top 4 only', 'Choose up to 4 dishes for now.');
        return current;
      }

      return [...current, id];
    });
  }

  async function saveRankings() {
    if (selected.length === 0) {
      Alert.alert('No dishes selected', 'Choose at least one dish.');
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
      .from('dish_rankings')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      setSaving(false);
      Alert.alert('Error', deleteError.message);
      return;
    }

    const rows = selected.map((dishId, index) => ({
      user_id: user.id,
      dish_id: dishId,
      rank: index + 1,
    }));

    const { error: insertError } = await supabase
      .from('dish_rankings')
      .insert(rows);

    setSaving(false);

    if (insertError) {
      Alert.alert('Error', insertError.message);
      return;
    }

    Alert.alert('Saved', 'Your top dishes were updated.');
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
      <Text style={styles.title}>Rank Top Dishes</Text>
      <Text style={styles.subtitle}>
        Tap dishes in the order you want them ranked.
      </Text>

      {selected.length > 0 ? (
        <View style={styles.selectedBox}>
          <Text style={styles.selectedTitle}>Your ranking</Text>

          {selected.map((id, index) => {
            const dish = dishes.find((item) => item.id === id);

            return (
              <Text key={id} style={styles.selectedItem}>
                {index + 1}. {dish?.name ?? 'Unknown dish'}
              </Text>
            );
          })}
        </View>
      ) : null}

      {dishes.map((dish) => {
        const rankIndex = selected.indexOf(dish.id);

        return (
          <TouchableOpacity
            key={dish.id}
            style={[
              styles.dishCard,
              rankIndex !== -1 && styles.dishCardSelected,
            ]}
            onPress={() => toggleDish(dish.id)}
          >
            <View style={styles.dishInfo}>
              <Text style={styles.dishName}>{dish.name}</Text>
              <Text style={styles.restaurantName}>
                {dish.restaurants?.name ?? 'Unknown restaurant'}
              </Text>
            </View>

            {rankIndex !== -1 ? (
              <Text style={styles.rankNumber}>#{rankIndex + 1}</Text>
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
  dishCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  dishCardSelected: {
    backgroundColor: '#f7f7f7',
  },
  dishInfo: {
    flex: 1,
    paddingRight: 16,
  },
  dishName: {
    fontSize: 17,
    fontWeight: '600',
  },
  restaurantName: {
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