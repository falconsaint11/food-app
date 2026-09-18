import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';

type DiaryEntry = {
  id: string;
  rating: number;
  review_text: string | null;
  photo_path: string | null;
  date_eaten: string;
  dishes: {
    name: string;
    restaurants: {
      name: string;
      city: string | null;
    } | null;
  } | null;
};

export default function DiaryScreen() {
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadDiary();
    }, [])
  );

  async function loadDiary() {
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
      .from('reviews')
      .select(`
        id,
        rating,
        review_text,
        photo_path,
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

    setLoading(false);

    if (error) {
      Alert.alert('Diary error', error.message);
      return;
    }

    setDiary((data ?? []) as unknown as DiaryEntry[]);
  }

  function getPhotoUrl(path: string) {
    const { data } = supabase.storage
      .from('review-photos')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  function formatDate(date: string) {
    const parsedDate = new Date(`${date}T00:00:00`);

    return parsedDate.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
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
      <Text style={styles.title}>Diary</Text>

      <Text style={styles.subtitle}>
        Everything you've logged.
      </Text>

      {diary.length === 0 ? (
        <Text style={styles.emptyText}>
          Nothing logged yet.
        </Text>
      ) : (
        diary.map((entry) => {
          const photoUrl = entry.photo_path
            ? getPhotoUrl(entry.photo_path)
            : null;

          return (
            <TouchableOpacity
              key={entry.id}
              style={styles.diaryCard}
              activeOpacity={0.75}
              onPress={() =>
                router.push({
                  pathname: '/review/[id]',
                  params: {
                    id: entry.id,
                  },
                })
              }
            >
              <View style={styles.topRow}>
                <View style={styles.info}>
                  <Text style={styles.dishName}>
                    {entry.dishes?.name ?? 'Unknown dish'}
                  </Text>

                  <Text style={styles.restaurantName}>
                    {entry.dishes?.restaurants?.name ??
                      'Unknown restaurant'}

                    {entry.dishes?.restaurants?.city
                      ? ` · ${entry.dishes.restaurants.city}`
                      : ''}
                  </Text>
                </View>

                <Text style={styles.rating}>
                  {entry.rating}★
                </Text>
              </View>

              {photoUrl ? (
                <Image
                  source={{ uri: photoUrl }}
                  style={styles.photo}
                  resizeMode="cover"
                />
              ) : null}

              {entry.review_text ? (
                <Text
                  style={styles.reviewText}
                  numberOfLines={3}
                >
                  {entry.review_text}
                </Text>
              ) : null}

              <View style={styles.bottomRow}>
                <Text style={styles.date}>
                  {formatDate(entry.date_eaten)}
                </Text>

                <Text style={styles.viewReview}>
                  View review
                </Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}
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
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginTop: 6,
    marginBottom: 26,
  },
  diaryCard: {
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  info: {
    flex: 1,
    paddingRight: 16,
  },
  dishName: {
    fontSize: 18,
    fontWeight: '700',
  },
  restaurantName: {
    fontSize: 14,
    color: '#666666',
    marginTop: 3,
  },
  rating: {
    fontSize: 18,
    fontWeight: '700',
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: '#eeeeee',
  },
  reviewText: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  date: {
    fontSize: 12,
    color: '#999999',
  },
  viewReview: {
    fontSize: 12,
    color: '#777777',
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 15,
    color: '#777777',
  },
});