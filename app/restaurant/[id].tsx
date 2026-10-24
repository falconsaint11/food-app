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
import { RateRestaurantButton } from '@/components/rate-restaurant-button';
import {
  getBrandLocationIds,
  getBrandLocationsNearestFirst,
} from '@/lib/brands';
import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

type Restaurant = {
  id: string;
  name: string;
  brand_id: string | null;
  brands: {
    name: string;
    cover_review_id: string | null;
  } | null;
};

type DishSummary = {
  id: string;
  name: string;
  averageRating: number;
  reviewCount: number;
};

type RecentReview = {
  id: string;
  user_id: string;
  dish_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  profiles: {
    username: string;
    display_name: string | null;
  } | null;
  dishes: {
    id: string;
    name: string;
  } | null;
};

const TOP_ITEM_COUNT = 3;

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [dishes, setDishes] = useState<DishSummary[]>([]);
  const [reviews, setReviews] = useState<RecentReview[]>([]);
  const [coverPhotos, setCoverPhotos] = useState<CoverPhoto[]>([]);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadRestaurant();
    }, [id])
  );

  async function loadRestaurant() {
    if (!id) {
      return;
    }

    setLoading(true);

    try {
      const { data: restaurantData, error: restaurantError } = await supabase
        .from('restaurants')
        .select('id, name, brand_id, brands (name, cover_review_id)')
        .eq('id', id)
        .maybeSingle();

      if (restaurantError) throw new Error(restaurantError.message);

      if (!restaurantData) {
        setRestaurant(null);
        return;
      }

      const restaurantRow = restaurantData as unknown as Restaurant;
      setRestaurant(restaurantRow);

      // Pool every location of this brand into one public profile.
      const locationIds = await getBrandLocationIds(
        restaurantRow.id,
        restaurantRow.brand_id
      );

      const { data: ratingData, error: ratingError } = await supabase
        .from('restaurant_ratings')
        .select('user_id, rating')
        .in('restaurant_id', locationIds);

      if (ratingError) throw new Error(ratingError.message);

      // Average each person's ratings first so someone who rated five
      // locations counts the same as someone who rated one.
      const ratingsByUser = new Map<string, number[]>();
      for (const row of ratingData ?? []) {
        ratingsByUser.set(row.user_id, [
          ...(ratingsByUser.get(row.user_id) ?? []),
          Number(row.rating),
        ]);
      }

      const perUserAverages = [...ratingsByUser.values()].map(
        (ratings) =>
          ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
      );

      setRatingCount(perUserAverages.length);
      setRestaurantRating(
        perUserAverages.length > 0
          ? perUserAverages.reduce((sum, rating) => sum + rating, 0) /
              perUserAverages.length
          : 0
      );

      const { data: dishData, error: dishError } = await supabase
        .from('dishes')
        .select('id, name, name_key')
        .in('restaurant_id', locationIds);

      if (dishError) throw new Error(dishError.message);

      const dishIds = (dishData ?? []).map((dish) => dish.id as string);

      setCoverPhotos(
        await fetchCoverPhotos(
          dishIds,
          restaurantRow.brands?.cover_review_id ?? null
        )
      );

      const { data: reviewData, error: reviewError } =
        dishIds.length > 0
          ? await supabase
              .from('reviews')
              .select(`
                id,
                user_id,
                dish_id,
                rating,
                review_text,
                created_at,
                profiles:user_id (
                  username,
                  display_name
                ),
                dishes (
                  id,
                  name
                )
              `)
              .in('dish_id', dishIds)
              .order('created_at', { ascending: false })
          : { data: [], error: null };

      if (reviewError) throw new Error(reviewError.message);

      const allReviews = (reviewData ?? []) as unknown as RecentReview[];

      const ratingsByDishId = new Map<string, number[]>();
      for (const review of allReviews) {
        ratingsByDishId.set(review.dish_id, [
          ...(ratingsByDishId.get(review.dish_id) ?? []),
          Number(review.rating),
        ]);
      }

      // Merge same-named dishes from different locations into one menu item.
      // The most-reviewed row is the one the menu links to.
      const groups = new Map<
        string,
        { id: string; name: string; topCount: number; ratings: number[] }
      >();

      for (const dish of dishData ?? []) {
        const ratings = ratingsByDishId.get(dish.id) ?? [];
        const key = dish.name_key as string;
        const group = groups.get(key);

        if (!group) {
          groups.set(key, {
            id: dish.id,
            name: dish.name.trim(),
            topCount: ratings.length,
            ratings: [...ratings],
          });
          continue;
        }

        group.ratings.push(...ratings);
        if (ratings.length > group.topCount) {
          group.id = dish.id;
          group.topCount = ratings.length;
        }
      }

      const dishSummaries: DishSummary[] = [...groups.values()].map(
        (group) => ({
          id: group.id,
          name: group.name,
          reviewCount: group.ratings.length,
          averageRating:
            group.ratings.length > 0
              ? group.ratings.reduce((sum, rating) => sum + rating, 0) /
                group.ratings.length
              : 0,
        })
      );

      dishSummaries.sort((a, b) => a.name.localeCompare(b.name));

      setDishes(dishSummaries);
      setReviews(allReviews.slice(0, 10));
    } catch (error) {
      Alert.alert(
        'Restaurant error',
        error instanceof Error ? error.message : 'Could not load restaurant.'
      );
    } finally {
      setLoading(false);
    }
  }

  // Open the Log tab at the user's nearest location of this restaurant.
  async function logDishHere() {
    if (!restaurant) {
      return;
    }

    try {
      const [nearest] = await getBrandLocationsNearestFirst(
        restaurant.id,
        restaurant.brand_id
      );

      router.navigate({
        pathname: '/(tabs)/log',
        params: { restaurantId: nearest?.id ?? restaurant.id },
      });
    } catch (error) {
      Alert.alert(
        'Restaurant error',
        error instanceof Error ? error.message : 'Could not open the log.'
      );
    }
  }

  function renderDishRow(dish: DishSummary) {
    return (
      <TouchableOpacity
        key={dish.id}
        style={styles.dishRow}
        onPress={() =>
          router.push({
            pathname: '/dish/[id]',
            params: { id: dish.id },
          })
        }
      >
        <View style={styles.dishInfo}>
          <Text style={styles.dishName}>{dish.name}</Text>

          <Text style={styles.dishSubtext}>
            {dish.reviewCount}{' '}
            {dish.reviewCount === 1 ? 'review' : 'reviews'}
          </Text>
        </View>

        <Text style={styles.dishRating}>
          {dish.averageRating > 0
            ? `${dish.averageRating.toFixed(1)} ★`
            : '—'}
        </Text>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!restaurant) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>
          Restaurant not found.
        </Text>
      </View>
    );
  }

  const topItems = dishes
    .filter((dish) => dish.reviewCount > 0)
    .sort((a, b) => {
      if (b.averageRating !== a.averageRating) {
        return b.averageRating - a.averageRating;
      }

      return b.reviewCount - a.reviewCount;
    })
    .slice(0, TOP_ITEM_COUNT);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
    >
      <CoverPhotos
        photos={coverPhotos}
        title={restaurant.brands?.name ?? restaurant.name}
      />

      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerInfo}>
            <Text style={styles.title}>
              {restaurant.brands?.name ?? restaurant.name}
            </Text>
          </View>

          <View style={styles.headerRating}>
            <Text style={styles.ratingNumber}>
              {restaurantRating > 0 ? restaurantRating.toFixed(1) : '—'} ★
            </Text>

            <Text style={styles.ratingLabel}>
              {ratingCount > 0 ? 'Restaurant rating' : 'No ratings yet'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <RateRestaurantButton
            restaurantId={restaurant.id}
            brandId={restaurant.brand_id}
            restaurantName={restaurant.brands?.name ?? restaurant.name}
            onSaved={loadRestaurant}
            style={styles.actionButton}
          />

          <TouchableOpacity style={styles.actionButton} onPress={logDishHere}>
            <Text style={styles.actionButtonText} numberOfLines={1}>
              + Log a dish
            </Text>
          </TouchableOpacity>

          <AddToListButton
            listType="restaurant"
            targetId={restaurant.id}
            style={styles.actionButton}
          />
        </View>

        {topItems.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Items</Text>

            {topItems.map(renderDishRow)}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Menu</Text>

          {dishes.length === 0 ? (
            <Text style={styles.emptyText}>
              No dishes logged yet.
            </Text>
          ) : (
            dishes.map(renderDishRow)
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Reviews</Text>

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
                  <View style={styles.reviewInfo}>
                    <Text style={styles.reviewer}>
                      {review.profiles?.display_name ||
                        review.profiles?.username ||
                        'User'}
                    </Text>

                    <Text style={styles.reviewDish}>
                      {review.dishes?.name ?? 'Unknown dish'}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerInfo: {
    flex: 1,
    paddingRight: 16,
  },
  headerRating: {
    alignItems: 'flex-end',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  ratingNumber: {
    color: Palette.accent,
    fontSize: 26,
    fontWeight: '700',
  },
  ratingLabel: {
    fontSize: 14,
    color: Palette.textMuted,
    marginTop: 4,
  },
  // Equal-width buttons sharing one row, so they line up on any screen.
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
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  dishInfo: {
    flex: 1,
    paddingRight: 16,
  },
  dishName: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '600',
  },
  dishSubtext: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 3,
  },
  dishRating: {
    color: Palette.accent,
    fontSize: 16,
    fontWeight: '700',
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
  reviewInfo: {
    flex: 1,
    paddingRight: 16,
  },
  reviewer: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  reviewDish: {
    fontSize: 14,
    color: Palette.textSecondary,
    marginTop: 3,
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