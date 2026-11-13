import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchCoverPhotos } from '@/components/cover-photos';
import { PhotoCard, PhotoCardRow } from '@/components/photo-card-row';
import { MapRestaurant, RestaurantMap } from '@/components/restaurant-map';
import { Palette } from '@/constants/theme';
import {
  createSessionToken,
  findOrCreateGoogleRestaurant,
  GooglePlaceSuggestion,
  searchGoogleFoodPlaces,
} from '@/lib/google-places';
import { withFlag } from '@/lib/countries';
import { withoutHiddenUsers } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';
import { fetchTags, Tag } from '@/lib/tags';

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
  google_place_id: string | null;
  country_code: string | null;
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

type ExploreReview = {
  rating: number;
  created_at: string;
  photo_path: string | null;
  dishes: {
    id: string;
    name: string;
    name_key: string;
    restaurants: {
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      latitude: number | null;
      longitude: number | null;
      brand_id: string | null;
      brands: { name: string } | null;
    } | null;
  } | null;
};

// Ratings and the best photo of one restaurant location, one restaurant
// (all locations of a brand), or one dish.
type Stats = {
  id: string;
  name: string;
  subtitle: string;
  count: number;
  total: number;
  weekCount: number;
  photoPath: string | null;
  photoRating: number;
  // Locations only.
  latitude: number | null;
  longitude: number | null;
  // Restaurants only: how many locations were reviewed, and the most
  // reviewed one, which cards link to.
  locations: Set<string>;
  topLocationCounts: Map<string, number>;
};

type Ranked = Stats & { averageRating: number; score: number };

type NearbySpot = Ranked & { distanceMiles: number };

type FriendReview = {
  id: string;
  rating: number;
  photo_path: string | null;
  user_id: string;
  dish_id: string;
  profiles: { username: string; display_name: string | null } | null;
  dishes: {
    name: string;
    cover_review_id: string | null;
    restaurants: { name: string; brands: { name: string } | null } | null;
  } | null;
};

type PopularReview = FriendReview & {
  created_at: string;
  review_reactions: { count: number }[];
  review_comments: { count: number }[];
};

// Someone's rating of a restaurant with something written about it.
type RestaurantReviewCard = {
  id: string;
  user_id: string;
  rating: number;
  notes: string;
  restaurantId: string;
  restaurantName: string;
  authorName: string;
};

type TagDish = {
  dish_id: string;
  name: string;
  restaurant_name: string;
  average_rating: number;
  review_count: number;
};

// Coming back to Discover within this long shows what's already loaded.
// Pull to refresh reloads anytime.
const FRESH_FOR_MS = 5 * 60 * 1000;

// Where a reload comes from. Only the first load and the location prompt
// ask for location permission; only pull to refresh waits for a fresh GPS
// fix.
type LoadReason = 'focus' | 'refresh' | 'ask-location';

// Reviews Discover is built from, newest first.
const REVIEW_SAMPLE = 1000;

// Popular posts come from this many days back, ranked by likes and comments.
const POPULAR_DAYS = 7;
const POPULAR_SAMPLE = 200;

// Restaurant reviews come from this many days back.
const RESTAURANT_REVIEW_DAYS = 30;

const ROW_COUNT = 10;

const NEARBY_MILES = 25;

// Each average starts with this many imaginary reviews at the app-wide
// average, so one 5-star review can't top a list.
const RANKING_PRIOR = 3;

const TAG_EMOJI: Record<string, string> = {
  burger: '🍔',
  sandwich: '🥪',
  pizza: '🍕',
  mexican: '🌮',
  sushi: '🍣',
  pasta: '🍝',
  noodles: '🍜',
  chicken: '🍗',
  wings: '🔥',
  seafood: '🦐',
  steak: '🥩',
  bbq: '🍖',
  salad: '🥗',
  soup: '🍲',
  breakfast: '🥞',
  side: '🍟',
  appetizer: '🥟',
  dessert: '🍰',
  'coffee-tea': '☕',
  drink: '🥤',
  'alcoholic-drink': '🍹',
  'gluten-free': '🌾',
  'gluten-friendly': '🌾',
  'dairy-free': '🥛',
  vegetarian: '🥦',
  vegan: '🌱',
};

function getDistanceMiles(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
) {
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);
  const latitudeDifference = toRadians(to.latitude - from.latitude);
  const longitudeDifference = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(longitudeDifference / 2) ** 2;

  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function locationText(city: string | null, state: string | null) {
  return [city, state].filter(Boolean).join(', ');
}

// A "contains" pattern for an or() filter. Quoting keeps commas and
// parentheses in the search from breaking the filter.
function containsPattern(text: string) {
  return `"%${text.replace(/["\\]/g, '\\$&')}%"`;
}

function reviewsText(count: number) {
  return `${count} ${count === 1 ? 'review' : 'reviews'}`;
}

