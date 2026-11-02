import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';

import { reviewPhotoUrl } from '@/components/photo-card-row';
import { Palette } from '@/constants/theme';

export type MapRestaurant = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  // Shown on the pin.
  rating: number;
  subtitle: string;
  // Shown after the rating on the card ("12 reviews", "Your rating").
  meta: string;
  photoPath: string | null;
};

type Props = {
  restaurants: MapRestaurant[];
  userLocation: { latitude: number; longitude: number } | null;
};

// Starts on the user when we know where they are, otherwise fits every
// restaurant on screen.
function startRegion(
  restaurants: MapRestaurant[],
  userLocation: Props['userLocation']
): Region {
  if (userLocation) {
    return { ...userLocation, latitudeDelta: 0.12, longitudeDelta: 0.12 };
  }

  if (restaurants.length === 0) {
    // The continental US.
    return {
      latitude: 39.5,
      longitude: -98.35,
      latitudeDelta: 40,
      longitudeDelta: 40,
    };
  }

  const latitudes = restaurants.map((restaurant) => restaurant.latitude);
  const longitudes = restaurants.map((restaurant) => restaurant.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.05),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.05),
  };
}

// Restaurants as rating pins. Tapping one shows a card that opens the
// restaurant.
export function RestaurantMap({ restaurants, userLocation }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [region] = useState(() => startRegion(restaurants, userLocation));
  const selected = restaurants.find((restaurant) => restaurant.id === selectedId);

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        showsUserLocation={userLocation !== null}
        userInterfaceStyle="dark"
        onPress={() => setSelectedId(null)}
      >
        {restaurants.map((restaurant) => {
          const isSelected = restaurant.id === selectedId;

          return (
            <Marker
              key={restaurant.id}
              coordinate={{
                latitude: restaurant.latitude,
                longitude: restaurant.longitude,
              }}
              onPress={(event) => {
                event.stopPropagation();
                setSelectedId(restaurant.id);
              }}
              // Redraw only while the pin's look changes.
              tracksViewChanges={isSelected}
              zIndex={isSelected ? 1 : 0}
            >
              <View style={[styles.pin, isSelected && styles.pinSelected]}>
                <Text style={styles.pinText}>
                  {restaurant.rating.toFixed(1)}★
                </Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {restaurants.length === 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            No rated restaurants on the map yet.
          </Text>
        </View>
      ) : null}

      {selected ? (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.9}
          onPress={() =>
            router.push({
              pathname: '/restaurant/[id]',
              params: { id: selected.id },
            })
          }
        >
          <View style={styles.cardPhoto}>
            {selected.photoPath ? (
              <Image
                source={{ uri: reviewPhotoUrl(selected.photoPath) }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : (
              <Text style={styles.cardInitial}>
                {selected.name.charAt(0).toUpperCase()}
              </Text>
            )}
          </View>

          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {selected.name}
            </Text>
            {selected.subtitle ? (
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {selected.subtitle}
              </Text>
            ) : null}
            <Text style={styles.cardMeta}>
              <Text style={styles.cardRating}>
                {selected.rating.toFixed(1)} ★
              </Text>
              {`  ·  ${selected.meta}`}
            </Text>
          </View>

          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  pin: {
    backgroundColor: Palette.surface,
    borderColor: Palette.accent,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  pinSelected: {
    backgroundColor: Palette.accent,
    borderColor: Palette.text,
    transform: [{ scale: 1.15 }],
  },
  pinText: {
    color: Palette.text,
    fontSize: 12,
    fontWeight: '800',
  },
  notice: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: Palette.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  noticeText: {
    color: Palette.textSecondary,
    fontSize: 14,
  },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 16,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  cardPhoto: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Palette.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInitial: {
    color: Palette.textMuted,
    fontSize: 26,
    fontWeight: '800',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: Palette.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  cardMeta: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  cardRating: {
    color: Palette.accent,
    fontWeight: '700',
  },
  chevron: {
    color: Palette.textMuted,
    fontSize: 24,
    paddingRight: 4,
  },
});
