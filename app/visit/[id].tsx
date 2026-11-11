import { useHeaderHeight } from '@react-navigation/elements';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import {
  CommentBar,
  CommentThreads,
  LikeBar,
  RESTAURANT_RATING_COMMENTS,
  useComments,
} from '@/components/comments';
import { ContentMenu } from '@/components/content-menu';
import { Palette } from '@/constants/theme';
import { withFlag } from '@/lib/countries';
import { fetchHiddenUserIds } from '@/lib/moderation';
import { formatRating, useIsPremium } from '@/lib/ratings';
import { supabase } from '@/lib/supabase';

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
};

type Visit = {
  id: string;
  user_id: string;
  rating: number | null;
  notes: string | null;
  visited_at: string;
  photo_path: string | null;
  // A location to open; brand-wide ratings link to any of the brand's.
  restaurantId: string | null;
  restaurantName: string;
  city: string | null;
  countryCode: string | null;
};

// One restaurant rating, as a post: photo, notes, who came along, likes and
// comments.
export default function VisitScreen() {
  const isPremium = useIsPremium();
  const { id } = useLocalSearchParams<{ id: string }>();
  const headerHeight = useHeaderHeight();

  const [loading, setLoading] = useState(true);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [author, setAuthor] = useState<Profile | null>(null);
  const [tagged, setTagged] = useState<Profile[]>([]);
  const [likeUserIds, setLikeUserIds] = useState<string[]>([]);
  const [likeSaving, setLikeSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const comments = useComments(RESTAURANT_RATING_COMMENTS, id, currentUserId);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])
  );

  async function load() {
    if (!id) return;

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    setCurrentUserId(user?.id ?? null);

    const { data, error } = await supabase
      .from('restaurant_ratings')
      .select(
        `
        id,
        user_id,
        rating,
        notes,
        visited_at,
        photo_path,
        restaurant_id,
        brand_id,
        restaurants (id, name, city, country_code, brands (name))
      `
      )
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      setVisit(null);
      setLoading(false);
      if (error) Alert.alert('Rating error', error.message);
      return;
    }

    type Row = {
      id: string;
      user_id: string;
      rating: number | null;
      notes: string | null;
      visited_at: string;
      photo_path: string | null;
      restaurant_id: string | null;
      brand_id: string | null;
      restaurants: {
        id: string;
        name: string;
        city: string | null;
        country_code: string | null;
        brands: { name: string } | null;
      } | null;
    };

    const row = data as unknown as Row;

    if ((await fetchHiddenUserIds()).has(row.user_id)) {
      setVisit(null);
      setLoading(false);
      return;
    }

    let restaurantId = row.restaurant_id;
    let restaurantName =
      row.restaurants?.brands?.name ?? row.restaurants?.name ?? '';
    let countryCode = row.restaurants?.country_code ?? null;

    if (!restaurantId && row.brand_id) {
      const [{ data: brand }, { data: location }] = await Promise.all([
        supabase.from('brands').select('name').eq('id', row.brand_id).single(),
        supabase
          .from('restaurants')
          .select('id, country_code')
          .eq('brand_id', row.brand_id)
          .limit(1)
          .maybeSingle(),
      ]);

      restaurantName = brand?.name ?? '';
      restaurantId = location?.id ?? null;
      countryCode = location?.country_code ?? null;
    }

    setVisit({
      id: row.id,
      user_id: row.user_id,
      rating: row.rating === null ? null : Number(row.rating),
      notes: row.notes?.trim() || null,
      visited_at: row.visited_at,
      photo_path: row.photo_path,
      restaurantId,
      restaurantName,
      city: row.restaurant_id ? (row.restaurants?.city ?? null) : null,
      countryCode,
    });

    const [{ data: tagRows }, { data: likeRows }] = await Promise.all([
      supabase
        .from('restaurant_rating_tags')
        .select('tagged_user_id')
        .eq('restaurant_rating_id', id),
      supabase
        .from('restaurant_rating_likes')
        .select('user_id')
        .eq('restaurant_rating_id', id),
    ]);

    const taggedIds = (tagRows ?? []).map((tag) => tag.tagged_user_id);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_path')
      .in('id', [row.user_id, ...taggedIds]);

    const byId = new Map(
      ((profiles ?? []) as Profile[]).map((profile) => [profile.id, profile])
    );

    setAuthor(byId.get(row.user_id) ?? null);
    setTagged(taggedIds.flatMap((tagId) => byId.get(tagId) ?? []));
    setLikeUserIds((likeRows ?? []).map((like) => like.user_id));

    const commentError = await comments.load();
    if (commentError) Alert.alert('Comment error', commentError);

    setLoading(false);
  }

  const liked = !!currentUserId && likeUserIds.includes(currentUserId);

  async function toggleLike() {
    if (!id || !currentUserId || likeSaving) return;

    setLikeSaving(true);

    const { error } = liked
      ? await supabase
          .from('restaurant_rating_likes')
          .delete()
          .eq('restaurant_rating_id', id)
          .eq('user_id', currentUserId)
      : await supabase
          .from('restaurant_rating_likes')
          .insert({ restaurant_rating_id: id, user_id: currentUserId });

    setLikeSaving(false);

    if (error) {
      Alert.alert('Like error', error.message);
      return;
    }

    setLikeUserIds((current) =>
      liked
        ? current.filter((userId) => userId !== currentUserId)
        : [...current, currentUserId]
    );
  }

  async function deleteVisit() {
    if (!visit) return;

    const { error } = await supabase
      .from('restaurant_ratings')
      .delete()
      .eq('id', visit.id);

    if (error) {
      Alert.alert('Delete error', error.message);
      return;
    }

    if (visit.photo_path) {
      await supabase.storage.from('review-photos').remove([visit.photo_path]);
    }

    router.back();
  }

  function confirmDelete() {
    Alert.alert(
      'Delete rating?',
      'This removes the rating, its photo, likes and comments.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteVisit },
      ]
    );
  }

  function openProfile(userId: string) {
    if (userId === currentUserId) {
      router.push('/profile');
    } else {
      router.push(`/user/${userId}`);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!visit) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>This rating isn’t available.</Text>
      </View>
    );
  }

  const isOwn = visit.user_id === currentUserId;
  const authorName = author?.display_name || author?.username || 'User';
  const photoUrl = visit.photo_path
    ? supabase.storage.from('review-photos').getPublicUrl(visit.photo_path)
        .data.publicUrl
    : null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.userHeader}>
          <TouchableOpacity
            style={styles.userRow}
            onPress={() => openProfile(visit.user_id)}
          >
            <Avatar
              path={author?.avatar_path}
              name={authorName}
              size={48}
              marginRight={14}
            />
            <View style={styles.userInfo}>
              <Text style={styles.userName}>
                {authorName}
                {isOwn ? ' · You' : ''}
              </Text>
              <Text style={styles.userHandle}>
                @{author?.username ?? 'unknown'}
              </Text>
            </View>
          </TouchableOpacity>

          <ContentMenu
            targetType="restaurant_note"
            targetId={visit.id}
            authorId={visit.user_id}
            authorName={authorName}
            onBlocked={() => router.back()}
            actions={
              isOwn
                ? [
                    {
                      label: 'Delete rating',
                      destructive: true,
                      onPress: confirmDelete,
                    },
                  ]
                : []
            }
          />
        </View>

        <View style={styles.titleRow}>
          <View style={styles.titleInfo}>
            <Text style={styles.label}>Rated the restaurant</Text>
            <TouchableOpacity
              disabled={!visit.restaurantId}
              onPress={() =>
                router.push({
                  pathname: '/restaurant/[id]',
                  params: { id: visit.restaurantId! },
                })
              }
            >
              <Text style={styles.restaurantName}>
                {withFlag(visit.restaurantName, visit.countryCode)}
              </Text>
            </TouchableOpacity>
            {visit.city ? <Text style={styles.city}>{visit.city}</Text> : null}
          </View>

          {visit.rating !== null ? (
            <Text style={styles.rating}>
              {formatRating(visit.rating, isPremium)}★
            </Text>
          ) : null}
        </View>

        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            resizeMode="cover"
          />
        ) : null}

        {visit.notes ? <Text style={styles.notes}>{visit.notes}</Text> : null}

        {tagged.length > 0 ? (
          <View style={styles.taggedRow}>
            <Text style={styles.taggedLabel}>Went with </Text>
            {tagged.map((friend, index) => (
              <TouchableOpacity
                key={friend.id}
                onPress={() => openProfile(friend.id)}
              >
                <Text style={styles.taggedLink}>
                  @{friend.username}
                  {index < tagged.length - 1 ? ', ' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Text style={styles.date}>
          Visited{' '}
          {new Date(visit.visited_at).toLocaleDateString(undefined, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>

        <LikeBar
          liked={liked}
          likeCount={likeUserIds.length}
          commentCount={comments.comments.length}
          onToggle={toggleLike}
          disabled={likeSaving}
        />

        <CommentThreads state={comments} postAuthorId={visit.user_id} />
      </ScrollView>

      <CommentBar state={comments} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 60,
    backgroundColor: Palette.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Palette.background,
  },
  notFound: {
    fontSize: 16,
    color: Palette.textSecondary,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  userRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '700',
  },
  userHandle: {
    fontSize: 14,
    color: Palette.accent,
    marginTop: 2,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleInfo: {
    flex: 1,
    paddingRight: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textMuted,
    marginBottom: 4,
  },
  restaurantName: {
    color: Palette.text,
    fontSize: 24,
    fontWeight: '700',
  },
  city: {
    fontSize: 15,
    color: Palette.textSecondary,
    marginTop: 5,
  },
  rating: {
    color: Palette.accent,
    fontSize: 22,
    fontWeight: '700',
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    marginTop: 20,
    backgroundColor: Palette.elevated,
  },
  notes: {
    color: Palette.text,
    fontSize: 17,
    lineHeight: 25,
    marginTop: 22,
  },
  taggedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 18,
  },
  taggedLabel: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  taggedLink: {
    fontSize: 14,
    color: Palette.accent,
    fontWeight: '700',
  },
  date: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 20,
  },
});
