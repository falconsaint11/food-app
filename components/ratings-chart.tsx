import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Palette } from '@/constants/theme';
import {
  fetchLatestDishScores,
  fetchLatestRestaurantScores,
  toStarLevel,
} from '@/lib/ratings';

type RatingsChartProps = {
  userId: string;
};

type Kind = 'dish' | 'restaurant';

// 0.5 to 5 in half steps.
const STAR_LEVELS = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

const BAR_AREA_HEIGHT = 72;

// Letterboxd-style bar chart of how a user rates: one bar per half-star,
// counting each dish or restaurant once at its latest score. Exact scores
// count toward the half-star they round to (4.37 is a 4.5). Tapping a bar
// lists everything at that level.
export function RatingsChart({ userId }: RatingsChartProps) {
  const [kind, setKind] = useState<Kind>('dish');
  const [counts, setCounts] = useState<number[]>([]);

  const loadCounts = useCallback(async () => {
    try {
      const items =
        kind === 'dish'
          ? await fetchLatestDishScores(userId)
          : await fetchLatestRestaurantScores(userId);

      const nextCounts = STAR_LEVELS.map(() => 0);

      for (const item of items) {
        const index = STAR_LEVELS.indexOf(toStarLevel(item.rating));
        if (index !== -1) nextCounts[index] += 1;
      }

      setCounts(nextCounts);
    } catch (error) {
      console.log('Ratings chart error:', error);
    }
  }, [kind, userId]);

  useFocusEffect(
    useCallback(() => {
      loadCounts();
    }, [loadCounts])
  );

  const total = counts.reduce((sum, count) => sum + count, 0);
  const most = Math.max(1, ...counts);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Ratings</Text>
        <Text style={styles.total}>
          {total} {kind === 'dish' ? 'dishes' : 'restaurants'}
        </Text>
      </View>

      <View style={styles.toggle}>
        {(['dish', 'restaurant'] as const).map((option) => (
          <TouchableOpacity
            key={option}
            style={[
              styles.toggleButton,
              kind === option && styles.toggleButtonActive,
            ]}
            onPress={() => setKind(option)}
          >
            <Text
              style={[
                styles.toggleText,
                kind === option && styles.toggleTextActive,
              ]}
            >
              {option === 'dish' ? 'Dishes' : 'Restaurants'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {total === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No ratings yet.</Text>
        </View>
      ) : (
        <View style={styles.chartRow}>
          <Text style={styles.axisStar}>★</Text>

          <View style={styles.bars}>
            {STAR_LEVELS.map((level, index) => {
              const count = counts[index] ?? 0;

              return (
                <TouchableOpacity
                  key={level}
                  style={styles.barSlot}
                  disabled={count === 0}
                  onPress={() =>
                    router.push({
                      pathname: '/ratings',
                      params: { userId, kind, level: String(level) },
                    })
                  }
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        height:
                          count === 0
                            ? 2
                            : Math.max(6, (count / most) * BAR_AREA_HEIGHT),
                      },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.axisStar}>★★★★★</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: Palette.text,
    fontSize: 21,
    fontWeight: '700',
  },
  total: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: Palette.surface,
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: Palette.elevated,
  },
  toggleText: {
    color: Palette.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: Palette.text,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  axisStar: {
    color: Palette.accent,
    fontSize: 11,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BAR_AREA_HEIGHT,
    gap: 3,
  },
  barSlot: {
    flex: 1,
    height: BAR_AREA_HEIGHT,
    justifyContent: 'flex-end',
  },
  bar: {
    backgroundColor: Palette.textMuted,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  emptyCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: Palette.surface,
  },
  emptyText: {
    color: Palette.textSecondary,
    fontSize: 15,
  },
});