function addReview(
  map: Map<string, Stats>,
  key: string,
  base: () => Omit<
    Stats,
    | 'count'
    | 'total'
    | 'weekCount'
    | 'photoPath'
    | 'photoRating'
    | 'locations'
    | 'topLocationCounts'
  >,
  review: ExploreReview,
  locationId: string,
  isThisWeek: boolean
) {
  let stats = map.get(key);

  if (!stats) {
    stats = {
      ...base(),
      count: 0,
      total: 0,
      weekCount: 0,
      photoPath: null,
      photoRating: -1,
      locations: new Set(),
      topLocationCounts: new Map(),
    };
    map.set(key, stats);
  }

  const rating = Number(review.rating);
  stats.count += 1;
  stats.total += rating;
  if (isThisWeek) stats.weekCount += 1;
  stats.locations.add(locationId);
  stats.topLocationCounts.set(
    locationId,
    (stats.topLocationCounts.get(locationId) ?? 0) + 1
  );

  // The highest-rated photo; ties go to the newest (reviews come newest
  // first).
  if (review.photo_path && rating > stats.photoRating) {
    stats.photoPath = review.photo_path;
    stats.photoRating = rating;
  }
}

function rank(map: Map<string, Stats>, mean: number): Ranked[] {
  return [...map.values()].map((stats) => ({
    ...stats,
    averageRating: stats.total / stats.count,
    score: (stats.total + RANKING_PRIOR * mean) / (stats.count + RANKING_PRIOR),
  }));
}

