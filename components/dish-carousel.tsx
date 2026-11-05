import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { formatAverage } from '@/lib/ratings';
import { supabase } from '@/lib/supabase';

export type CarouselDish = {
  id: string;
  name: string;
  averageRating: number;
  reviewCount: number;
  photoPath: string | null;
  tried: boolean;
  // The viewer's own latest rating, shown instead of the average with
  // showMine.
  myRating?: number | null;
};

const CARD_WIDTH = 150;

// A sideways row of ranked dish cards with their best review photo.
export function DishCarousel({
  dishes,
  showMine = false,
}: {
  dishes: CarouselDish[];
  showMine?: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      decelerationRate="fast"
      snapToInterval={CARD_WIDTH + 12}
    >
      {dishes.map((dish, index) => (
        <TouchableOpacity
          key={dish.id}
          style={styles.card}
          activeOpacity={0.8}
          onPress={() =>
            router.push({ pathname: '/dish/[id]', params: { id: dish.id } })
          }
        >
          <View style={styles.photo}>
            {dish.photoPath ? (
              <Image
                source={{
                  uri: supabase.storage
                    .from('review-photos')
                    .getPublicUrl(dish.photoPath).data.publicUrl,
                }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <Text style={styles.initial}>
                {dish.name.trim().charAt(0).toUpperCase()}
              </Text>
            )}

            <View style={styles.rankBadge}>
              <Text style={styles.rankText}>#{index + 1}</Text>
            </View>

            {dish.tried && !showMine ? (
              <View style={styles.triedBadge}>
                <Text style={styles.triedText}>✓</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.name} numberOfLines={2}>
            {dish.name}
          </Text>

          {showMine ? (
            <Text style={styles.meta} numberOfLines={1}>
              <Text style={styles.rating}>
                {(dish.myRating ?? 0).toFixed(1)} ★
              </Text>
              {'  ·  Your rating'}
            </Text>
          ) : (
            <Text style={styles.meta} numberOfLines={1}>
              <Text style={styles.rating}>{formatAverage(dish.averageRating)} ★</Text>
              {`  ·  ${dish.reviewCount} ${dish.reviewCount === 1 ? 'review' : 'reviews'}`}
            </Text>
          )}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 12,
    paddingHorizontal: 24,
  },
  card: {
    width: CARD_WIDTH,
  },
  photo: {
    width: CARD_WIDTH,
    height: 120,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: Palette.borderStrong,
    fontSize: 44,
    fontWeight: '800',
  },
  rankBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: Palette.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rankText: {
    color: Palette.text,
    fontSize: 11,
    fontWeight: '700',
  },
  triedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  triedText: {
    color: Palette.text,
    fontSize: 12,
    fontWeight: '800',
  },
  name: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
    lineHeight: 19,
  },
  meta: {
    color: Palette.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  rating: {
    color: Palette.accent,
    fontWeight: '700',
  },
});
