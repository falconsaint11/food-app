import { Image } from 'expo-image';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Palette } from '@/constants/theme';

type PhotoEntry = {
  photo_path: string | null;
  dishes: {
    id: string;
    restaurants: { id: string; brand_id: string | null } | null;
  } | null;
};

// The newest photo the user took of each dish and at each restaurant, from
// their reviews (expected newest first). Restaurants are keyed by brand, so
// a ranked Chipotle shows a photo from any Chipotle; places without a brand
// use their location id.
export function latestPhotoPaths(entries: PhotoEntry[]) {
  const byDish = new Map<string, string>();
  const byRestaurant = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.photo_path || !entry.dishes) continue;

    if (!byDish.has(entry.dishes.id)) {
      byDish.set(entry.dishes.id, entry.photo_path);
    }

    const restaurant = entry.dishes.restaurants;
    const restaurantId = restaurant?.brand_id ?? restaurant?.id;

    if (restaurantId && !byRestaurant.has(restaurantId)) {
      byRestaurant.set(restaurantId, entry.photo_path);
    }
  }

  return { byDish, byRestaurant };
}

type TopPickCardProps = {
  rank: number;
  title: string;
  subtitle: string;
  photoUrl: string | null;
  onPress: () => void;
};

// One of a profile's top 4 dishes or restaurants. The user's own photo fills
// the card when they have one, darkened so the rank and text stay readable.
export function TopPickCard({
  rank,
  title,
  subtitle,
  photoUrl,
  onPress,
}: TopPickCardProps) {
  return (
    <TouchableOpacity
      style={[styles.card, photoUrl ? styles.cardWithPhoto : null]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      {photoUrl ? (
        <>
          <Image
            source={{ uri: photoUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
          />
          <View style={styles.shade} />
        </>
      ) : null}

      <View style={styles.rankBadge}>
        <Text style={styles.rankBadgeText}>#{rank}</Text>
      </View>

      <View>
        <Text
          style={[styles.title, photoUrl ? styles.textOnPhoto : null]}
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text
          style={[styles.subtitle, photoUrl ? styles.subtitleOnPhoto : null]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 120,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    padding: 8,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  cardWithPhoto: {
    borderColor: 'transparent',
  },
  shade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  rankBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Palette.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rankBadgeText: {
    color: Palette.text,
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    color: Palette.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  subtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 3,
  },
  textOnPhoto: {
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitleOnPhoto: {
    color: Palette.textBody,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
