import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';

type ActivityItem = {
  id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  profiles: {
    username: string;
    display_name: string | null;
  } | null;
  dishes: {
    name: string;
    restaurants: {
      name: string;
      city: string | null;
    } | null;
  } | null;
};

export default function ActivityScreen() {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadActivity();
    }, [])
  );

  async function loadActivity() {
    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);
      Alert.alert('Error', 'You must be signed in.');
      return;
    }

    const { data: follows, error: followsError } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);

    if (followsError) {
      setLoading(false);
      Alert.alert('Follow error', followsError.message);
      return;
    }

    const followingIds = (follows ?? []).map((row) => row.following_id);

    if (followingIds.length === 0) {
      setActivity([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('reviews')
      .select(`
        id,
        rating,
        review_text,
        created_at,
        profiles:user_id (
          username,
          display_name
        ),
        dishes (
          name,
          restaurants (
            name,
            city
          )
        )
      `)
      .in('user_id', followingIds)
      .order('created_at', { ascending: false })
      .limit(50);

    setLoading(false);

    if (error) {
      Alert.alert('Activity error', error.message);
      return;
    }

    setActivity((data ?? []) as unknown as ActivityItem[]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Activity</Text>
      <Text style={styles.subtitle}>
        See what people you follow are eating.
      </Text>

      {activity.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyText}>
            Follow people in Discover to start building your feed.
          </Text>
        </View>
      ) : (
        activity.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.userName}>
              {item.profiles?.display_name || item.profiles?.username || 'User'}
            </Text>

            <Text style={styles.userHandle}>
              @{item.profiles?.username ?? 'unknown'}
            </Text>

            <View style={styles.topRow}>
              <View style={styles.foodInfo}>
                <Text style={styles.dishName}>
                  {item.dishes?.name ?? 'Unknown dish'}
                </Text>

                <Text style={styles.restaurantName}>
                  {item.dishes?.restaurants?.name ?? 'Unknown restaurant'}
                  {item.dishes?.restaurants?.city
                    ? ` · ${item.dishes.restaurants.city}`
                    : ''}
                </Text>
              </View>

              <Text style={styles.rating}>{item.rating}★</Text>
            </View>

            {item.review_text ? (
              <Text style={styles.review}>{item.review_text}</Text>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 40,
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginTop: 8,
    marginBottom: 24,
  },
  emptyState: {
    marginTop: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 15,
    color: '#777777',
    marginTop: 6,
    lineHeight: 21,
  },
  card: {
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
  },
  userHandle: {
    fontSize: 13,
    color: '#777777',
    marginTop: 2,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  foodInfo: {
    flex: 1,
    paddingRight: 16,
  },
  dishName: {
    fontSize: 17,
    fontWeight: '600',
  },
  restaurantName: {
    fontSize: 14,
    color: '#666666',
    marginTop: 3,
  },
  rating: {
    fontSize: 17,
    fontWeight: '700',
  },
  review: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
  },
});