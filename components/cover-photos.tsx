import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export type CoverPhoto = {
  review_id: string;
  photo_path: string;
  // Set for a restaurant photo added without a review; opens that photo.
  place_photo_id?: string;
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
};

export function CoverPhotos({ photos }: CoverPhotosProps) {
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);

  // No photos yet: no cover at all, just the page's text.
  if (photos.length === 0) {
    return null;
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
            key={photo.place_photo_id ?? photo.review_id}
            activeOpacity={0.9}
            onPress={() =>
              photo.place_photo_id
                ? router.push({
                    pathname: '/restaurant-photo/[id]',
                    params: { id: photo.place_photo_id },
                  })
                : router.push({
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
              key={photo.place_photo_id ?? photo.review_id}
              style={[styles.dot, index === activeIndex && styles.activeDot]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
