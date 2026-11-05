import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ContentMenu } from '@/components/content-menu';
import { reviewPhotoUrl } from '@/components/photo-card-row';
import { Palette } from '@/constants/theme';
import { useIsAdmin, useIsCurator } from '@/lib/admin';
import { supabase } from '@/lib/supabase';

type Photo = {
  id: string;
  user_id: string;
  photo_path: string;
  kind: 'place' | 'menu';
  created_at: string;
  restaurant_id: string;
  restaurants: {
    name: string;
    brand_id: string | null;
    cover_photo_id: string | null;
    brands: { name: string; cover_photo_id: string | null } | null;
  } | null;
};

type Author = { username: string; display_name: string | null };

// One photo of a restaurant added without a review: who added it, and
// Report/Block, or Delete for the person who added it (and admins).
// Curators and admins can pin it as the restaurant's cover.
export default function RestaurantPhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isAdmin = useIsAdmin();
  const isCurator = useIsCurator();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [author, setAuthor] = useState<Author | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pinning, setPinning] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const [{ data, error }, { data: auth }] = await Promise.all([
        supabase
          .from('restaurant_photos')
          .select(
            'id, user_id, photo_path, kind, created_at, restaurant_id, restaurants (name, brand_id, cover_photo_id, brands (name, cover_photo_id))'
          )
          .eq('id', id)
          .maybeSingle(),
        supabase.auth.getUser(),
      ]);

      if (!active) return;

      if (error) console.log('Restaurant photo error:', error.message);

      const row = (data as unknown as Photo | null) ?? null;
      setPhoto(row);
      setMyUserId(auth.user?.id ?? null);
      // The cover is the brand's, or the location's when it has no brand.
      const place = row?.restaurants;
      setPinned(
        Boolean(row) &&
          (place?.brand_id
            ? place.brands?.cover_photo_id
            : place?.cover_photo_id) === row?.id
      );

      if (row) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, display_name')
          .eq('id', row.user_id)
          .maybeSingle();

        if (active) setAuthor(profile);
      }

      if (active) setLoading(false);
    }

    load();

    return () => {
      active = false;
    };
  }, [id]);

  function confirmDelete() {
    Alert.alert('Delete this photo?', 'It will be removed from the restaurant.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: deletePhoto },
    ]);
  }

  async function togglePin() {
    if (!photo) return;

    setPinning(true);

    const { error } = await supabase.rpc('pin_restaurant_photo', {
      p_photo_id: photo.id,
      p_pin: !pinned,
    });

    setPinning(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setPinned(!pinned);
  }

  async function deletePhoto() {
    if (!photo) return;

    setDeleting(true);

    const { error } = await supabase
      .from('restaurant_photos')
      .delete()
      .eq('id', photo.id);

    if (error) {
      setDeleting(false);
      Alert.alert('Error', error.message);
      return;
    }

    // Only the uploader can remove the file itself.
    if (photo.user_id === myUserId) {
      await supabase.storage.from('review-photos').remove([photo.photo_path]);
    }

    router.back();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Palette.accent} />
      </View>
    );
  }

  if (!photo) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>This photo was removed.</Text>
      </View>
    );
  }

  const restaurantName =
    photo.restaurants?.brands?.name ?? photo.restaurants?.name ?? 'Restaurant';
  const authorName = author?.display_name || author?.username || 'Someone';
  const isMine = photo.user_id === myUserId;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: photo.kind === 'menu' ? `${restaurantName} menu` : restaurantName,
        }}
      />

      <Image
        source={{ uri: reviewPhotoUrl(photo.photo_path) }}
        style={styles.image}
        contentFit="contain"
        transition={150}
      />

      {isCurator ? (
        <TouchableOpacity
          style={[styles.pinButton, pinned && styles.pinButtonOn]}
          onPress={togglePin}
          disabled={pinning}
        >
          <Text style={styles.pinText}>
            {pinning
              ? 'Saving…'
              : pinned
                ? '📌 Restaurant cover · Unpin'
                : '📌 Pin as restaurant cover'}
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.footerInfo}>
          <TouchableOpacity
            onPress={() =>
              isMine
                ? router.push('/profile')
                : router.push({
                    pathname: '/user/[id]',
                    params: { id: photo.user_id },
                  })
            }
          >
            <Text style={styles.author}>Added by {authorName}</Text>
          </TouchableOpacity>
          <Text style={styles.muted}>
            {new Date(photo.created_at).toLocaleDateString()}
          </Text>
        </View>

        {isMine || isAdmin ? (
          <TouchableOpacity onPress={confirmDelete} disabled={deleting}>
            <Text style={styles.delete}>{deleting ? 'Deleting…' : 'Delete'}</Text>
          </TouchableOpacity>
        ) : null}

        <ContentMenu
          targetType="restaurant_photo"
          targetId={photo.id}
          authorId={photo.user_id}
          authorName={authorName}
          onBlocked={() => router.back()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.background,
  },
  image: {
    flex: 1,
  },
  pinButton: {
    alignSelf: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: Palette.accent,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pinButtonOn: {
    backgroundColor: Palette.accent,
  },
  pinText: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  footerInfo: {
    flex: 1,
  },
  author: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '600',
  },
  muted: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  delete: {
    color: Palette.danger,
    fontSize: 15,
    fontWeight: '600',
  },
});
