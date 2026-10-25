import * as Location from 'expo-location';

import { router, useFocusEffect } from 'expo-router';

import { useCallback, useState } from 'react';

import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';
import { withoutHiddenUsers } from '@/lib/moderation';
import { fetchTags, Tag } from '@/lib/tags';
import { Palette } from '@/constants/theme';

type SearchType = 'users' | 'restaurants' | 'dishes';

type UserResult = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
};

type RestaurantResult = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
};

type DishResult = {
  id: string;
  name: string;
  restaurants: {
    id: string;
    name: string;
    city: string | null;
  } | null;
};

type ExploreRestaurant = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  averageRating: number;
  reviewCount: number;
};

type NearbyRestaurant = ExploreRestaurant & {
  distanceMiles: number;
};

type ExploreDish = {
  id: string;
  name: string;
  restaurantName: string;
  city: string | null;
  averageRating: number;
  reviewCount: number;
};

type ExploreReview = {
  rating: number;
  created_at: string;
  dishes: {
    id: string;
    name: string;
    restaurants: {
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
  } | null;
};

export default function DiscoverScreen() {
  const [query, setQuery] = useState('');

  const [searchType, setSearchType] =
    useState<SearchType>('users');

  const [userResults, setUserResults] =
    useState<UserResult[]>([]);

  const [restaurantResults, setRestaurantResults] =
    useState<RestaurantResult[]>([]);

  const [dishResults, setDishResults] =
    useState<DishResult[]>([]);

  const [searchLoading, setSearchLoading] =
    useState(false);

  const [exploreLoading, setExploreLoading] =
    useState(true);

  const [locationAllowed, setLocationAllowed] =
    useState(false);

  const [followingIds, setFollowingIds] =
    useState<string[]>([]);

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);

  const [nearbyRestaurants, setNearbyRestaurants] =
    useState<NearbyRestaurant[]>([]);

  const [trendingRestaurants, setTrendingRestaurants] =
    useState<ExploreRestaurant[]>([]);

  const [topRestaurants, setTopRestaurants] =
    useState<ExploreRestaurant[]>([]);

  const [topDishes, setTopDishes] =
    useState<ExploreDish[]>([]);

  const [allTags, setAllTags] = useState<Tag[]>([]);

  // null = "All": the regular Top Rated Dishes list.
  const [selectedTag, setSelectedTag] =
    useState<string | null>(null);

  const [tagDishes, setTagDishes] =
    useState<ExploreDish[]>([]);

  const [tagLoading, setTagLoading] = useState(false);

  const [
    mostReviewedRestaurants,
    setMostReviewedRestaurants,
  ] = useState<ExploreRestaurant[]>([]);

  const [
    mostReviewedDishes,
    setMostReviewedDishes,
  ] = useState<ExploreDish[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadFollowing();
      loadExplore();
      loadTags();
    }, [])
  );

  async function loadFollowing() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return;
    }

    setCurrentUserId(user.id);

    const { data, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id);

    if (error) {
      console.log(
        'Following load error:',
        error.message
      );

      return;
    }

    setFollowingIds(
      (data ?? []).map(
        (row) => row.following_id
      )
    );
  }

  function degreesToRadians(degrees: number) {
    return degrees * (Math.PI / 180);
  }

  function getDistanceMiles(
    latitude1: number,
    longitude1: number,
    latitude2: number,
    longitude2: number
  ) {
    const earthRadiusMiles = 3958.8;

    const latitudeDifference =
      degreesToRadians(
        latitude2 - latitude1
      );

    const longitudeDifference =
      degreesToRadians(
        longitude2 - longitude1
      );

    const firstLatitude =
      degreesToRadians(latitude1);

    const secondLatitude =
      degreesToRadians(latitude2);

    const a =
      Math.sin(
        latitudeDifference / 2
      ) ** 2 +
      Math.cos(firstLatitude) *
        Math.cos(secondLatitude) *
        Math.sin(
          longitudeDifference / 2
        ) ** 2;

    const c =
      2 *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
      );

    return earthRadiusMiles * c;
  }

  async function getUserLocation() {
    try {
      const permission =
        await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        setLocationAllowed(false);
        return null;
      }

      const location =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

      setLocationAllowed(true);

      return {
        latitude:
          location.coords.latitude,
        longitude:
          location.coords.longitude,
      };
    } catch (error) {
      console.log(
        'Discover location error:',
        error
      );

      setLocationAllowed(false);

      return null;
    }
  }

  async function loadExplore() {
    setExploreLoading(true);

    const userLocation =
      await getUserLocation();

    const { data, error } = await supabase
      .from('reviews')
      .select(`
        rating,
        created_at,
        dishes (
          id,
          name,
          restaurants (
            id,
            name,
            city,
            state,
            latitude,
            longitude
          )
        )
      `)
      .limit(500);

    if (error) {
      setExploreLoading(false);

      console.log(
        'Explore load error:',
        error.message
      );

      return;
    }

    const reviews =
      (data ?? []) as unknown as ExploreReview[];

    const restaurantMap = new Map<
      string,
      {
        id: string;
        name: string;
        city: string | null;
        state: string | null;
        latitude: number | null;
        longitude: number | null;
        totalRating: number;
        reviewCount: number;
      }
    >();

    const weeklyRestaurantMap = new Map<
      string,
      {
        id: string;
        name: string;
        city: string | null;
        state: string | null;
        latitude: number | null;
        longitude: number | null;
        totalRating: number;
        reviewCount: number;
      }
    >();

    const dishMap = new Map<
      string,
      {
        id: string;
        name: string;
        restaurantName: string;
        city: string | null;
        totalRating: number;
        reviewCount: number;
      }
    >();

    const sevenDaysAgo =
      Date.now() -
      7 * 24 * 60 * 60 * 1000;

    reviews.forEach((review) => {
      const dish = review.dishes;

      const restaurant =
        review.dishes?.restaurants;

      if (!dish) {
        return;
      }

      const numericRating =
        Number(review.rating);

      const existingDish =
        dishMap.get(dish.id);

      if (existingDish) {
        existingDish.totalRating +=
          numericRating;

        existingDish.reviewCount += 1;
      } else {
        dishMap.set(dish.id, {
          id: dish.id,
          name: dish.name,
          restaurantName:
            restaurant?.name ??
            'Unknown restaurant',
          city:
            restaurant?.city ?? null,
          totalRating: numericRating,
          reviewCount: 1,
        });
      }

      if (!restaurant) {
        return;
      }

      const latitude =
        restaurant.latitude !== null
          ? Number(
              restaurant.latitude
            )
          : null;

      const longitude =
        restaurant.longitude !== null
          ? Number(
              restaurant.longitude
            )
          : null;

      const existingRestaurant =
        restaurantMap.get(
          restaurant.id
        );

      if (existingRestaurant) {
        existingRestaurant.totalRating +=
          numericRating;

        existingRestaurant.reviewCount +=
          1;
      } else {
        restaurantMap.set(
          restaurant.id,
          {
            id: restaurant.id,
            name: restaurant.name,
            city: restaurant.city,
            state: restaurant.state,
            latitude,
            longitude,
            totalRating:
              numericRating,
            reviewCount: 1,
          }
        );
      }

      const reviewTime =
        new Date(
          review.created_at
        ).getTime();

      if (
        reviewTime >= sevenDaysAgo
      ) {
        const weeklyRestaurant =
          weeklyRestaurantMap.get(
            restaurant.id
          );

        if (weeklyRestaurant) {
          weeklyRestaurant.totalRating +=
            numericRating;

          weeklyRestaurant.reviewCount +=
            1;
        } else {
          weeklyRestaurantMap.set(
            restaurant.id,
            {
              id: restaurant.id,
              name: restaurant.name,
              city: restaurant.city,
              state: restaurant.state,
              latitude,
              longitude,
              totalRating:
                numericRating,
              reviewCount: 1,
            }
          );
        }
      }
    });

    const restaurantList: ExploreRestaurant[] =
      Array.from(
        restaurantMap.values()
      ).map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        city: restaurant.city,
        state: restaurant.state,
        latitude:
          restaurant.latitude,
        longitude:
          restaurant.longitude,
        averageRating:
          restaurant.totalRating /
          restaurant.reviewCount,
        reviewCount:
          restaurant.reviewCount,
      }));

    const weeklyRestaurantList: ExploreRestaurant[] =
      Array.from(
        weeklyRestaurantMap.values()
      ).map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        city: restaurant.city,
        state: restaurant.state,
        latitude:
          restaurant.latitude,
        longitude:
          restaurant.longitude,
        averageRating:
          restaurant.totalRating /
          restaurant.reviewCount,
        reviewCount:
          restaurant.reviewCount,
      }));

    const dishList: ExploreDish[] =
      Array.from(
        dishMap.values()
      ).map((dish) => ({
        id: dish.id,
        name: dish.name,
        restaurantName:
          dish.restaurantName,
        city: dish.city,
        averageRating:
          dish.totalRating /
          dish.reviewCount,
        reviewCount:
          dish.reviewCount,
      }));

    if (userLocation) {
      const nearby =
        restaurantList
          .filter(
            (restaurant) =>
              restaurant.latitude !== null &&
              restaurant.longitude !== null
          )
          .map((restaurant) => {
            const distanceMiles =
              getDistanceMiles(
                userLocation.latitude,
                userLocation.longitude,
                restaurant.latitude!,
                restaurant.longitude!
              );

            return {
              ...restaurant,
              distanceMiles,
            };
          })
          .filter(
            (restaurant) =>
              restaurant.distanceMiles <= 25
          )
          .sort((a, b) => {
            if (
              b.averageRating !==
              a.averageRating
            ) {
              return (
                b.averageRating -
                a.averageRating
              );
            }

            if (
              b.reviewCount !==
              a.reviewCount
            ) {
              return (
                b.reviewCount -
                a.reviewCount
              );
            }

            return (
              a.distanceMiles -
              b.distanceMiles
            );
          })
          .slice(0, 5);

      setNearbyRestaurants(nearby);
    } else {
      setNearbyRestaurants([]);
    }

    const trendingByWeek = [
      ...weeklyRestaurantList,
    ]
      .sort((a, b) => {
        if (
          b.reviewCount !==
          a.reviewCount
        ) {
          return (
            b.reviewCount -
            a.reviewCount
          );
        }

        return (
          b.averageRating -
          a.averageRating
        );
      })
      .slice(0, 5);

    setTrendingRestaurants(
      trendingByWeek
    );

    const restaurantsByRating = [
      ...restaurantList,
    ].sort((a, b) => {
      if (
        b.averageRating !==
        a.averageRating
      ) {
        return (
          b.averageRating -
          a.averageRating
        );
      }

      return (
        b.reviewCount -
        a.reviewCount
      );
    });

    const dishesByRating = [
      ...dishList,
    ].sort((a, b) => {
      if (
        b.averageRating !==
        a.averageRating
      ) {
        return (
          b.averageRating -
          a.averageRating
        );
      }

      return (
        b.reviewCount -
        a.reviewCount
      );
    });

    const restaurantsByReviews = [
      ...restaurantList,
    ].sort(
      (a, b) =>
        b.reviewCount -
        a.reviewCount
    );

    const dishesByReviews = [
      ...dishList,
    ].sort(
      (a, b) =>
        b.reviewCount -
        a.reviewCount
    );

    setTopRestaurants(
      restaurantsByRating.slice(0, 5)
    );

    setTopDishes(
      dishesByRating.slice(0, 5)
    );

    setMostReviewedRestaurants(
      restaurantsByReviews.slice(0, 5)
    );

    setMostReviewedDishes(
      dishesByReviews.slice(0, 5)
    );

    setExploreLoading(false);
  }

  async function loadTags() {
    try {
      setAllTags(await fetchTags());
    } catch (error) {
      console.log('Could not load tags:', error);
    }
  }

  async function selectTag(slug: string | null) {
    setSelectedTag(slug);
    setTagDishes([]);

    if (!slug) {
      return;
    }

    setTagLoading(true);

    const { data, error } = await supabase.rpc(
      'top_dishes_by_tag',
      { p_tag: slug }
    );

    setTagLoading(false);

    if (error) {
      console.log('Top dishes by tag error:', error.message);
      return;
    }

    setTagDishes(
      (data ?? []).map(
        (row: {
          dish_id: string;
          name: string;
          restaurant_name: string;
          average_rating: number;
          review_count: number;
        }) => ({
          id: row.dish_id,
          name: row.name,
          restaurantName: row.restaurant_name,
          city: null,
          averageRating: Number(row.average_rating),
          reviewCount: row.review_count,
        })
      )
    );
  }

  function renderRankedDish(
    dish: ExploreDish,
    index: number
  ) {
    return (
      <TouchableOpacity
        key={dish.id}
        style={styles.rankingRow}
        onPress={() =>
          router.push({
            pathname: '/dish/[id]',
            params: {
              id: dish.id,
            },
          })
        }
      >
        <Text style={styles.rankNumber}>
          {index + 1}
        </Text>

        <View style={styles.rankingInfo}>
          <Text style={styles.rankingName}>
            {dish.name}
          </Text>

          <Text style={styles.rankingSubtext}>
            {dish.restaurantName}

            {dish.city ? ` · ${dish.city}` : ''}
          </Text>
        </View>

        <Text style={styles.rankingRating}>
          {dish.averageRating.toFixed(1)}★
        </Text>
      </TouchableOpacity>
    );
  }

  function clearResults() {
    setUserResults([]);
    setRestaurantResults([]);
    setDishResults([]);
  }

  async function handleSearch(text: string) {
    setQuery(text);

    const trimmed = text.trim();

    if (trimmed.length < 2) {
      clearResults();
      return;
    }

    await runSearch(
      trimmed,
      searchType
    );
  }

  async function changeSearchType(
    type: SearchType
  ) {
    setSearchType(type);

    const trimmed =
      query.trim();

    if (trimmed.length < 2) {
      clearResults();
      return;
    }

    await runSearch(
      trimmed,
      type
    );
  }

  async function runSearch(
    searchText: string,
    type: SearchType
  ) {
    setSearchLoading(true);

    if (type === 'users') {
      const { data, error } =
        await supabase
          .from('profiles')
          .select(
            'id, username, display_name, avatar_path'
          )
          .or(
            `username.ilike.%${searchText}%,display_name.ilike.%${searchText}%`
          )
          .limit(20);

      setSearchLoading(false);

      if (error) {
        Alert.alert(
          'Search error',
          error.message
        );

        return;
      }

      setUserResults(
        await withoutHiddenUsers(data ?? [], (result) => result.id)
      );
      setRestaurantResults([]);
      setDishResults([]);

      return;
    }

    if (type === 'restaurants') {
      const { data, error } =
        await supabase
          .from('restaurants')
          .select(
            'id, name, city, state'
          )
          .or(
            `name.ilike.%${searchText}%,city.ilike.%${searchText}%,state.ilike.%${searchText}%`
          )
          .limit(20);

      setSearchLoading(false);

      if (error) {
        Alert.alert(
          'Search error',
          error.message
        );

        return;
      }

      setRestaurantResults(
        data ?? []
      );

      setUserResults([]);
      setDishResults([]);

      return;
    }

    const { data, error } =
      await supabase
        .from('dishes')
        .select(`
          id,
          name,
          restaurants (
            id,
            name,
            city
          )
        `)
        .ilike(
          'name',
          `%${searchText}%`
        )
        .limit(20);

    setSearchLoading(false);

    if (error) {
      Alert.alert(
        'Search error',
        error.message
      );

      return;
    }

    setDishResults(
      (data ?? []) as unknown as
        DishResult[]
    );

    setUserResults([]);
    setRestaurantResults([]);
  }

  async function toggleFollow(
    profileId: string
  ) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      Alert.alert(
        'Error',
        'You must be signed in.'
      );

      return;
    }

    if (user.id === profileId) {
      Alert.alert(
        'Not allowed',
        'You cannot follow yourself.'
      );

      return;
    }

    const isFollowing =
      followingIds.includes(
        profileId
      );

    if (isFollowing) {
      const { error } =
        await supabase
          .from('follows')
          .delete()
          .eq(
            'follower_id',
            user.id
          )
          .eq(
            'following_id',
            profileId
          );

      if (error) {
        Alert.alert(
          'Unfollow error',
          error.message
        );

        return;
      }

      setFollowingIds(
        (current) =>
          current.filter(
            (id) =>
              id !== profileId
          )
      );

      return;
    }

    const { error } =
      await supabase
        .from('follows')
        .insert({
          follower_id:
            user.id,
          following_id:
            profileId,
        });

    if (error) {
      Alert.alert(
        'Follow error',
        error.message
      );

      return;
    }

    setFollowingIds(
      (current) => [
        ...current,
        profileId,
      ]
    );
  }

  function getPlaceholder() {
    if (searchType === 'users') {
      return 'Search username or name';
    }

    if (
      searchType ===
      'restaurants'
    ) {
      return 'Search restaurant or city';
    }

    return 'Search dish';
  }

  function getLocationText(
    city: string | null,
    state: string | null
  ) {
    return [city, state]
      .filter(Boolean)
      .join(', ');
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

  const isSearching =
    query.trim().length >= 2;

  return (
    <ScrollView
      contentContainerStyle={
        styles.container
      }
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>
        Discover
      </Text>

      <Text style={styles.subtitle}>
        Find people, restaurants, and dishes.
      </Text>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[
            styles.tab,
            searchType === 'users' &&
              styles.activeTab,
          ]}
          onPress={() =>
            changeSearchType('users')
          }
        >
          <Text
            style={[
              styles.tabText,
              searchType === 'users' &&
                styles.activeTabText,
            ]}
          >
            Users
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tab,
            searchType ===
              'restaurants' &&
              styles.activeTab,
          ]}
          onPress={() =>
            changeSearchType(
              'restaurants'
            )
          }
        >
          <Text
            style={[
              styles.tabText,
              searchType ===
                'restaurants' &&
                styles.activeTabText,
            ]}
          >
            Restaurants
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tab,
            searchType === 'dishes' &&
              styles.activeTab,
          ]}
          onPress={() =>
            changeSearchType('dishes')
          }
        >
          <Text
            style={[
              styles.tabText,
              searchType === 'dishes' &&
                styles.activeTabText,
            ]}
          >
            Dishes
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder={
          getPlaceholder()
        }
        placeholderTextColor={Palette.textMuted}
        autoCapitalize="none"
        value={query}
        onChangeText={handleSearch}
      />

      {searchLoading ? (
        <Text style={styles.statusText}>
          Searching...
        </Text>
      ) : null}

      {isSearching ? (
        <>
          {!searchLoading &&
          searchType === 'users' &&
          userResults.length === 0 ? (
            <Text style={styles.noResults}>
              No users found.
            </Text>
          ) : null}

          {!searchLoading &&
          searchType ===
            'restaurants' &&
          restaurantResults.length ===
            0 ? (
            <Text style={styles.noResults}>
              No restaurants found.
            </Text>
          ) : null}

          {!searchLoading &&
          searchType === 'dishes' &&
          dishResults.length === 0 ? (
            <Text style={styles.noResults}>
              No dishes found.
            </Text>
          ) : null}

          {searchType === 'users'
            ? userResults.map(
                (user) => {
                  const isOwnProfile =
                    user.id ===
                    currentUserId;

                  return (
                    <View
                      key={user.id}
                      style={
                        styles.resultRow
                      }
                    >
                      <TouchableOpacity
                        style={
                          styles.resultInfo
                        }
                        onPress={() => {
                          if (
                            isOwnProfile
                          ) {
                            router.push(
                              '/profile'
                            );
                          } else {
                            router.push({
                              pathname:
                                '/user/[id]',
                              params: {
                                id: user.id,
                              },
                            });
                          }
                        }}
                      >
                        {user.avatar_path ? (
                          <Image
                            source={{
                              uri: getProfilePhotoUrl(
                                user.avatar_path
                              ),
                            }}
                            style={
                              styles.avatarImage
                            }
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={
                              styles.avatar
                            }
                          >
                            <Text
                              style={
                                styles.avatarText
                              }
                            >
                              {(
                                user.display_name ||
                                user.username ||
                                'U'
                              )
                                .charAt(0)
                                .toUpperCase()}
                            </Text>
                          </View>
                        )}

                        <View
                          style={
                            styles.textArea
                          }
                        >
                          <Text
                            style={
                              styles.primaryText
                            }
                          >
                            {user.display_name ||
                              user.username}

                            {isOwnProfile
                              ? ' · You'
                              : ''}
                          </Text>

                          <Text
                            style={
                              styles.handleText
                            }
                          >
                            @{user.username}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {!isOwnProfile ? (
                        <TouchableOpacity
                          style={[
                            styles.followButton,
                            followingIds.includes(
                              user.id
                            ) &&
                              styles.followingButton,
                          ]}
                          onPress={() =>
                            toggleFollow(
                              user.id
                            )
                          }
                        >
                          <Text
                            style={[
                              styles.followButtonText,
                              followingIds.includes(
                                user.id
                              ) &&
                                styles.followingButtonText,
                            ]}
                          >
                            {followingIds.includes(
                              user.id
                            )
                              ? 'Following'
                              : 'Follow'}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                }
              )
            : null}

          {searchType ===
          'restaurants'
            ? restaurantResults.map(
                (restaurant) => {
                  const location =
                    getLocationText(
                      restaurant.city,
                      restaurant.state
                    );

                  return (
                    <TouchableOpacity
                      key={
                        restaurant.id
                      }
                      style={
                        styles.simpleResultRow
                      }
                      onPress={() =>
                        router.push({
                          pathname:
                            '/restaurant/[id]',
                          params: {
                            id: restaurant.id,
                          },
                        })
                      }
                    >
                      <View
                        style={
                          styles.iconCircle
                        }
                      >
                        <Text
                          style={
                            styles.iconText
                          }
                        >
                          🍽️
                        </Text>
                      </View>

                      <View
                        style={
                          styles.textArea
                        }
                      >
                        <Text
                          style={
                            styles.primaryText
                          }
                        >
                          {restaurant.name}
                        </Text>

                        {location ? (
                          <Text
                            style={
                              styles.secondaryText
                            }
                          >
                            {location}
                          </Text>
                        ) : null}
                      </View>

                      <Text style={styles.chevron}>
                        ›
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )
            : null}

          {searchType === 'dishes'
            ? dishResults.map(
                (dish) => (
                  <TouchableOpacity
                    key={dish.id}
                    style={
                      styles.simpleResultRow
                    }
                    onPress={() =>
                      router.push({
                        pathname:
                          '/dish/[id]',
                        params: {
                          id: dish.id,
                        },
                      })
                    }
                  >
                    <View
                      style={
                        styles.iconCircle
                      }
                    >
                      <Text
                        style={
                          styles.iconText
                        }
                      >
                        🍴
                      </Text>
                    </View>

                    <View
                      style={
                        styles.textArea
                      }
                    >
                      <Text
                        style={
                          styles.primaryText
                        }
                      >
                        {dish.name}
                      </Text>

                      <Text
                        style={
                          styles.secondaryText
                        }
                      >
                        {dish.restaurants
                          ?.name ??
                          'Unknown restaurant'}

                        {dish.restaurants
                          ?.city
                          ? ` · ${dish.restaurants.city}`
                          : ''}
                      </Text>
                    </View>

                    <Text style={styles.chevron}>
                      ›
                    </Text>
                  </TouchableOpacity>
                )
              )
            : null}
        </>
      ) : (
        <View style={styles.exploreArea}>
          <Text style={styles.exploreTitle}>
            Explore
          </Text>

          {exploreLoading ? (
            <ActivityIndicator
              size="small"
              style={styles.exploreLoader}
            />
          ) : (
            <>
              <View style={styles.nearbyHeader}>
                <View>
                  <Text style={styles.sectionTitle}>
                    Top Near You
                  </Text>

                  <Text
                    style={styles.sectionSubtitle}
                  >
                    Within 25 miles
                  </Text>
                </View>
              </View>

              {!locationAllowed ? (
                <View style={styles.locationMessage}>
                  <Text
                    style={
                      styles.locationMessageTitle
                    }
                  >
                    Location unavailable
                  </Text>

                  <Text
                    style={
                      styles.locationMessageText
                    }
                  >
                    Allow location access to see
                    restaurants near you.
                  </Text>
                </View>
              ) : nearbyRestaurants.length === 0 ? (
                <View style={styles.locationMessage}>
                  <Text
                    style={
                      styles.locationMessageTitle
                    }
                  >
                    No nearby restaurants yet
                  </Text>

                  <Text
                    style={
                      styles.locationMessageText
                    }
                  >
                    Restaurants need saved coordinates
                    before they can appear here.
                  </Text>
                </View>
              ) : (
                nearbyRestaurants.map(
                  (restaurant, index) => (
                    <TouchableOpacity
                      key={restaurant.id}
                      style={styles.rankingRow}
                      onPress={() =>
                        router.push({
                          pathname:
                            '/restaurant/[id]',
                          params: {
                            id: restaurant.id,
                          },
                        })
                      }
                    >
                      <Text style={styles.rankNumber}>
                        {index + 1}
                      </Text>

                      <View
                        style={styles.rankingInfo}
                      >
                        <Text
                          style={styles.rankingName}
                        >
                          {restaurant.name}
                        </Text>

                        <Text
                          style={
                            styles.rankingSubtext
                          }
                        >
                          {getLocationText(
                            restaurant.city,
                            restaurant.state
                          ) || 'Location unknown'}

                          {' · '}

                          {restaurant.distanceMiles <
                          0.1
                            ? '<0.1'
                            : restaurant.distanceMiles.toFixed(
                                1
                              )}{' '}
                          mi away
                        </Text>
                      </View>

                      <View
                        style={
                          styles.nearbyRatingArea
                        }
                      >
                        <Text
                          style={
                            styles.rankingRating
                          }
                        >
                          {restaurant.averageRating.toFixed(
                            1
                          )}
                          ★
                        </Text>

                        <Text
                          style={
                            styles.nearbyReviewCount
                          }
                        >
                          {restaurant.reviewCount}{' '}
                          {restaurant.reviewCount ===
                          1
                            ? 'review'
                            : 'reviews'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )
                )
              )}

              <View
                style={styles.trendingHeader}
              >
                <Text style={styles.sectionTitle}>
                  Trending This Week
                </Text>

                <Text
                  style={styles.sectionSubtitle}
                >
                  Most activity in the last 7 days
                </Text>
              </View>

              {trendingRestaurants.length === 0 ? (
                <View style={styles.locationMessage}>
                  <Text
                    style={
                      styles.locationMessageTitle
                    }
                  >
                    Nothing trending yet
                  </Text>

                  <Text
                    style={
                      styles.locationMessageText
                    }
                  >
                    Restaurants will appear here as new
                    reviews are logged this week.
                  </Text>
                </View>
              ) : (
                trendingRestaurants.map(
                  (restaurant, index) => (
                    <TouchableOpacity
                      key={restaurant.id}
                      style={styles.rankingRow}
                      onPress={() =>
                        router.push({
                          pathname:
                            '/restaurant/[id]',
                          params: {
                            id: restaurant.id,
                          },
                        })
                      }
                    >
                      <Text style={styles.rankNumber}>
                        {index + 1}
                      </Text>

                      <View
                        style={styles.rankingInfo}
                      >
                        <Text
                          style={styles.rankingName}
                        >
                          {restaurant.name}
                        </Text>

                        <Text
                          style={
                            styles.rankingSubtext
                          }
                        >
                          {getLocationText(
                            restaurant.city,
                            restaurant.state
                          ) || 'Location unknown'}
                        </Text>
                      </View>

                      <View
                        style={
                          styles.nearbyRatingArea
                        }
                      >
                        <Text
                          style={
                            styles.rankingRating
                          }
                        >
                          {restaurant.averageRating.toFixed(
                            1
                          )}
                          ★
                        </Text>

                        <Text
                          style={
                            styles.nearbyReviewCount
                          }
                        >
                          {restaurant.reviewCount}{' '}
                          {restaurant.reviewCount ===
                          1
                            ? 'review this week'
                            : 'reviews this week'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )
                )
              )}

              <Text
                style={[
                  styles.sectionTitle,
                  styles.sectionSpacing,
                ]}
              >
                Top Rated Restaurants
              </Text>

              {topRestaurants.map(
                (restaurant, index) => (
                  <TouchableOpacity
                    key={restaurant.id}
                    style={styles.rankingRow}
                    onPress={() =>
                      router.push({
                        pathname:
                          '/restaurant/[id]',
                        params: {
                          id: restaurant.id,
                        },
                      })
                    }
                  >
                    <Text style={styles.rankNumber}>
                      {index + 1}
                    </Text>

                    <View
                      style={styles.rankingInfo}
                    >
                      <Text
                        style={styles.rankingName}
                      >
                        {restaurant.name}
                      </Text>

                      <Text
                        style={
                          styles.rankingSubtext
                        }
                      >
                        {getLocationText(
                          restaurant.city,
                          restaurant.state
                        )
                          ? `${getLocationText(
                              restaurant.city,
                              restaurant.state
                            )} · `
                          : ''}

                        {restaurant.reviewCount}{' '}
                        {restaurant.reviewCount === 1
                          ? 'review'
                          : 'reviews'}
                      </Text>
                    </View>

                    <Text
                      style={styles.rankingRating}
                    >
                      {restaurant.averageRating.toFixed(
                        1
                      )}
                      ★
                    </Text>
                  </TouchableOpacity>
                )
              )}

              <Text
                style={[
                  styles.sectionTitle,
                  styles.sectionSpacing,
                ]}
              >
                Top Rated Dishes
              </Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tagChips}
              >
                {[{ slug: null, label: 'All' }, ...allTags].map(
                  (tag) => {
                    const selected = tag.slug === selectedTag;

                    return (
                      <TouchableOpacity
                        key={tag.slug ?? 'all'}
                        style={[
                          styles.tagChip,
                          selected && styles.tagChipSelected,
                        ]}
                        onPress={() => selectTag(tag.slug)}
                      >
                        <Text
                          style={[
                            styles.tagChipText,
                            selected &&
                              styles.tagChipTextSelected,
                          ]}
                        >
                          {tag.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                )}
              </ScrollView>

              {!selectedTag ? (
                topDishes.map(renderRankedDish)
              ) : tagLoading ? (
                <ActivityIndicator style={styles.tagLoading} />
              ) : tagDishes.length > 0 ? (
                tagDishes.map(renderRankedDish)
              ) : (
                <Text style={styles.tagEmptyText}>
                  No top dishes here yet. A tag shows up once two
                  people tag the same dish.
                </Text>
              )}

              <Text
                style={[
                  styles.sectionTitle,
                  styles.sectionSpacing,
                ]}
              >
                Most Reviewed Restaurants
              </Text>

              {mostReviewedRestaurants.map(
                (restaurant, index) => (
                  <TouchableOpacity
                    key={restaurant.id}
                    style={styles.rankingRow}
                    onPress={() =>
                      router.push({
                        pathname:
                          '/restaurant/[id]',
                        params: {
                          id: restaurant.id,
                        },
                      })
                    }
                  >
                    <Text style={styles.rankNumber}>
                      {index + 1}
                    </Text>

                    <View
                      style={styles.rankingInfo}
                    >
                      <Text
                        style={styles.rankingName}
                      >
                        {restaurant.name}
                      </Text>

                      <Text
                        style={
                          styles.rankingSubtext
                        }
                      >
                        {getLocationText(
                          restaurant.city,
                          restaurant.state
                        ) || 'Location unknown'}
                      </Text>
                    </View>

                    <Text style={styles.reviewCount}>
                      {restaurant.reviewCount}{' '}
                      {restaurant.reviewCount === 1
                        ? 'review'
                        : 'reviews'}
                    </Text>
                  </TouchableOpacity>
                )
              )}

              <Text
                style={[
                  styles.sectionTitle,
                  styles.sectionSpacing,
                ]}
              >
                Most Reviewed Dishes
              </Text>

              {mostReviewedDishes.map(
                (dish, index) => (
                  <TouchableOpacity
                    key={dish.id}
                    style={styles.rankingRow}
                    onPress={() =>
                      router.push({
                        pathname:
                          '/dish/[id]',
                        params: {
                          id: dish.id,
                        },
                      })
                    }
                  >
                    <Text style={styles.rankNumber}>
                      {index + 1}
                    </Text>

                    <View
                      style={styles.rankingInfo}
                    >
                      <Text
                        style={styles.rankingName}
                      >
                        {dish.name}
                      </Text>

                      <Text
                        style={
                          styles.rankingSubtext
                        }
                      >
                        {dish.restaurantName}
                      </Text>
                    </View>

                    <Text style={styles.reviewCount}>
                      {dish.reviewCount}{' '}
                      {dish.reviewCount === 1
                        ? 'review'
                        : 'reviews'}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 60,
    backgroundColor: Palette.background,
  },

  title: {
    color: Palette.text,
    fontSize: 30,
    fontWeight: '700',
  },

  subtitle: {
    fontSize: 16,
    color: Palette.textSecondary,
    marginTop: 8,
    marginBottom: 20,
  },

  tabs: {
    flexDirection: 'row',
    backgroundColor: Palette.surface,
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },

  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },

  activeTab: {
    backgroundColor: Palette.accent,
  },

  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },

  activeTabText: {
    color: Palette.text,
  },

  input: {
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: Palette.text,
    marginBottom: 12,
  },

  statusText: {
    fontSize: 14,
    color: Palette.textMuted,
    marginBottom: 10,
  },

  noResults: {
    fontSize: 14,
    color: Palette.textMuted,
    marginTop: 8,
  },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },

  resultInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 14,
  },

  simpleResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },

  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Palette.elevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Palette.elevated,
    marginRight: 12,
  },

  avatarText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },

  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Palette.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  iconText: {
    color: Palette.text,
    fontSize: 18,
  },

  textArea: {
    flex: 1,
  },

  primaryText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },

  handleText: {
    color: Palette.accent,
    fontSize: 13,
    marginTop: 3,
  },

  secondaryText: {
    fontSize: 13,
    color: Palette.textSecondary,
    marginTop: 3,
  },

  chevron: {
    fontSize: 24,
    color: Palette.textMuted,
    marginLeft: 10,
  },

  followButton: {
    backgroundColor: Palette.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },

  followButtonText: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '600',
  },

  followingButton: {
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
  },

  followingButtonText: {
    color: Palette.text,
  },

  exploreArea: {
    marginTop: 18,
  },

  exploreTitle: {
    color: Palette.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 22,
  },

  exploreLoader: {
    marginTop: 20,
  },

  nearbyHeader: {
    marginBottom: 8,
  },

  trendingHeader: {
    marginTop: 30,
    marginBottom: 8,
  },

  sectionTitle: {
    color: Palette.text,
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 3,
  },

  sectionSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
  },

  sectionSpacing: {
    marginTop: 30,
  },

  locationMessage: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },

  locationMessageTitle: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '700',
  },

  locationMessageText: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },

  tagChips: {
    gap: 8,
    paddingBottom: 12,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
  },
  tagChipSelected: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  tagChipTextSelected: {
    color: Palette.text,
  },
  tagLoading: {
    marginVertical: 16,
  },
  tagEmptyText: {
    fontSize: 14,
    color: Palette.textMuted,
    lineHeight: 20,
    paddingVertical: 8,
  },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },

  rankNumber: {
    width: 28,
    fontSize: 16,
    fontWeight: '700',
    color: Palette.textMuted,
  },

  rankingInfo: {
    flex: 1,
    paddingRight: 12,
  },

  rankingName: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },

  rankingSubtext: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 3,
  },

  rankingRating: {
    color: Palette.accent,
    fontSize: 15,
    fontWeight: '700',
  },

  nearbyRatingArea: {
    alignItems: 'flex-end',
  },

  nearbyReviewCount: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 3,
  },

  reviewCount: {
    fontSize: 13,
    color: Palette.textSecondary,
    fontWeight: '600',
  },
});