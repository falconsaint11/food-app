import { useFocusEffect, useLocalSearchParams } from 'expo-router';
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

type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
};

type RankedDish = {
  id: string;
  rank: number;
  dishes: {
    name: string;
    restaurants: {
      name: string;
    } | null;
  } | null;
};

type RankedRestaurant = {
  id: string;
  rank: number;
  restaurants: {
    name: string;
    city: string | null;
  } | null;
};

type DiaryEntry = {
  id: string;
  rating: number;
  review_text: string | null;
  date_eaten: string;
  dishes: {
    name: string;
    restaurants: {
      name: string;
      city: string | null;
    } | null;
  } | null;
};

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [topDishes, setTopDishes] = useState<RankedDish[]>([]);
  const [topRestaurants, setTopRestaurants] = useState<RankedRestaurant[]>([]);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [id])
  );

  async function loadProfile() {
    if (!id) {
      return;
    }

    setLoading(true);

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name, bio')
      .eq('id', id)
      .maybeSingle();

    if (profileError) {
      setLoading(false);
      Alert.alert('Profile error', profileError.message);
      return;
    }

    if (!profileData) {
      setLoading(false);
      setProfile(null);
      return;
    }

    setProfile(profileData);

    const { data: dishData, error: dishError } = await supabase
      .from('dish_rankings')
      .select(`
        id,
        rank,
        dishes (
          name,
          restaurants (
            name
          )
        )
      `)
      .eq('user_id', id)
      .order('rank', { ascending: true });

    if (dishError) {
      setLoading(false);
      Alert.alert('Ranking error', dishError.message);
      return;
    }

    setTopDishes((dishData ?? []) as unknown as RankedDish[]);

    const { data: restaurantData, error: restaurantError } = await supabase
      .from('restaurant_rankings')
      .select(`
        id,
        rank,
        restaurants (
          name,
          city
        )
      `)
      .eq('user_id', id)
      .order('rank', { ascending: true });

    if (restaurantError) {
      setLoading(false);
      Alert.alert('Ranking error', restaurantError.message);
      return;
    }

    setTopRestaurants(
      (restaurantData ?? []) as unknown as RankedRestaurant[]
    );

    const { data: diaryData, error: diaryError } = await supabase
      .from('reviews')
      .select(`
        id,
        rating,
        review_text,
        date_eaten,
        dishes (
          name,
          restaurants (
            name,
            city
          )
        )
      `)
      .eq('user_id', id)
      .order('date_eaten', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(3);

    setLoading(false);

    if (diaryError) {
      Alert.alert('Diary error', diaryError.message);
      return;
    }

    setDiary((diaryData ?? []) as unknown as DiaryEntry[]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text>Profile not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.avatarPlaceholder}>
        <Text style={styles.avatarText}>
          {(profile.display_name || profile.username)
            .charAt(0)
            .toUpperCase()}
        </Text>
      </View>

      <Text style={styles.displayName}>
        {profile.display_name || profile.username}
      </Text>

      <Text style={styles.username}>@{profile.username}</Text>

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Dishes</Text>

        {topDishes.length === 0 ? (
          <Text style={styles.emptyText}>Nothing ranked yet.</Text>
        ) : (
          topDishes.map((item) => (
            <View key={item.id} style={styles.rankingRow}>
              <Text style={styles.rankingNumber}>#{item.rank}</Text>

              <View>
                <Text style={styles.rankingName}>
                  {item.dishes?.name ?? 'Unknown dish'}
                </Text>

                <Text style={styles.rankingSubtext}>
                  {item.dishes?.restaurants?.name ?? 'Unknown restaurant'}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Restaurants</Text>

        {topRestaurants.length === 0 ? (
          <Text style={styles.emptyText}>Nothing ranked yet.</Text>
        ) : (
          topRestaurants.map((item) => (
            <View key={item.id} style={styles.rankingRow}>
              <Text style={styles.rankingNumber}>#{item.rank}</Text>

              <View>
                <Text style={styles.rankingName}>
                  {item.restaurants?.name ?? 'Unknown restaurant'}
                </Text>

                {item.restaurants?.city ? (
                  <Text style={styles.rankingSubtext}>
                    {item.restaurants.city}
                  </Text>
                ) : null}
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Diary</Text>

        {diary.length === 0 ? (
          <Text style={styles.emptyText}>Nothing logged yet.</Text>
        ) : (
          diary.map((entry) => (
            <View key={entry.id} style={styles.diaryCard}>
              <View style={styles.diaryTopRow}>
                <View style={styles.diaryInfo}>
                  <Text style={styles.dishName}>
                    {entry.dishes?.name ?? 'Unknown dish'}
                  </Text>

                  <Text style={styles.restaurantName}>
                    {entry.dishes?.restaurants?.name ?? 'Unknown restaurant'}
                    {entry.dishes?.restaurants?.city
                      ? ` · ${entry.dishes.restaurants.city}`
                      : ''}
                  </Text>
                </View>

                <Text style={styles.rating}>{entry.rating}★</Text>
              </View>

              {entry.review_text ? (
                <Text style={styles.reviewText}>{entry.review_text}</Text>
              ) : null}
            </View>
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
    paddingBottom: 40,
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#eeeeee',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  avatarText: {
    fontSize: 36,
    fontWeight: '700',
  },
  displayName: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 16,
  },
  username: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 4,
    color: '#666666',
  },
  bio: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 22,
  },
  section: {
    marginTop: 28,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#777777',
  },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rankingNumber: {
    width: 36,
    fontSize: 17,
    fontWeight: '700',
  },
  rankingName: {
    fontSize: 16,
    fontWeight: '600',
  },
  rankingSubtext: {
    fontSize: 14,
    color: '#666666',
    marginTop: 2,
  },
  diaryCard: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  diaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  diaryInfo: {
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
  reviewText: {
    fontSize: 15,
    marginTop: 8,
    lineHeight: 21,
  },
});