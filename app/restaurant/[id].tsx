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

import { supabase } from '@/lib/supabase';

type Restaurant = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
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

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [dishes, setDishes] = useState<DishSummary[]>([]);
  const [reviews, setReviews] = useState<RecentReview[]>([]);
  const [averageRating, setAverageRating] = useState(0);
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

    const { data: restaurantData, error: restaurantError } =
      await supabase
        .from('restaurants')
        .select('id, name, city, state, country')
        .eq('id', id)
        .maybeSingle();

    if (restaurantError) {
      setLoading(false);
      Alert.alert('Restaurant error', restaurantError.message);
      return;
    }

    if (!restaurantData) {
      setRestaurant(null);
      setLoading(false);
      return;
    }

    setRestaurant(restaurantData);

    const { data: dishData, error: dishError } = await supabase
      .from('dishes')
      .select('id, name')
      .eq('restaurant_id', id);

    if (dishError) {
      setLoading(false);
      Alert.alert('Dish error', dishError.message);
      return;
    }

    const dishIds = (dishData ?? []).map((dish) => dish.id);

    if (dishIds.length === 0) {
      setDishes([]);
      setReviews([]);
      setAverageRating(0);
      setLoading(false);
      return;
    }

    const { data: reviewData, error: reviewError } = await supabase
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
      .order('created_at', { ascending: false });

    setLoading(false);

    if (reviewError) {
      Alert.alert('Review error', reviewError.message);
      return;
    }

    const allReviews = (reviewData ?? []) as any[];

    if (allReviews.length > 0) {
      const total = allReviews.reduce(
        (sum, review) => sum + Number(review.rating),
        0
      );

      setAverageRating(total / allReviews.length);
    } else {
      setAverageRating(0);
    }

    const dishSummaries: DishSummary[] = (dishData ?? []).map((dish) => {
      const dishReviews = allReviews.filter(
        (review) => review.dish_id === dish.id
      );

      const dishAverage =
        dishReviews.length > 0
          ? dishReviews.reduce(
              (sum, review) => sum + Number(review.rating),
              0
            ) / dishReviews.length
          : 0;

      return {
        id: dish.id,
        name: dish.name,
        averageRating: dishAverage,
        reviewCount: dishReviews.length,
      };
    });

    dishSummaries.sort((a, b) => {
      if (b.averageRating !== a.averageRating) {
        return b.averageRating - a.averageRating;
      }

      return b.reviewCount - a.reviewCount;
    });

    setDishes(dishSummaries);
    setReviews(allReviews.slice(0, 10) as unknown as RecentReview[]);
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

  const location = [
    restaurant.city,
    restaurant.state,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{restaurant.name}</Text>

      {location ? (
        <Text style={styles.location}>{location}</Text>
      ) : null}

      <View style={styles.ratingCard}>
        <Text style={styles.ratingNumber}>
          {averageRating > 0 ? averageRating.toFixed(1) : '—'} ★
        </Text>

        <Text style={styles.ratingLabel}>
          {reviews.length}{' '}
          {reviews.length === 1 ? 'review' : 'reviews'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dishes</Text>

        {dishes.length === 0 ? (
          <Text style={styles.emptyText}>
            No dishes logged yet.
          </Text>
        ) : (
          dishes.map((dish) => (
            <View key={dish.id} style={styles.dishRow}>
              <View style={styles.dishInfo}>
                <Text style={styles.dishName}>
                  {dish.name}
                </Text>

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
            </View>
          ))
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 50,
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  notFound: {
    fontSize: 16,
    color: '#666666',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  location: {
    fontSize: 16,
    color: '#666666',
    marginTop: 6,
  },
  ratingCard: {
    marginTop: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 14,
    alignItems: 'center',
  },
  ratingNumber: {
    fontSize: 28,
    fontWeight: '700',
  },
  ratingLabel: {
    fontSize: 14,
    color: '#777777',
    marginTop: 4,
  },
  section: {
    marginTop: 30,
  },
  sectionTitle: {
    fontSize: 21,
    fontWeight: '700',
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 15,
    color: '#777777',
  },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  dishInfo: {
    flex: 1,
    paddingRight: 16,
  },
  dishName: {
    fontSize: 17,
    fontWeight: '600',
  },
  dishSubtext: {
    fontSize: 13,
    color: '#777777',
    marginTop: 3,
  },
  dishRating: {
    fontSize: 16,
    fontWeight: '700',
  },
  reviewCard: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
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
    fontSize: 15,
    fontWeight: '700',
  },
  reviewDish: {
    fontSize: 14,
    color: '#666666',
    marginTop: 3,
  },
  reviewRating: {
    fontSize: 16,
    fontWeight: '700',
  },
  reviewText: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 9,
  },
});