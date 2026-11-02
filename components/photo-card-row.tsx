import { Image } from 'expo-image';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export type PhotoCard = {
  key: string;
  title: string;
  subtitle?: string;
  rating?: number | null;
  // Shown after the rating ("12 reviews", "0.8 mi").
  meta?: string;
  photoPath?: string | null;
  // Small label over the photo's corner ("#1", "New").
  badge?: string;
  onPress: () => void;
};

const SIZES = {
  large: { width: 260, height: 160 },
  medium: { width: 150, height: 120 },
};

export function reviewPhotoUrl(path: string) {
  return supabase.storage.from('review-photos').getPublicUrl(path).data
    .publicUrl;
}

// A sideways row of photo cards. Cards without a photo show the title's
// first letter.
export function PhotoCardRow({
  cards,
  size = 'medium',
}: {
  cards: PhotoCard[];
  size?: keyof typeof SIZES;
}) {
  const { width, height } = SIZES[size];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      decelerationRate="fast"
      snapToInterval={width + 12}
    >
      {cards.map((card) => (
        <TouchableOpacity
          key={card.key}
          style={{ width }}
          activeOpacity={0.8}
          onPress={card.onPress}
        >
          <View style={[styles.photo, { width, height }]}>
            {card.photoPath ? (
              <Image
                source={{ uri: reviewPhotoUrl(card.photoPath) }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <Text style={styles.initial}>
                {card.title.trim().charAt(0).toUpperCase()}
              </Text>
            )}

            {card.badge ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{card.badge}</Text>
              </View>
            ) : null}
          </View>

          <Text
            style={[styles.title, size === 'large' && styles.titleLarge]}
            numberOfLines={size === 'large' ? 1 : 2}
          >
            {card.title}
          </Text>

          {card.subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {card.subtitle}
            </Text>
          ) : null}

          {card.rating || card.meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {card.rating ? (
                <Text style={styles.rating}>{card.rating.toFixed(1)} ★</Text>
              ) : null}
              {card.rating && card.meta ? '  ·  ' : ''}
              {card.meta ?? ''}
            </Text>
          ) : null}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 12,
    paddingHorizontal: 20,
  },
  photo: {
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
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: Palette.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: Palette.text,
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
    lineHeight: 19,
  },
  titleLarge: {
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: Palette.textSecondary,
    fontSize: 13,
    marginTop: 2,
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
