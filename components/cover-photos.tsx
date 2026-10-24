import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export type CoverPhoto = {
  review_id: string;
  photo_path: string;
};

const COVER_HEIGHT = 220;

// Best review photos for these dishes, chosen by the cover_photos() SQL
// function (likes, rating, recency; a pinned review first).
export async function fetchCoverPhotos(
  dishIds: string[],
  pinnedReviewId: string | null
) {
  if (dishIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase.rpc('cover_photos', {
    p_dish_ids: dishIds,
    p_pinned_review_id: pinnedReviewId,
  });

  if (error) {
    console.log('Cover photos error:', error.message);
    return [];
  }

  return (data ?? []) as CoverPhoto[];
}

type CoverPhotosProps = {
  photos: CoverPhoto[];
  title: string;
};

export function CoverPhotos({ photos, title }: CoverPhotosProps) {
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <View style={styles.fallback}>
        <View style={styles.fallbackGlow} />

        <Text style={styles.fallbackInitial}>
          {title.trim().charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }

  function handleScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setActiveIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {photos.map((photo) => (
          <TouchableOpacity
            key={photo.review_id}
            activeOpacity={0.9}
            onPress={() =>
              router.push({
                pathname: '/review/[id]',
                params: { id: photo.review_id },
              })
            }
          >
            <Image
              source={{
                uri: supabase.storage
                  .from('review-photos')
                  .getPublicUrl(photo.photo_path).data.publicUrl,
              }}
              style={{ width, height: COVER_HEIGHT }}
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {photos.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {photos.map((photo, index) => (
            <View
              key={photo.review_id}
              style={[styles.dot, index === activeIndex && styles.activeDot]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    width: '100%',
    height: COVER_HEIGHT,
    backgroundColor: '#2A1A14',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fallbackGlow: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    top: -150,
    right: -110,
    backgroundColor: Palette.accent,
    opacity: 0.35,
  },
  fallbackInitial: {
    color: Palette.text,
    fontSize: 84,
    fontWeight: '800',
    opacity: 0.9,
  },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  activeDot: {
    backgroundColor: Palette.text,
  },
});