// The location of a restaurant with the most reviews.
function topLocation(stats: Stats) {
  return [...stats.topLocationCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<'list' | 'map'>('list');

  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('restaurants');
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [restaurantResults, setRestaurantResults] = useState<RestaurantResult[]>([]);
  const [dishResults, setDishResults] = useState<DishResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  // Food places on Google that aren't on Wotri yet; tapping one adds it and
  // opens its page.
  const [googlePlaces, setGooglePlaces] = useState<GooglePlaceSuggestion[]>([]);
  const [googleSearching, setGoogleSearching] = useState(false);
  const [openingPlaceId, setOpeningPlaceId] = useState<string | null>(null);
  const googleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const googleSession = useRef<string | null>(null);
  // Bumped by each search, so slow, older results never replace newer ones.
  const searchVersion = useRef(0);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [followingIds, setFollowingIds] = useState<string[]>([]);

  const [exploreLoading, setExploreLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [nearby, setNearby] = useState<NearbySpot[]>([]);
  const [mapRestaurants, setMapRestaurants] = useState<MapRestaurant[]>([]);
  const [friendReviews, setFriendReviews] = useState<FriendReview[]>([]);
  const [popularReviews, setPopularReviews] = useState<PopularReview[]>([]);
  const [restaurantReviews, setRestaurantReviews] = useState<
    RestaurantReviewCard[]
  >([]);
  const [trending, setTrending] = useState<Ranked[]>([]);
  const [topDishes, setTopDishes] = useState<Ranked[]>([]);
  const [hiddenGems, setHiddenGems] = useState<Ranked[]>([]);
  const [topRestaurants, setTopRestaurants] = useState<Ranked[]>([]);

  const [categories, setCategories] = useState<Tag[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagDishes, setTagDishes] = useState<PhotoCard[]>([]);
  const [tagLoading, setTagLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // When Discover last finished loading (0 = never), and whether we've
  // asked for location this session.
  const loadedAt = useRef(0);
  const askedForLocation = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (Date.now() - loadedAt.current > FRESH_FOR_MS) {
        loadExplore('focus');
      } else {
        // Follows made elsewhere (like on a profile) show on the buttons.
        loadFollowingIds();
      }

      fetchTags()
        .then((tags) =>
          setCategories(
            tags.filter((tag) => tag.kind === 'food' || tag.kind === 'dietary')
          )
        )
        .catch((error) => console.log('Could not load tags:', error));
    }, [])
  );

  async function getUserLocation(reason: LoadReason) {
    try {
      const permission =
        reason === 'focus' && askedForLocation.current
          ? await Location.getForegroundPermissionsAsync()
          : await Location.requestForegroundPermissionsAsync();
      askedForLocation.current = true;

      if (!permission.granted) {
        return null;
      }

      // A recent position the phone already has costs no GPS time.
      const recent =
        reason === 'refresh'
          ? null
          : await Location.getLastKnownPositionAsync({ maxAge: FRESH_FOR_MS });

      const location =
        recent ??
        (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }));

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
    } catch (error) {
      console.log('Discover location error:', error);
      return null;
    }
  }

  async function fetchFollowingIds(userId: string) {
    const { data: followData } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    return (followData ?? []).map((row) => row.following_id as string);
  }

  async function loadFollowingIds() {
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) setFollowingIds(await fetchFollowingIds(auth.user.id));
  }

  async function loadFriendReviews(userId: string) {
    const ids = await fetchFollowingIds(userId);
    setFollowingIds(ids);

    if (ids.length === 0) {
      setFriendReviews([]);
      return;
    }

    const { data, error } = await supabase
      .from('reviews')
      .select(`
        id,
        rating,
        photo_path,
        user_id,
        dish_id,
        profiles:user_id (username, display_name),
        dishes (name, cover_review_id, restaurants (name, brands (name)))
      `)
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(ROW_COUNT * 2);

    if (error) {
      console.log('Friend reviews error:', error.message);
      return;
    }

    const visible = await withDishPhotos(
      await withoutHiddenUsers(
        (data ?? []) as unknown as FriendReview[],
        (review) => review.user_id
      )
    );

    // Reviews with photos first; it's a photo row.
    setFriendReviews(
      [...visible]
        .sort((a, b) => Number(Boolean(b.photo_path)) - Number(Boolean(a.photo_path)))
        .slice(0, ROW_COUNT)
    );
  }

  // Everyone's posts from the past week, most liked and commented first
  // (a comment counts double), photos ahead of the rest.
  async function loadPopularReviews() {
    const since = new Date(
      Date.now() - POPULAR_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
      .from('reviews')
      .select(`
        id,
        rating,
        photo_path,
        user_id,
        dish_id,
        created_at,
        profiles:user_id (username, display_name),
        dishes (name, cover_review_id, restaurants (name, brands (name))),
        review_reactions (count),
        review_comments (count)
      `)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(POPULAR_SAMPLE);

    if (error) {
      console.log('Popular reviews error:', error.message);
      return;
    }

    const visible = await withoutHiddenUsers(
      (data ?? []) as unknown as PopularReview[],
      (review) => review.user_id
    );

    const score = (review: PopularReview) =>
      (review.review_reactions[0]?.count ?? 0) +
      2 * (review.review_comments[0]?.count ?? 0);

    // The most popular few get their dish's photo if they have none.
    // Sorting is stable, so ties stay newest first.
    const top = await withDishPhotos(
      [...visible].sort((a, b) => score(b) - score(a)).slice(0, ROW_COUNT * 2)
    );

    setPopularReviews(
      top
        .sort(
          (a, b) =>
            Number(Boolean(b.photo_path)) - Number(Boolean(a.photo_path)) ||
            score(b) - score(a)
        )
        .slice(0, ROW_COUNT)
    );
  }

  // A review without a photo shows its dish's photo instead: the pinned
  // cover, or the best one (the cover_photos() pick, which favors likes).
  async function withDishPhotos<T extends FriendReview>(reviews: T[]) {
    const pinnedByDish = new Map<string, string | null>();

    for (const review of reviews) {
      if (!review.photo_path && review.dish_id) {
        pinnedByDish.set(review.dish_id, review.dishes?.cover_review_id ?? null);
      }
    }

    const photoByDish = new Map<string, string>();

    await Promise.all(
      [...pinnedByDish].map(async ([dishId, pinnedReviewId]) => {
        const [cover] = await fetchCoverPhotos([dishId], pinnedReviewId);
        if (cover) photoByDish.set(dishId, cover.photo_path);
      })
    );

    return reviews.map((review) =>
      review.photo_path || !photoByDish.has(review.dish_id)
        ? review
        : { ...review, photo_path: photoByDish.get(review.dish_id)! }
    );
  }

  // Recent restaurant ratings that say something, newest first. A brand-wide
  // rating links to one of the brand's locations.
  async function loadRestaurantReviews() {
    const since = new Date(
      Date.now() - RESTAURANT_REVIEW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
      .from('restaurant_ratings')
      .select(
        'id, user_id, rating, notes, restaurant_id, brand_id, restaurants (name, brands (name))'
      )
      .not('notes', 'is', null)
      .not('rating', 'is', null)
      .gte('visited_at', since)
      .order('visited_at', { ascending: false })
      .limit(40);

    if (error) {
      console.log('Restaurant reviews error:', error.message);
      return;
    }

    type Row = {
      id: string;
      user_id: string;
      rating: number;
      notes: string;
      restaurant_id: string | null;
      brand_id: string | null;
      restaurants: { name: string; brands: { name: string } | null } | null;
    };

    const rows = (await withoutHiddenUsers(
      (data ?? []) as unknown as Row[],
      (row) => row.user_id
    )).filter((row) => row.notes.trim());

    const brandIds = [
      ...new Set(
        rows.filter((row) => !row.restaurant_id).map((row) => row.brand_id!)
      ),
    ];
    const userIds = [...new Set(rows.map((row) => row.user_id))];

    const [{ data: brands }, { data: brandLocations }, { data: profiles }] =
      await Promise.all([
        brandIds.length
          ? supabase.from('brands').select('id, name').in('id', brandIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        brandIds.length
          ? supabase.from('restaurants').select('id, brand_id').in('brand_id', brandIds)
          : Promise.resolve({ data: [] as { id: string; brand_id: string }[] }),
        userIds.length
          ? supabase
              .from('profiles')
              .select('id, username, display_name')
              .in('id', userIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                username: string;
                display_name: string | null;
              }[],
            }),
      ]);

    const brandName = new Map((brands ?? []).map((brand) => [brand.id, brand.name]));
    const brandLocation = new Map(
      (brandLocations ?? []).map((location) => [location.brand_id, location.id])
    );
    const authorName = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        profile.display_name || profile.username,
      ])
    );

    setRestaurantReviews(
      rows.flatMap((row) => {
        const restaurantId =
          row.restaurant_id ?? brandLocation.get(row.brand_id ?? '');
        if (!restaurantId) return [];

        return [
          {
            id: row.id,
            user_id: row.user_id,
            rating: Number(row.rating),
            notes: row.notes.trim(),
            restaurantId,
            restaurantName: row.restaurant_id
              ? (row.restaurants?.brands?.name ?? row.restaurants?.name ?? '')
              : (brandName.get(row.brand_id ?? '') ?? ''),
            authorName: authorName.get(row.user_id) ?? 'Someone',
          },
        ];
      })
    );
  }

  // The first load shows a spinner; later ones keep showing the old content
  // until the new one is ready.
  async function loadExplore(reason: LoadReason) {
    if (loadedAt.current === 0) {
      setExploreLoading(true);
    }

    const [location, { data: auth }] = await Promise.all([
      getUserLocation(reason),
      supabase.auth.getUser(),
    ]);

    setUserLocation(location);
    setCurrentUserId(auth.user?.id ?? null);

    if (auth.user) {
      loadFriendReviews(auth.user.id);
    }
    loadPopularReviews();
    loadRestaurantReviews();

    const { data, error } = await supabase
      .from('reviews')
      .select(`
        rating,
        created_at,
        photo_path,
        dishes (
          id,
          name,
          name_key,
          restaurants (
            id,
            name,
            city,
            state,
            latitude,
            longitude,
            brand_id,
            brands (name)
          )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(REVIEW_SAMPLE);

    if (error) {
      setExploreLoading(false);
      console.log('Explore load error:', error.message);
      return;
    }

    const reviews = (data ?? []) as unknown as ExploreReview[];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Locations (for nearby and the map), restaurants pooled by brand (for
    // the lists, like the restaurant page), and dishes pooled the same way.
    const locations = new Map<string, Stats>();
    const restaurants = new Map<string, Stats>();
    const dishes = new Map<string, Stats>();
    let total = 0;

    for (const review of reviews) {
      const dish = review.dishes;
      const restaurant = dish?.restaurants;
      if (!dish || !restaurant) continue;

      total += Number(review.rating);
      const isThisWeek = new Date(review.created_at).getTime() >= weekAgo;
      const name = restaurant.brands?.name ?? restaurant.name;
      const groupKey = restaurant.brand_id ?? restaurant.id;

      addReview(
        locations,
        restaurant.id,
        () => ({
          id: restaurant.id,
          name,
          subtitle: locationText(restaurant.city, restaurant.state),
          latitude: restaurant.latitude === null ? null : Number(restaurant.latitude),
          longitude: restaurant.longitude === null ? null : Number(restaurant.longitude),
        }),
        review,
        restaurant.id,
        isThisWeek
      );

      addReview(
        restaurants,
        groupKey,
        () => ({
          id: restaurant.id,
          name,
          subtitle: locationText(restaurant.city, restaurant.state),
          latitude: null,
          longitude: null,
        }),
        review,
        restaurant.id,
        isThisWeek
      );

      addReview(
        dishes,
        `${groupKey}:${dish.name_key}`,
        () => ({
          id: dish.id,
          name: dish.name,
          subtitle: name,
          latitude: null,
          longitude: null,
        }),
        review,
        dish.id,
        isThisWeek
      );
    }

    const mean = reviews.length > 0 ? total / reviews.length : 3;
    const byScore = (a: Ranked, b: Ranked) => b.score - a.score || b.count - a.count;

    // Restaurant cards link to their most reviewed location; chains say how
    // many locations people reviewed instead of a city.
    const rankedRestaurants = rank(restaurants, mean).map((stats) => ({
      ...stats,
      id: topLocation(stats),
      subtitle:
        stats.locations.size > 1
          ? `${stats.locations.size} locations`
          : stats.subtitle,
    }));
    const rankedLocations = rank(locations, mean).filter(
      (stats) => stats.latitude !== null && stats.longitude !== null
    );
    const rankedDishes = rank(dishes, mean).map((stats) => ({
      ...stats,
      id: topLocation(stats),
    }));

    setMapRestaurants(
      rankedLocations.map((stats) => ({
        id: stats.id,
        name: stats.name,
        latitude: stats.latitude!,
        longitude: stats.longitude!,
        rating: stats.averageRating,
        meta: reviewsText(stats.count),
        subtitle: stats.subtitle,
        photoPath: stats.photoPath,
      }))
    );

    setNearby(
      location
        ? rankedLocations
            .map((stats) => ({
              ...stats,
              distanceMiles: getDistanceMiles(location, {
                latitude: stats.latitude!,
                longitude: stats.longitude!,
              }),
            }))
            .filter((stats) => stats.distanceMiles <= NEARBY_MILES)
            .sort(byScore)
            .slice(0, ROW_COUNT)
        : []
    );

    const top = [...rankedRestaurants].sort(byScore);
    setTopRestaurants(top.slice(0, ROW_COUNT));

    setTrending(
      rankedRestaurants
        .filter((stats) => stats.weekCount > 0)
        .sort((a, b) => b.weekCount - a.weekCount || byScore(a, b))
        .slice(0, ROW_COUNT)
    );

    // Loved by the few who've been: well rated, not many reviews yet, and
    // not already in Top restaurants.
    const topIds = new Set(top.slice(0, ROW_COUNT).map((stats) => stats.id));
    setHiddenGems(
      rankedRestaurants
        .filter(
          (stats) =>
            stats.count >= 2 &&
            stats.count <= 8 &&
            stats.averageRating >= 4 &&
            !topIds.has(stats.id)
        )
        .sort((a, b) => b.averageRating - a.averageRating)
        .slice(0, ROW_COUNT)
    );

    setTopDishes([...rankedDishes].sort(byScore).slice(0, ROW_COUNT));

    loadedAt.current = Date.now();
    setExploreLoading(false);
  }

  async function selectTag(slug: string) {
    if (slug === selectedTag) {
      setSelectedTag(null);
      return;
    }

    setSelectedTag(slug);
    setTagDishes([]);
    setTagLoading(true);

    const { data, error } = await supabase.rpc('top_dishes_by_tag', {
      p_tag: slug,
    });

    if (error) {
      setTagLoading(false);
      console.log('Top dishes by tag error:', error.message);
      return;
    }

    const rows = (data ?? []) as TagDish[];

    // The best photo of each dish.
    const { data: photoData } =
      rows.length > 0
        ? await supabase
            .from('reviews')
            .select('dish_id, photo_path')
            .in(
              'dish_id',
              rows.map((row) => row.dish_id)
            )
            .not('photo_path', 'is', null)
            .order('rating', { ascending: false })
        : { data: [] };

    const photoByDish = new Map<string, string>();
    for (const row of photoData ?? []) {
      if (!photoByDish.has(row.dish_id as string)) {
        photoByDish.set(row.dish_id as string, row.photo_path as string);
      }
    }

    setTagDishes(
      rows.map((row, index) => ({
        key: row.dish_id,
        title: row.name,
        subtitle: row.restaurant_name,
        rating: Number(row.average_rating),
        meta: reviewsText(row.review_count),
        photoPath: photoByDish.get(row.dish_id) ?? null,
        badge: `#${index + 1}`,
        onPress: () =>
          router.push({ pathname: '/dish/[id]', params: { id: row.dish_id } }),
      }))
    );
    setTagLoading(false);
  }

  async function runSearch(searchText: string, type: SearchType) {
    setSearchLoading(true);
    const pattern = containsPattern(searchText);
    const version = ++searchVersion.current;

    if (googleTimeout.current) clearTimeout(googleTimeout.current);
    setGooglePlaces([]);
    setGoogleSearching(false);

    if (type === 'users') {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_path')
        .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
        .limit(20);

      setSearchLoading(false);

      if (error) {
        Alert.alert('Search error', error.message);
        return;
      }

      setUserResults(await withoutHiddenUsers(data ?? [], (result) => result.id));
      return;
    }

    if (type === 'restaurants') {
      if (searchText.length >= 3) {
        setGoogleSearching(true);
        googleTimeout.current = setTimeout(
          () => searchGoogle(searchText, version),
          350
        );
      }

      const { data, error } = await supabase
        .from('restaurants')
        .select('id, name, city, state, google_place_id, country_code')
        .or(
          `name.ilike.${pattern},city.ilike.${pattern},state.ilike.${pattern}`
        )
        .limit(20);

      if (version !== searchVersion.current) return;

      setSearchLoading(false);

      if (error) {
        Alert.alert('Search error', error.message);
        return;
      }

      setRestaurantResults(data ?? []);
      return;
    }

    const { data, error } = await supabase
      .from('dishes')
      .select('id, name, restaurants (id, name, city)')
      .ilike('name', `%${searchText}%`)
      .limit(20);

    setSearchLoading(false);

    if (error) {
      Alert.alert('Search error', error.message);
      return;
    }

    setDishResults((data ?? []) as unknown as DishResult[]);
  }

  async function searchGoogle(searchText: string, version: number) {
    if (!googleSession.current) googleSession.current = createSessionToken();

    try {
      const places = await searchGoogleFoodPlaces(
        searchText,
        googleSession.current,
        userLocation
      );
      if (version === searchVersion.current) setGooglePlaces(places);
    } catch (error) {
      console.log('Google restaurant search error:', error);
    } finally {
      if (version === searchVersion.current) setGoogleSearching(false);
    }
  }

  async function openGooglePlace(placeId: string) {
    if (openingPlaceId) return;

    setOpeningPlaceId(placeId);

    try {
      const restaurantId = await findOrCreateGoogleRestaurant(
        placeId,
        googleSession.current ?? createSessionToken()
      );
      googleSession.current = null;
      router.push({ pathname: '/restaurant/[id]', params: { id: restaurantId } });
    } catch (error) {
      Alert.alert(
        'Restaurant error',
        error instanceof Error ? error.message : 'Could not open this restaurant.'
      );
    } finally {
      setOpeningPlaceId(null);
    }
  }

  function handleSearch(text: string) {
    setQuery(text);

    if (text.trim().length >= 2) {
      runSearch(text.trim(), searchType);
    }
  }

  function changeSearchType(type: SearchType) {
    setSearchType(type);

    if (query.trim().length >= 2) {
      runSearch(query.trim(), type);
    }
  }

  async function toggleFollow(profileId: string) {
    if (!currentUserId || currentUserId === profileId) return;

    const isFollowing = followingIds.includes(profileId);

    const { error } = isFollowing
      ? await supabase
          .from('follows')
          .delete()
          .eq('follower_id', currentUserId)
          .eq('following_id', profileId)
      : await supabase
          .from('follows')
          .insert({ follower_id: currentUserId, following_id: profileId });

    // 23505 = unique violation: already following (followed elsewhere).
    if (error && error.code !== '23505') {
      Alert.alert(isFollowing ? 'Unfollow error' : 'Follow error', error.message);
      return;
    }

    setFollowingIds((current) =>
      isFollowing
        ? current.filter((id) => id !== profileId)
        : [...current, profileId]
    );
  }

  async function refresh() {
    setRefreshing(true);
    await loadExplore('refresh');
    setRefreshing(false);
  }

  function openRestaurant(id: string) {
    router.push({ pathname: '/restaurant/[id]', params: { id } });
  }

  function restaurantCards(list: Ranked[], meta?: (stats: Ranked) => string) {
    return list.map<PhotoCard>((stats) => ({
      key: stats.id,
      title: stats.name,
      subtitle: stats.subtitle,
      rating: stats.averageRating,
      meta: meta ? meta(stats) : reviewsText(stats.count),
      photoPath: stats.photoPath,
      onPress: () => openRestaurant(stats.id),
    }));
  }

  function reviewCard(review: FriendReview): PhotoCard {
    return {
      key: review.id,
      title: review.dishes?.name ?? 'A dish',
      subtitle: `${review.profiles?.display_name || review.profiles?.username || 'Someone'} · ${
        review.dishes?.restaurants?.brands?.name ??
        review.dishes?.restaurants?.name ??
        ''
      }`,
      rating: Number(review.rating),
      ratingDigits: 1,
      photoPath: review.photo_path,
      onPress: () =>
        router.push({ pathname: '/review/[id]', params: { id: review.id } }),
    };
  }

  function popularCard(review: PopularReview): PhotoCard {
    const likes = review.review_reactions[0]?.count ?? 0;
    const comments = review.review_comments[0]?.count ?? 0;

    return {
      ...reviewCard(review),
      meta:
        [
          likes > 0 ? `♥ ${likes}` : null,
          comments > 0 ? `💬 ${comments}` : null,
        ]
          .filter(Boolean)
          .join('  ') || undefined,
    };
  }

  // Quote cards, people you follow first.
  function renderRestaurantReviews() {
    if (restaurantReviews.length === 0) return null;

    const ordered = [...restaurantReviews]
      .sort(
        (a, b) =>
          Number(followingIds.includes(b.user_id)) -
          Number(followingIds.includes(a.user_id))
      )
      .slice(0, ROW_COUNT);

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Restaurant reviews</Text>
        <Text style={styles.sectionSubtitle}>What people are saying about places</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quoteRow}
          style={styles.rowSpacing}
        >
          {ordered.map((review) => (
            <TouchableOpacity
              key={review.id}
              style={styles.quoteCard}
              activeOpacity={0.8}
              onPress={() => openRestaurant(review.restaurantId)}
            >
              <Text style={styles.quoteRestaurant} numberOfLines={1}>
                {review.restaurantName}
              </Text>
              <Text style={styles.quoteRating}>{review.rating.toFixed(1)} ★</Text>
              <Text style={styles.quoteText} numberOfLines={4}>
                “{review.notes}”
              </Text>
              <Text style={styles.quoteAuthor} numberOfLines={1}>
                {review.authorName}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  function renderSection(
    title: string,
    subtitle: string | null,
    cards: PhotoCard[],
    size: 'large' | 'medium' = 'medium'
  ) {
    if (cards.length === 0) return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        <View style={styles.rowSpacing}>
          <PhotoCardRow cards={cards} size={size} />
        </View>
      </View>
    );
  }

  function renderRestaurantResult(restaurant: RestaurantResult) {
    return (
      <TouchableOpacity
        key={restaurant.id}
        style={styles.resultRow}
        onPress={() => openRestaurant(restaurant.id)}
      >
        <View style={styles.resultIcon}>
          <Text style={styles.resultEmoji}>🍽️</Text>
        </View>
        <View style={styles.resultText}>
          <Text style={styles.primaryText}>
            {withFlag(restaurant.name, restaurant.country_code)}
          </Text>
          {locationText(restaurant.city, restaurant.state) ? (
            <Text style={styles.secondaryText}>
              {locationText(restaurant.city, restaurant.state)}
            </Text>
          ) : null}
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }

  function renderSearchResults() {
    if (searchLoading) {
      return <ActivityIndicator style={styles.loading} color={Palette.accent} />;
    }

    if (searchType === 'users') {
      if (userResults.length === 0) {
        return <Text style={styles.noResults}>No people found.</Text>;
      }

      return userResults.map((user) => {
        const isOwnProfile = user.id === currentUserId;
        const following = followingIds.includes(user.id);

        return (
          <View key={user.id} style={styles.resultRow}>
            <TouchableOpacity
              style={styles.resultInfo}
              onPress={() =>
                isOwnProfile
                  ? router.push('/profile')
                  : router.push({ pathname: '/user/[id]', params: { id: user.id } })
              }
            >
              {user.avatar_path ? (
                <Image
                  source={{
                    uri: supabase.storage
                      .from('profile-photos')
                      .getPublicUrl(user.avatar_path).data.publicUrl,
                  }}
                  style={styles.resultIcon}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.resultIcon}>
                  <Text style={styles.resultIconText}>
                    {(user.display_name || user.username || 'U')
                      .charAt(0)
                      .toUpperCase()}
                  </Text>
                </View>
              )}

              <View style={styles.resultText}>
                <Text style={styles.primaryText}>
                  {user.display_name || user.username}
                  {isOwnProfile ? ' · You' : ''}
                </Text>
                <Text style={styles.secondaryText}>@{user.username}</Text>
              </View>
            </TouchableOpacity>

            {!isOwnProfile ? (
              <TouchableOpacity
                style={[styles.followButton, following && styles.followingButton]}
                onPress={() => toggleFollow(user.id)}
              >
                <Text style={styles.followButtonText}>
                  {following ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      });
    }

    if (searchType === 'restaurants') {
      const onWotri = new Set(
        restaurantResults.map((restaurant) => restaurant.google_place_id)
      );
      const newPlaces = googlePlaces.filter(
        (place) =>
          place.placePrediction?.placeId &&
          !onWotri.has(place.placePrediction.placeId)
      );

      if (
        restaurantResults.length === 0 &&
        newPlaces.length === 0 &&
        !googleSearching
      ) {
        return <Text style={styles.noResults}>No restaurants found.</Text>;
      }

      return (
        <>
          {restaurantResults.map((restaurant) => renderRestaurantResult(restaurant))}

          {newPlaces.map((place) => {
            const prediction = place.placePrediction!;
            const placeId = prediction.placeId!;

            return (
              <TouchableOpacity
                key={placeId}
                style={styles.resultRow}
                onPress={() => openGooglePlace(placeId)}
                disabled={openingPlaceId !== null}
              >
                <View style={styles.resultIcon}>
                  <Text style={styles.resultEmoji}>📍</Text>
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.primaryText}>
                    {prediction.structuredFormat?.mainText?.text ??
                      prediction.text?.text ??
                      'Restaurant'}
                  </Text>
                  {prediction.structuredFormat?.secondaryText?.text ? (
                    <Text style={styles.secondaryText} numberOfLines={1}>
                      {prediction.structuredFormat.secondaryText.text}
                    </Text>
                  ) : null}
                </View>
                {openingPlaceId === placeId ? (
                  <ActivityIndicator color={Palette.accent} />
                ) : (
                  <Text style={styles.chevron}>›</Text>
                )}
              </TouchableOpacity>
            );
          })}

          {googleSearching ? (
            <ActivityIndicator style={styles.loading} color={Palette.accent} />
          ) : null}
        </>
      );
    }

    if (dishResults.length === 0) {
      return <Text style={styles.noResults}>No dishes found.</Text>;
    }

    return dishResults.map((dish) => (
      <TouchableOpacity
        key={dish.id}
        style={styles.resultRow}
        onPress={() =>
          router.push({ pathname: '/dish/[id]', params: { id: dish.id } })
        }
      >
        <View style={styles.resultIcon}>
          <Text style={styles.resultEmoji}>🍴</Text>
        </View>
        <View style={styles.resultText}>
          <Text style={styles.primaryText}>{dish.name}</Text>
          <Text style={styles.secondaryText}>
            {dish.restaurants?.name ?? 'Unknown restaurant'}
            {dish.restaurants?.city ? ` · ${dish.restaurants.city}` : ''}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    ));
  }

  function renderBrowse() {
    const selectedCategory = categories.find((tag) => tag.slug === selectedTag);

    return (
      <>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
        >
          {categories.map((tag) => {
            const selected = tag.slug === selectedTag;

            return (
              <TouchableOpacity
                key={tag.slug}
                style={[styles.category, selected && styles.categorySelected]}
                onPress={() => selectTag(tag.slug)}
              >
                <Text style={styles.categoryEmoji}>
                  {TAG_EMOJI[tag.slug] ?? '🍽️'}
                </Text>
                <Text
                  style={[styles.categoryLabel, selected && styles.categoryLabelSelected]}
                  numberOfLines={2}
                >
                  {tag.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {selectedCategory ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Best {selectedCategory.label}</Text>
            {tagLoading ? (
              <ActivityIndicator style={styles.loading} color={Palette.accent} />
            ) : tagDishes.length > 0 ? (
              <View style={styles.rowSpacing}>
                <PhotoCardRow cards={tagDishes} />
              </View>
            ) : (
              <Text style={styles.emptyText}>
                Nothing here yet. Dishes show up once they&apos;re tagged{' '}
                {selectedCategory.label}.
              </Text>
            )}
          </View>
        ) : null}

        {exploreLoading ? (
          <ActivityIndicator style={styles.loading} color={Palette.accent} />
        ) : (
          <>
            {userLocation ? (
              renderSection(
                'Best near you',
                `Top rated within ${NEARBY_MILES} miles`,
                nearby.map((spot) => ({
                  key: spot.id,
                  title: spot.name,
                  subtitle: spot.subtitle,
                  rating: spot.averageRating,
                  meta: `${spot.distanceMiles < 10 ? spot.distanceMiles.toFixed(1) : Math.round(spot.distanceMiles)} mi`,
                  photoPath: spot.photoPath,
                  onPress: () => openRestaurant(spot.id),
                })),
                'large'
              )
            ) : (
              <TouchableOpacity style={styles.locationPrompt} onPress={() => loadExplore('ask-location')}
              >
                <Text style={styles.locationPromptTitle}>📍 See what’s good near you</Text>
                <Text style={styles.locationPromptText}>
                  Allow location to get the best spots around you.
                </Text>
              </TouchableOpacity>
            )}

            {renderSection(
              'Popular this week',
              'The posts people are loving',
              popularReviews.map(popularCard)
            )}

            {friendReviews.length > 0 ? (
              renderSection(
                'What friends are eating',
                'From people you follow',
                friendReviews.map(reviewCard)
              )
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>What friends are eating</Text>
                <Text style={styles.sectionSubtitle}>
                  {followingIds.length > 0
                    ? 'The people you follow haven’t posted yet.'
                    : 'Follow friends to see what they’re eating. Find them with People in the search above.'}
                </Text>
              </View>
            )}

            {renderRestaurantReviews()}

            {renderSection(
              'Trending this week',
              'Getting the most reviews right now',
              restaurantCards(
                trending,
                (stats) => `${stats.weekCount} this week`
              )
            )}

            {renderSection(
              'Top dishes',
              null,
              topDishes.map((stats, index) => ({
                key: stats.id,
                title: stats.name,
                subtitle: stats.subtitle,
                rating: stats.averageRating,
                meta: reviewsText(stats.count),
                photoPath: stats.photoPath,
                badge: `#${index + 1}`,
                onPress: () =>
                  router.push({ pathname: '/dish/[id]', params: { id: stats.id } }),
              }))
            )}

            {renderSection(
              'Hidden gems',
              'Loved by the few who’ve been',
              restaurantCards(hiddenGems)
            )}

            {renderSection(
              'Top restaurants',
              null,
              restaurantCards(topRestaurants).map((card, index) => ({
                ...card,
                badge: `#${index + 1}`,
              }))
            )}
          </>
        )}
      </>
    );
  }

  const isSearching = query.trim().length >= 2;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Discover</Text>

        <View style={styles.modeSwitch}>
          {(['list', 'map'] as const).map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.modeOption, mode === option && styles.modeOptionActive]}
              onPress={() => setMode(option)}
            >
              <Text style={[styles.modeText, mode === option && styles.modeTextActive]}>
                {option === 'list' ? 'List' : 'Map'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search restaurants, dishes, people"
          placeholderTextColor={Palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={handleSearch}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {isSearching ? (
        <View style={styles.searchTabs}>
          {(['restaurants', 'dishes', 'users'] as const).map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.searchTab, searchType === type && styles.searchTabActive]}
              onPress={() => changeSearchType(type)}
            >
              <Text
                style={[
                  styles.searchTabText,
                  searchType === type && styles.searchTabTextActive,
                ]}
              >
                {type === 'users' ? 'People' : type === 'restaurants' ? 'Restaurants' : 'Dishes'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {isSearching ? (
        <ScrollView
          contentContainerStyle={styles.results}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {renderSearchResults()}
        </ScrollView>
      ) : mode === 'map' ? (
        exploreLoading ? (
          <ActivityIndicator style={styles.loading} color={Palette.accent} />
        ) : (
          <RestaurantMap restaurants={mapRestaurants} userLocation={userLocation} />
        )
      ) : (
        <ScrollView
          contentContainerStyle={styles.browse}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={Palette.accent}
            />
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {renderBrowse()}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  title: {
    color: Palette.text,
    fontSize: 30,
    fontWeight: '700',
  },
  modeSwitch: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 10,
    backgroundColor: Palette.surface,
  },
  modeOption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  modeOptionActive: {
    backgroundColor: Palette.elevated,
  },
  modeText: {
    color: Palette.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  modeTextActive: {
    color: Palette.text,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  searchIcon: {
    color: Palette.textMuted,
    fontSize: 20,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: Palette.text,
    fontSize: 16,
    paddingVertical: 12,
  },
  searchClear: {
    color: Palette.textMuted,
    fontSize: 15,
    paddingLeft: 8,
  },
  searchTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  searchTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
  },
  searchTabActive: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  searchTabText: {
    color: Palette.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  searchTabTextActive: {
    color: Palette.text,
  },
  results: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  noResults: {
    color: Palette.textMuted,
    fontSize: 15,
    marginTop: 16,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  resultInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Palette.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  resultIconText: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '700',
  },
  resultEmoji: {
    fontSize: 20,
  },
  resultText: {
    flex: 1,
  },
  primaryText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryText: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  chevron: {
    color: Palette.textMuted,
    fontSize: 24,
    paddingLeft: 8,
  },
  followButton: {
    backgroundColor: Palette.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  followingButton: {
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
  },
  followButtonText: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  browse: {
    paddingTop: 10,
    paddingBottom: 60,
  },
  categories: {
    gap: 10,
    paddingHorizontal: 20,
  },
  category: {
    width: 76,
    height: 80,
    borderRadius: 14,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: Palette.surface,
  },
  categorySelected: {
    borderColor: Palette.accent,
    backgroundColor: Palette.elevated,
  },
  categoryEmoji: {
    fontSize: 26,
  },
  categoryLabel: {
    color: Palette.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  categoryLabelSelected: {
    color: Palette.text,
  },
  section: {
    marginTop: 28,
  },
  sectionTitle: {
    color: Palette.text,
    fontSize: 21,
    fontWeight: '700',
    paddingHorizontal: 20,
  },
  sectionSubtitle: {
    color: Palette.textMuted,
    fontSize: 14,
    paddingHorizontal: 20,
    marginTop: 2,
  },
  rowSpacing: {
    marginTop: 12,
  },
  quoteRow: {
    gap: 12,
    paddingHorizontal: 20,
  },
  quoteCard: {
    width: 260,
    minHeight: 170,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  quoteRestaurant: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  quoteRating: {
    color: Palette.accent,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  quoteText: {
    color: Palette.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    flex: 1,
  },
  quoteAuthor: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 10,
  },
  emptyText: {
    color: Palette.textMuted,
    fontSize: 15,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  loading: {
    marginTop: 30,
  },
  locationPrompt: {
    marginTop: 24,
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 14,
    backgroundColor: Palette.surface,
  },
  locationPromptTitle: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  locationPromptText: {
    color: Palette.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
});
