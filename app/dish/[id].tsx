import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { AddToListButton } from '@/components/add-to-list-button';
import {
  CoverPhoto,
  CoverPhotos,
  fetchCoverPhotos,
} from '@/components/cover-photos';
import {
  getBrandLocationIds,
  getBrandLocationsNearestFirst,
} from '@/lib/brands';
import { withoutHiddenUsers } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';
import { fetchDishPublicTags, Tag } from '@/lib/tags';
import { Palette } from '@/constants/theme';

type Dish = {
  id: string;
  name: string;
  name_key: string;
  cover_review_id: string | null;
  category: string | null;
  price: number | null;
  restaurants: {
    id: string;
    name: string;
    brand_id: string | null;
    brands: {
      name: string;
    } | null;
  } | null;
};

type DishReview = {
  id: string;
  user_id: string;
  rating: number;
  review_text: string | null;
  date_eaten: string;
  created_at: string;
  profiles: {
    username: string;
    display_name: string | null;
  } | null;
};

export default function DishDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [dish, setDish] = useState<Dish | null>(null);
  const [reviews, setReviews] = useState<DishReview[]>([]);
  const [coverPhotos, setCoverPhotos] = useState<CoverPhoto[]>([]);
  const [dishTags, setDishTags] = useState<Tag[]>([]);
  const [averageRating, setAverageRating] = useState(0);
  const [rankingCount, setRankingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadDish();
    }, [id])
  );

  async function loadDish() {
    if (!id) {
      return;
    }

    setLoading(true);

    const { data: dishData, error: dishError } = await supabase
      .from('dishes')
      .select(`
        id,
        name,
        name_key,
        cover_review_id,
        category,
        price,
        restaurants (
          id,
          name,
          brand_id,
          brands (name)
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (dishError) {
      setLoading(false);
      Alert.alert('Dish error', dishError.message);
      return;
    }

    if (!dishData) {
      setDish(null);
      setLoading(false);
      return;
    }

    const dishRow = dishData as unknown as Dish;
    setDish(dishRow);

    // The same dish at other locations of this brand counts as one dish.
    let sameDishIds = [dishRow.id];
    // A cover pinned on this dish at any location of the brand.
    let pinnedReviewId = dishRow.cover_review_id;

    if (dishRow.restaurants) {
      try {
        const locationIds = await getBrandLocationIds(
          dishRow.restaurants.id,
          dishRow.restaurants.brand_id
        );

        const { data: siblingData, error: siblingError } = await supabase
          .from('dishes')
          .select('id, name_key, cover_review_id')
          .in('restaurant_id', locationIds);

        if (siblingError) throw new Error(siblingError.message);

        const sameDishes = (siblingData ?? []).filter(
          (sibling) => sibling.name_key === dishRow.name_key
        );

        sameDishIds = sameDishes.map((sibling) => sibling.id as string);
        pinnedReviewId =
          pinnedReviewId ??
          sameDishes.find((sibling) => sibling.cover_review_id)
            ?.cover_review_id ??
          null;
      } catch (error) {
        setLoading(false);
        Alert.alert(
          'Dish error',
          error instanceof Error ? error.message : 'Could not load this dish.'
        );
        return;
      }
    }

    setCoverPhotos(await fetchCoverPhotos(sameDishIds, pinnedReviewId));
    setDishTags(await fetchDishPublicTags(sameDishIds));

    const { data: reviewData, error: reviewError } = await supabase
      .from('reviews')
      .select(`
        id,
        user_id,
        rating,
        review_text,
        date_eaten,
        created_at,
        profiles:user_id (
          username,
          display_name
        )
      `)
      .in('dish_id', sameDishIds)
      .order('created_at', { ascending: false });

    if (reviewError) {
      setLoading(false);
      Alert.alert('Review error', reviewError.message);
      return;
    }

    const typedReviews =
      (reviewData ?? []) as unknown as DishReview[];

    // Blocked people's ratings still count toward the average; only their
    // reviews are hidden.
    setReviews(
      await withoutHiddenUsers(typedReviews, (review) => review.user_id)
    );

    if (typedReviews.length > 0) {
      const total = typedReviews.reduce(
        (sum, review) => sum + Number(review.rating),
        0
      );

      setAverageRating(total / typedReviews.length);
    } else {
      setAverageRating(0);
    }

    const { count, error: rankingError } = await supabase
      .from('dish_rankings')
      .select('*', { count: 'exact', head: true })
      .in('dish_id', sameDishIds);

    setLoading(false);

    if (rankingError) {
      Alert.alert('Ranking error', rankingError.message);
      return;
    }

    setRankingCount(count ?? 0);
  }

  // Open the Log tab with this dish at the user's nearest location of the
  // restaurant, so they only have to add stars.
  async function rateDish() {
    if (!dish?.restaurants) {
      return;
    }

    try {
      const [nearest] = await getBrandLocationsNearestFirst(
        dish.restaurants.id,
        dish.restaurants.brand_id
      );

      router.navigate({
        pathname: '/(tabs)/log',
        params: {
          restaurantId: nearest?.id ?? dish.restaurants.id,
          dishName: dish.name,
        },
      });
    } catch (error) {
      Alert.alert(
        'Dish error',
        error instanceof Error ? error.message : 'Could not open the log.'
      );
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!dish) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>
          Dish not found.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
    >
      <CoverPhotos photos={coverPhotos} title={dish.name} />

      <View style={styles.container}>
        <Text style={styles.title}>
          {dish.name}
        </Text>

        {dish.restaurants ? (
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: '/restaurant/[id]',
                params: { id: dish.restaurants!.id },
              })
            }
          >
            <Text style={styles.restaurantLink}>
              {dish.restaurants.brands?.name ?? dish.restaurants.name}
            </Text>
          </TouchableOpacity>
        ) : null}

        {dishTags.length > 0 ? (
          <View style={styles.tagRow}>
            {dishTags.map((tag) => (
              <View key={tag.slug} style={styles.tag}>
                <Text style={styles.tagText}>{tag.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          {dish.restaurants ? (
            <TouchableOpacity style={styles.actionButton} onPress={rateDish}>
              <Text style={styles.actionButtonText} numberOfLines={1}>
                ★ Rate this dish
              </Text>
            </TouchableOpacity>
          ) : null}

          <AddToListButton
            listType="dish"
            targetId={dish.id}
            style={styles.actionButton}
          />
        </View>

        <View style={styles.statsCard}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>
              {averageRating > 0
                ? averageRating.toFixed(1)
                : '—'}{' '}
              ★
            </Text>

            <Text style={styles.statLabel}>
              Average rating
            </Text>
          </View>

          <View style={styles.statDivider} />

          <View style={styles.stat}>
            <Text style={styles.statNumber}>
              {reviews.length}
            </Text>

            <Text style={styles.statLabel}>
              {reviews.length === 1 ? 'Review' : 'Reviews'}
            </Text>
          </View>

          <View style={styles.statDivider} />

          <View style={styles.stat}>
            <Text style={styles.statNumber}>
              {rankingCount}
            </Text>

            <Text style={styles.statLabel}>
              Top lists
            </Text>
          </View>
        </View>

        {dish.category || dish.price !== null ? (
          <View style={styles.details}>
            {dish.category ? (
              <Text style={styles.detailText}>
                Category: {dish.category}
              </Text>
            ) : null}

            {dish.price !== null ? (
              <Text style={styles.detailText}>
                Price: ${Number(dish.price).toFixed(2)}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Reviews
          </Text>

          {reviews.length === 0 ? (
            <Text style={styles.emptyText}>
              No reviews yet.
            </Text>
          ) : (
            reviews.map((review) => (
              <TouchableOpacity
                key={review.id}
                style={styles.reviewCard}
                onPress={() =>
                  router.push({
                    pathname: '/review/[id]',
                    params: { id: review.id },
                  })
                }
              >
                <View style={styles.reviewTopRow}>
                  <View style={styles.reviewerInfo}>
                    <Text style={styles.reviewer}>
                      {review.profiles?.display_name ||
                        review.profiles?.username ||
                        'User'}
                    </Text>

                    <Text style={styles.handle}>
                      @{review.profiles?.username ?? 'unknown'}
                    </Text>
                  </View>

                  <Text style={styles.reviewRating}>
                    {review.rating}★
                  </Text>
                </View>

                {review.review_text ? (
                  <Text
                    style={styles.reviewText}
                    numberOfLines={3}
                  >
                    {review.review_text}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 50,
  },
  container: {
    padding: 24,
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
  title: {
    color: Palette.text,
    fontSize: 30,
    fontWeight: '700',
  },
  restaurantLink: {
    fontSize: 16,
    color: Palette.textSecondary,
    fontWeight: '600',
    marginTop: 6,
  },
  // Equal-width buttons sharing one row, so they line up on any screen.
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: Palette.elevated,
  },
  tagText: {
    color: Palette.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
  },
  actionButtonText: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '600',
  },
  statsCard: {
    flexDirection: 'row',
    marginTop: 24,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    color: Palette.text,
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: Palette.elevated,
  },
  details: {
    marginTop: 18,
  },
  detailText: {
    fontSize: 14,
    color: Palette.textSecondary,
    marginTop: 4,
  },
  section: {
    marginTop: 30,
  },
  sectionTitle: {
    color: Palette.text,
    fontSize: 21,
    fontWeight: '700',
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 15,
    color: Palette.textMuted,
  },
  reviewCard: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  reviewTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reviewerInfo: {
    flex: 1,
    paddingRight: 16,
  },
  reviewer: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  handle: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 2,
  },
  reviewRating: {
    color: Palette.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  reviewText: {
    color: Palette.text,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 9,
  },
});