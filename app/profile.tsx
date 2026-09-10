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
import { router, useFocusEffect } from 'expo-router';

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
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

type RankedDish = {
  id: string;
  rank: number;
  dishes: {
    id: string;
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
    id: string;
    name: string;
    city: string | null;
  } | null;
};

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [topDishes, setTopDishes] = useState<RankedDish[]>([]);
  const [topRestaurants, setTopRestaurants] = useState<RankedRestaurant[]>([]);
  const [dishCount, setDishCount] = useState(0);
const [restaurantCount, setRestaurantCount] = useState(0);
const [followerCount, setFollowerCount] = useState(0);
const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
        loadProfile();
  }, [])
);

  async function loadProfile() {
    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);
      Alert.alert('Error', 'No signed-in user found.');
      return;
    }

    const { data, error } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', user.id)
  .maybeSingle();

    setLoading(false);

   if (error) {
  Alert.alert('Profile error', error.message);
  return;
}

if (!data) {
  setProfile(null);
  return;
}

setProfile(data);
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
  .eq('user_id', user.id)
  .order('date_eaten', { ascending: false })
  .order('created_at', { ascending: false });

if (diaryError) {
  Alert.alert('Diary error', diaryError.message);
  return;
}

setDiary((diaryData ?? []) as unknown as DiaryEntry[]);
const entries = (diaryData ?? []) as unknown as DiaryEntry[];

setDishCount(entries.length);

const uniqueRestaurants = new Set(
  entries
    .map((entry) => entry.dishes?.restaurants?.name)
    .filter(Boolean)
);

setRestaurantCount(uniqueRestaurants.size);
const { data: rankedDishData, error: rankedDishError } = await supabase
  .from('dish_rankings')
  .select(`
    id,
    rank,
    dishes (
      id,
      name,
      restaurants (
        name
      )
    )
  `)
  .eq('user_id', user.id)
  .order('rank', { ascending: true });

if (rankedDishError) {
  Alert.alert('Ranking error', rankedDishError.message);
  return;
}

setTopDishes(
  (rankedDishData ?? []) as unknown as RankedDish[]
);

const { data: rankedRestaurantData, error: rankedRestaurantError } =
  await supabase
    .from('restaurant_rankings')
    .select(`
      id,
      rank,
      restaurants (
        id,
        name,
        city
      )
    `)
    .eq('user_id', user.id)
    .order('rank', { ascending: true });

if (rankedRestaurantError) {
  Alert.alert('Ranking error', rankedRestaurantError.message);
  return;
}

setTopRestaurants(
  (rankedRestaurantData ?? []) as unknown as RankedRestaurant[]
);
const { count: followers, error: followerError } = await supabase
  .from('follows')
  .select('*', { count: 'exact', head: true })
  .eq('following_id', user.id);

if (followerError) {
  Alert.alert('Follower error', followerError.message);
  return;
}

setFollowerCount(followers ?? 0);

const { count: following, error: followingError } = await supabase
  .from('follows')
  .select('*', { count: 'exact', head: true })
  .eq('follower_id', user.id);

if (followingError) {
  Alert.alert('Following error', followingError.message);
  return;
}

setFollowingCount(following ?? 0);

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
      <Text style={styles.noProfileTitle}>No profile yet</Text>

      <Text style={styles.noProfileText}>
        Create a profile to start using the app.
      </Text>

      <TouchableOpacity
        style={styles.createProfileButton}
        onPress={() => router.push('/create-profile')}
      >
        <Text style={styles.createProfileButtonText}>Create Profile</Text>
      </TouchableOpacity>
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
      <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.push('/edit-profile')}
        >
            <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>

      <TouchableOpacity
  style={styles.switchAccountButton}
  onPress={() => router.push('/auth')}
>
  <Text style={styles.switchAccountText}>Switch Account</Text>
</TouchableOpacity>

      {profile.bio ? (
        <Text style={styles.bio}>{profile.bio}</Text>
      ) : null}

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{dishCount}</Text>
          <Text style={styles.statLabel}>Dishes</Text>
        </View>

        <View style={styles.stat}>
          <Text style={styles.statNumber}>{restaurantCount}</Text>
          <Text style={styles.statLabel}>Restaurants</Text>
        </View>

        <View style={styles.stat}>
  <Text style={styles.statNumber}>{followerCount}</Text>
  <Text style={styles.statLabel}>Followers</Text>
</View>

<View style={styles.stat}>
  <Text style={styles.statNumber}>{followingCount}</Text>
  <Text style={styles.statLabel}>Following</Text>
</View>
      </View>

    <View style={styles.section}>
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>Top Dishes</Text>

    <TouchableOpacity onPress={() => router.push('/rank-dishes')}>
      <Text style={styles.rankLink}>Rank</Text>
    </TouchableOpacity>
  </View>

  {topDishes.length === 0 ? (
    <Text style={styles.emptyText}>Nothing ranked yet.</Text>
  ) : (
    topDishes.map((item) => (
      <View key={item.id} style={styles.rankingRow}>
        <Text style={styles.rankingNumber}>#{item.rank}</Text>

        <View style={styles.rankingInfo}>
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
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>Top Restaurants</Text>

    <TouchableOpacity onPress={() => router.push('/rank-restaurants')}>
      <Text style={styles.rankLink}>Rank</Text>
    </TouchableOpacity>
  </View>

  {topRestaurants.length === 0 ? (
    <Text style={styles.emptyText}>Nothing ranked yet.</Text>
  ) : (
    topRestaurants.map((item) => (
      <View key={item.id} style={styles.rankingRow}>
        <Text style={styles.rankingNumber}>#{item.rank}</Text>

        <View style={styles.rankingInfo}>
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
    diary.slice(0, 3).map((entry) => (
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
  {diary.length > 0 ? (
  <TouchableOpacity
    style={styles.seeAllButton}
    onPress={() => router.push('/diary')}
  >
    <Text style={styles.seeAllText}>See All</Text>
  </TouchableOpacity>
) : null}
</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
  flexGrow: 1,
  padding: 24,
  paddingBottom: 40,
  backgroundColor: '#ffffff',
},
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  noProfileTitle: {
  fontSize: 24,
  fontWeight: '700',
},
noProfileText: {
  fontSize: 15,
  color: '#666666',
  marginTop: 8,
  marginBottom: 20,
},
createProfileButton: {
  backgroundColor: '#111111',
  borderRadius: 10,
  paddingHorizontal: 20,
  paddingVertical: 12,
},
createProfileButtonText: {
  color: '#ffffff',
  fontSize: 15,
  fontWeight: '600',
},
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#eeeeee',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 30,
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
  editButton: {
  alignSelf: 'center',
  marginTop: 14,
  paddingHorizontal: 18,
  paddingVertical: 10,
  borderWidth: 1,
  borderColor: '#cccccc',
  borderRadius: 8,
},
editButtonText: {
  fontSize: 15,
  fontWeight: '600',
},
switchAccountButton: {
  alignSelf: 'center',
  marginTop: 8,
  paddingHorizontal: 18,
  paddingVertical: 10,
},
switchAccountText: {
  fontSize: 14,
  color: '#666666',
  fontWeight: '600',
},
  bio: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 22,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 28,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eeeeee',
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 13,
    marginTop: 4,
    color: '#666666',
  },
  sectionHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
},
rankLink: {
  fontSize: 15,
  fontWeight: '600',
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
rankingInfo: {
  flex: 1,
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
seeAllButton: {
  marginTop: 14,
  alignSelf: 'flex-start',
},
seeAllText: {
  fontSize: 15,
  fontWeight: '600',
},
});