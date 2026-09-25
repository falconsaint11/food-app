import {
  router,
  useFocusEffect,
  useLocalSearchParams,
} from 'expo-router';
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

type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_path: string | null;
};

type RankedDish = {
  id: string;
  rank: number;
  dishes: {
    id: string;
    name: string;
    restaurants: {
      id: string;
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

type DiaryEntry = {
  id: string;
  rating: number;
  review_text: string | null;
  photo_path: string | null;
  date_eaten: string;
  dishes: {
    id: string;
    name: string;
    restaurants: {
      id: string;
      name: string;
      city: string | null;
    } | null;
  } | null;
};

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [topDishes, setTopDishes] = useState<RankedDish[]>([]);
  const [topRestaurants, setTopRestaurants] = useState<
    RankedRestaurant[]
  >([]);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);

  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  const [reviewCount, setReviewCount] = useState(0);
  const [dishCount, setDishCount] = useState(0);
  const [restaurantCount, setRestaurantCount] = useState(0);

  const [currentUserId, setCurrentUserId] = useState<string | null>(
    null
  );

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

    const {
      data: profileData,
      error: profileError,
    } = await supabase
      .from('profiles')
      .select(
        'id, username, display_name, bio, avatar_path'
      )
      .eq('id', id)
      .maybeSingle();

    if (profileError) {
      setLoading(false);

      Alert.alert(
        'Profile error',
        profileError.message
      );

      return;
    }

    if (!profileData) {
      setLoading(false);
      setProfile(null);
      return;
    }

    setProfile(profileData);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    setCurrentUserId(user?.id ?? null);

    if (user && user.id !== id) {
      const {
        data: followData,
      } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('following_id', id)
        .maybeSingle();

      setIsFollowing(!!followData);
    } else {
      setIsFollowing(false);
    }

    const {
      count: followers,
    } = await supabase
      .from('follows')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq('following_id', id);

    setFollowerCount(followers ?? 0);

    const {
      count: following,
    } = await supabase
      .from('follows')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq('follower_id', id);

    setFollowingCount(following ?? 0);

    const {
      data: dishData,
      error: dishError,
    } = await supabase
      .from('dish_rankings')
      .select(`
        id,
        rank,
        dishes (
          id,
          name,
          restaurants (
            id,
            name
          )
        )
      `)
      .eq('user_id', id)
      .order('rank', {
        ascending: true,
      });

    if (dishError) {
      setLoading(false);

      Alert.alert(
        'Ranking error',
        dishError.message
      );

      return;
    }

    setTopDishes(
      (dishData ?? []) as unknown as RankedDish[]
    );

    const {
      data: restaurantData,
      error: restaurantError,
    } = await supabase
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
      .eq('user_id', id)
      .order('rank', {
        ascending: true,
      });

    if (restaurantError) {
      setLoading(false);

      Alert.alert(
        'Ranking error',
        restaurantError.message
      );

      return;
    }

    setTopRestaurants(
      (restaurantData ?? []) as unknown as RankedRestaurant[]
    );

    const {
      data: diaryData,
      error: diaryError,
    } = await supabase
      .from('reviews')
      .select(`
        id,
        rating,
        review_text,
        photo_path,
        date_eaten,
        dishes (
          id,
          name,
          restaurants (
            id,
            name,
            city
          )
        )
      `)
      .eq('user_id', id)
      .order('date_eaten', {
        ascending: false,
      })
      .order('created_at', {
        ascending: false,
      });

    if (diaryError) {
      setLoading(false);

      Alert.alert(
        'Diary error',
        diaryError.message
      );

      return;
    }

    const entries = (diaryData ?? []) as unknown as DiaryEntry[];

    setDiary(entries.slice(0, 3));

    setReviewCount(entries.length);

    const uniqueDishIds = new Set(
      entries
        .map((entry) => entry.dishes?.id)
        .filter(Boolean)
    );

    setDishCount(uniqueDishIds.size);

    const uniqueRestaurantIds = new Set(
      entries
        .map(
          (entry) =>
            entry.dishes?.restaurants?.id
        )
        .filter(Boolean)
    );

    setRestaurantCount(
      uniqueRestaurantIds.size
    );

    setLoading(false);
  }

  async function toggleFollow() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (
      userError ||
      !user ||
      !id
    ) {
      Alert.alert(
        'Error',
        'You must be signed in.'
      );

      return;
    }

    if (user.id === id) {
      return;
    }

    if (isFollowing) {
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', user.id)
        .eq('following_id', id);

      if (error) {
        Alert.alert(
          'Unfollow error',
          error.message
        );

        return;
      }

      setIsFollowing(false);

      setFollowerCount((current) =>
        Math.max(0, current - 1)
      );
    } else {
      const { error } = await supabase
        .from('follows')
        .insert({
          follower_id: user.id,
          following_id: id,
        });

      if (error) {
        Alert.alert(
          'Follow error',
          error.message
        );

        return;
      }

      setIsFollowing(true);

      setFollowerCount(
        (current) => current + 1
      );
    }
  }

  function getPhotoUrl(
    path: string
  ) {
    const { data } =
      supabase.storage
        .from('review-photos')
        .getPublicUrl(path);

    return data.publicUrl;
  }

  function getProfilePhotoUrl(
    path: string
  ) {
    const { data } =
      supabase.storage
        .from('profile-photos')
        .getPublicUrl(path);

    return data.publicUrl;
  }

  function formatDate(
    date: string
  ) {
    const parsedDate = new Date(
      `${date}T00:00:00`
    );

    return parsedDate.toLocaleDateString(
      undefined,
      {
        month: 'short',
        day: 'numeric',
      }
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          size="large"
        />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text>
          Profile not found.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={
        styles.container
      }
    >
      <View
        style={
          styles.profileHeader
        }
      >
        {profile.avatar_path ? (
          <Image
            source={{
              uri: getProfilePhotoUrl(
                profile.avatar_path
              ),
            }}
            style={
              styles.profileAvatar
            }
            resizeMode="cover"
          />
        ) : (
          <View
            style={
              styles.avatarPlaceholder
            }
          >
            <Text
              style={
                styles.avatarText
              }
            >
              {(
                profile.display_name ||
                profile.username
              )
                .charAt(0)
                .toUpperCase()}
            </Text>
          </View>
        )}

        <Text
          style={
            styles.displayName
          }
        >
          {profile.display_name ||
            profile.username}
        </Text>

        <Text
          style={styles.username}
        >
          @{profile.username}
        </Text>

        {profile.bio ? (
          <Text
            style={styles.bio}
          >
            {profile.bio}
          </Text>
        ) : null}

        {currentUserId !== id ? (
          <TouchableOpacity
            style={[
              styles.followButton,
              isFollowing &&
                styles.followingButton,
            ]}
            onPress={
              toggleFollow
            }
          >
            <Text
              style={[
                styles.followButtonText,
                isFollowing &&
                  styles.followingButtonText,
              ]}
            >
              {isFollowing
                ? 'Following'
                : 'Follow'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View
        style={styles.statsCard}
      >
        <View style={styles.stat}>
          <Text
            style={
              styles.statNumber
            }
          >
            {reviewCount}
          </Text>

          <Text
            style={
              styles.statLabel
            }
          >
            Reviews
          </Text>
        </View>

        <View
          style={
            styles.statDivider
          }
        />

        <View style={styles.stat}>
          <Text
            style={
              styles.statNumber
            }
          >
            {dishCount}
          </Text>

          <Text
            style={
              styles.statLabel
            }
          >
            Dishes
          </Text>
        </View>

        <View
          style={
            styles.statDivider
          }
        />

        <View style={styles.stat}>
          <Text
            style={
              styles.statNumber
            }
          >
            {restaurantCount}
          </Text>

          <Text
            style={
              styles.statLabel
            }
          >
            Restaurants
          </Text>
        </View>
      </View>

      <View
        style={
          styles.socialStats
        }
      >
        <TouchableOpacity
          style={
            styles.socialStat
          }
          onPress={() =>
            router.push({
              pathname:
                '/followers',
              params: {
                userId: id,
              },
            })
          }
        >
          <Text
            style={
              styles.socialNumber
            }
          >
            {followerCount}
          </Text>

          <Text
            style={
              styles.socialLabel
            }
          >
            {followerCount === 1
              ? 'Follower'
              : 'Followers'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={
            styles.socialStat
          }
          onPress={() =>
            router.push({
              pathname:
                '/following',
              params: {
                userId: id,
              },
            })
          }
        >
          <Text
            style={
              styles.socialNumber
            }
          >
            {followingCount}
          </Text>

          <Text
            style={
              styles.socialLabel
            }
          >
            Following
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={styles.section}
      >
        <Text
          style={
            styles.sectionTitle
          }
        >
          Top Dishes
        </Text>

        {topDishes.length ===
        0 ? (
          <View
            style={
              styles.emptyCard
            }
          >
            <Text
              style={
                styles.emptyText
              }
            >
              Nothing ranked yet.
            </Text>
          </View>
        ) : (
          <View
            style={
              styles.featureGrid
            }
          >
            {topDishes
              .slice(0, 4)
              .map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={
                    styles.featureCard
                  }
                  activeOpacity={0.7}
                  onPress={() => {
                    if (
                      !item.dishes?.id
                    ) {
                      return;
                    }

                    router.push({
                      pathname:
                        '/dish/[id]',
                      params: {
                        id: item
                          .dishes.id,
                      },
                    });
                  }}
                >
                  <View
                    style={
                      styles.rankBadge
                    }
                  >
                    <Text
                      style={
                        styles.rankBadgeText
                      }
                    >
                      #{item.rank}
                    </Text>
                  </View>

                  <Text
                    style={
                      styles.featureName
                    }
                    numberOfLines={
                      2
                    }
                  >
                    {item.dishes
                      ?.name ??
                      'Unknown dish'}
                  </Text>

                  <Text
                    style={
                      styles.featureSubtext
                    }
                    numberOfLines={
                      1
                    }
                  >
                    {item.dishes
                      ?.restaurants
                      ?.name ??
                      'Unknown restaurant'}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        )}
      </View>

      <View
        style={styles.section}
      >
        <Text
          style={
            styles.sectionTitle
          }
        >
          Top Restaurants
        </Text>

        {topRestaurants.length ===
        0 ? (
          <View
            style={
              styles.emptyCard
            }
          >
            <Text
              style={
                styles.emptyText
              }
            >
              Nothing ranked yet.
            </Text>
          </View>
        ) : (
          <View
            style={
              styles.featureGrid
            }
          >
            {topRestaurants
              .slice(0, 4)
              .map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={
                    styles.featureCard
                  }
                  activeOpacity={0.7}
                  onPress={() => {
                    if (
                      !item
                        .restaurants
                        ?.id
                    ) {
                      return;
                    }

                    router.push({
                      pathname:
                        '/restaurant/[id]',
                      params: {
                        id: item
                          .restaurants
                          .id,
                      },
                    });
                  }}
                >
                  <View
                    style={
                      styles.rankBadge
                    }
                  >
                    <Text
                      style={
                        styles.rankBadgeText
                      }
                    >
                      #{item.rank}
                    </Text>
                  </View>

                  <Text
                    style={
                      styles.featureName
                    }
                    numberOfLines={
                      2
                    }
                  >
                    {item
                      .restaurants
                      ?.name ??
                      'Unknown restaurant'}
                  </Text>

                  <Text
                    style={
                      styles.featureSubtext
                    }
                    numberOfLines={
                      1
                    }
                  >
                    {item
                      .restaurants
                      ?.city ??
                      'Location unknown'}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        )}
      </View>

      <View
        style={styles.section}
      >
        <Text
          style={
            styles.sectionTitle
          }
        >
          Recent Diary
        </Text>

        {diary.length === 0 ? (
          <View
            style={
              styles.emptyCard
            }
          >
            <Text
              style={
                styles.emptyText
              }
            >
              Nothing logged yet.
            </Text>
          </View>
        ) : (
          diary.map((entry) => {
            const photoUrl =
              entry.photo_path
                ? getPhotoUrl(
                    entry.photo_path
                  )
                : null;

            return (
              <TouchableOpacity
                key={entry.id}
                style={
                  styles.diaryCard
                }
                activeOpacity={0.7}
                onPress={() =>
                  router.push({
                    pathname:
                      '/review/[id]',
                    params: {
                      id: entry.id,
                    },
                  })
                }
              >
                <View
                  style={
                    styles.diaryContentRow
                  }
                >
                  {photoUrl ? (
                    <Image
                      source={{
                        uri: photoUrl,
                      }}
                      style={
                        styles.diaryThumbnail
                      }
                      resizeMode="cover"
                    />
                  ) : null}

                  <View
                    style={
                      styles.diaryMainContent
                    }
                  >
                    <View
                      style={
                        styles.diaryTopRow
                      }
                    >
                      <View
                        style={
                          styles.diaryInfo
                        }
                      >
                        <Text
                          style={
                            styles.dishName
                          }
                        >
                          {entry
                            .dishes
                            ?.name ??
                            'Unknown dish'}
                        </Text>

                        <Text
                          style={
                            styles.restaurantName
                          }
                          numberOfLines={
                            1
                          }
                        >
                          {entry
                            .dishes
                            ?.restaurants
                            ?.name ??
                            'Unknown restaurant'}

                          {entry
                            .dishes
                            ?.restaurants
                            ?.city
                            ? ` · ${entry.dishes.restaurants.city}`
                            : ''}
                        </Text>
                      </View>

                      <View
                        style={
                          styles.diaryRight
                        }
                      >
                        <Text
                          style={
                            styles.rating
                          }
                        >
                          {entry.rating}★
                        </Text>

                        <Text
                          style={
                            styles.dateText
                          }
                        >
                          {formatDate(
                            entry.date_eaten
                          )}
                        </Text>
                      </View>
                    </View>

                    {entry.review_text ? (
                      <Text
                        style={
                          styles.reviewText
                        }
                        numberOfLines={
                          2
                        }
                      >
                        {
                          entry.review_text
                        }
                      </Text>
                    ) : null}

                    <Text
                      style={
                        styles.viewReview
                      }
                    >
                      View review
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: 24,
      paddingTop: 55,
      paddingBottom: 60,
      backgroundColor:
        '#ffffff',
    },

    centered: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        '#ffffff',
    },

    profileHeader: {
      alignItems:
        'center',
    },

    profileAvatar: {
      width: 92,
      height: 92,
      borderRadius: 46,
      backgroundColor:
        '#eeeeee',
    },

    avatarPlaceholder: {
      width: 92,
      height: 92,
      borderRadius: 46,
      backgroundColor:
        '#eeeeee',
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    avatarText: {
      fontSize: 34,
      fontWeight: '700',
    },

    displayName: {
      fontSize: 28,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: 14,
    },

    username: {
      fontSize: 15,
      textAlign: 'center',
      marginTop: 3,
      color: '#777777',
    },

    bio: {
      fontSize: 15,
      textAlign: 'center',
      marginTop: 12,
      lineHeight: 21,
      color: '#333333',
      maxWidth: 320,
    },

    followButton: {
      minWidth: 120,
      alignItems:
        'center',
      backgroundColor:
        '#111111',
      paddingHorizontal: 22,
      paddingVertical: 10,
      borderRadius: 10,
      marginTop: 18,
    },

    followButtonText: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: '700',
    },

    followingButton: {
      backgroundColor:
        '#ffffff',
      borderWidth: 1,
      borderColor:
        '#cccccc',
    },

    followingButtonText: {
      color: '#111111',
    },

    statsCard: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor:
        '#eeeeee',
      borderRadius: 14,
      marginTop: 28,
      paddingVertical: 17,
    },

    stat: {
      flex: 1,
      alignItems:
        'center',
    },

    statDivider: {
      width: 1,
      backgroundColor:
        '#eeeeee',
    },

    statNumber: {
      fontSize: 20,
      fontWeight: '700',
    },

    statLabel: {
      fontSize: 12,
      marginTop: 4,
      color: '#777777',
    },

    socialStats: {
      flexDirection: 'row',
      justifyContent:
        'center',
      marginTop: 14,
      gap: 36,
    },

    socialStat: {
      alignItems:
        'center',
      minWidth: 80,
    },

    socialNumber: {
      fontSize: 16,
      fontWeight: '700',
    },

    socialLabel: {
      fontSize: 13,
      color: '#666666',
      marginTop: 2,
    },

    section: {
      marginTop: 32,
    },

    sectionTitle: {
      fontSize: 21,
      fontWeight: '700',
      marginBottom: 12,
    },

    featureGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },

    featureCard: {
      width: '48%',
      minHeight: 118,
      borderWidth: 1,
      borderColor:
        '#eeeeee',
      borderRadius: 14,
      padding: 14,
      justifyContent:
        'flex-start',
    },

    rankBadge: {
      alignSelf:
        'flex-start',
      backgroundColor:
        '#111111',
      borderRadius: 7,
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginBottom: 12,
    },

    rankBadgeText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '700',
    },

    featureName: {
      fontSize: 16,
      fontWeight: '700',
      lineHeight: 20,
    },

    featureSubtext: {
      fontSize: 12,
      color: '#777777',
      marginTop: 5,
    },

    emptyCard: {
      borderWidth: 1,
      borderColor:
        '#eeeeee',
      borderRadius: 12,
      padding: 16,
    },

    emptyText: {
      fontSize: 14,
      color: '#777777',
    },

    diaryCard: {
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor:
        '#eeeeee',
    },

    diaryContentRow: {
      flexDirection: 'row',
      alignItems:
        'flex-start',
    },

    diaryThumbnail: {
      width: 88,
      height: 88,
      borderRadius: 12,
      marginRight: 13,
      backgroundColor:
        '#eeeeee',
    },

    diaryMainContent: {
      flex: 1,
    },

    diaryTopRow: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      alignItems:
        'flex-start',
    },

    diaryInfo: {
      flex: 1,
      paddingRight: 10,
    },

    diaryRight: {
      alignItems:
        'flex-end',
    },

    dishName: {
      fontSize: 17,
      fontWeight: '700',
    },

    restaurantName: {
      fontSize: 13,
      color: '#666666',
      marginTop: 3,
    },

    rating: {
      fontSize: 17,
      fontWeight: '700',
    },

    dateText: {
      fontSize: 11,
      color: '#999999',
      marginTop: 3,
    },

    reviewText: {
      fontSize: 14,
      marginTop: 8,
      lineHeight: 19,
      color: '#333333',
    },

    viewReview: {
      fontSize: 12,
      color: '#777777',
      fontWeight: '600',
      marginTop: 7,
    },
  });