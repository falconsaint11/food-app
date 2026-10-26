import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import {
  fetchLatestDishScores,
  fetchLatestRestaurantScores,
  formatRating,
  ScoredItem,
  toStarLevel,
  useIsPremium,
} from '@/lib/ratings';

// Everything a user rated at one half-star level, opened from a bar in
// RatingsChart. Exact scores belong to the level they round to (4.25 to 4.74
// is 4.5), best first, so Premium members see their order within the level.
export default function RatingsScreen() {
  const { userId, kind, level } = useLocalSearchParams<{
    userId: string;
    kind: 'dish' | 'restaurant';
    level: string;
  }>();
  const isPremium = useIsPremium();
  const [items, setItems] = useState<ScoredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const starLevel = Number(level);
  const noun = kind === 'dish' ? 'Dishes' : 'Restaurants';

  useEffect(() => {
    if (!userId) return;

    let active = true;

    (kind === 'dish'
      ? fetchLatestDishScores(userId)
      : fetchLatestRestaurantScores(userId)
    )
      .then((allItems) => {
        if (!active) return;

        setItems(
          allItems
            .filter((item) => toStarLevel(item.rating) === starLevel)
            .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
        );
      })
      .catch((error) => {
        if (active) setErrorMessage(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId, kind, starLevel]);

  function openItem(item: ScoredItem) {
    if (kind === 'dish') {
      router.push({ pathname: '/dish/[id]', params: { id: item.linkId } });
    } else {
      router.push({ pathname: '/restaurant/[id]', params: { id: item.linkId } });
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${starLevel}★ ${noun}` }} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Palette.accent} />
        </View>
      ) : errorMessage ? (
        <Text style={styles.emptyText}>{errorMessage}</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Nothing rated {starLevel}★.</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openItem(item)}>
              <View style={styles.rowInfo}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                {item.subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.rating}>
                {formatRating(item.rating, isPremium)}★
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  centered: {
    paddingTop: 60,
    alignItems: 'center',
  },
  list: {
    padding: 24,
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  rowInfo: {
    flex: 1,
    paddingRight: 16,
  },
  name: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: Palette.textSecondary,
    marginTop: 3,
  },
  rating: {
    color: Palette.accent,
    fontSize: 17,
    fontWeight: '700',
  },
  emptyText: {
    color: Palette.textSecondary,
    fontSize: 15,
    padding: 24,
  },
});
