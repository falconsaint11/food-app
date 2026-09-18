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

type Dish = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  restaurants: {
    id: string;
    name: string;
    city: string | null;
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
        category,
        price,
        restaurants (
          id,
          name,
          city
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

    setDish(dishData as unknown as Dish);

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
      .eq('dish_id', id)
      .order('created_at', { ascending: false });

    if (reviewError) {
      setLoading(false);
      Alert.alert('Review error', reviewError.message);
      return;
    }

    const typedReviews =
      (reviewData ?? []) as unknown as DishReview[];

    setReviews(typedReviews);

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
      .eq('dish_id', id);

    setLoading(false);

    if (rankingError) {
      Alert.alert('Ranking error', rankingError.message);
      return;
    }

    setRankingCount(count ?? 0);
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
    <ScrollView contentContainerStyle={styles.container}>
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
            {dish.restaurants.name}
            {dish.restaurants.city
              ? ` · ${dish.restaurants.city}`
              : ''}
          </Text>
        </TouchableOpacity>
      ) : null}

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
    justifyContent: 'center',
    alignItems: 'center',
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
  restaurantLink: {
    fontSize: 16,
    color: '#555555',
    fontWeight: '600',
    marginTop: 6,
  },
  statsCard: {
    flexDirection: 'row',
    marginTop: 24,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 14,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    color: '#777777',
    marginTop: 4,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#eeeeee',
  },
  details: {
    marginTop: 18,
  },
  detailText: {
    fontSize: 14,
    color: '#666666',
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
  reviewerInfo: {
    flex: 1,
    paddingRight: 16,
  },
  reviewer: {
    fontSize: 15,
    fontWeight: '700',
  },
  handle: {
    fontSize: 13,
    color: '#777777',
    marginTop: 2,
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