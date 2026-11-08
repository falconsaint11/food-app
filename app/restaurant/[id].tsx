import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { AddToListButton } from '@/components/add-to-list-button';
import { ContentMenu } from '@/components/content-menu';
import {
  CoverPhoto,
  CoverPhotos,
  fetchCoverPhotos,
} from '@/components/cover-photos';
import { DishCarousel } from '@/components/dish-carousel';
import { RateRestaurantButton } from '@/components/rate-restaurant-button';
import {
  getBrandLocationIds,
  getBrandLocationsNearestFirst,
} from '@/lib/brands';
import { useIsCurator } from '@/lib/admin';
import { uploadPhoto } from '@/lib/photos';
import { withoutHiddenUsers } from '@/lib/moderation';
import { formatAverage, formatRating, useIsPremium } from '@/lib/ratings';
import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

type Restaurant = {
  id: string;
  name: string;
  brand_id: string | null;
  brands: {
    name: string;
    cover_review_id: string | null;
    cover_photo_id: string | null;
  } | null;
  // Pinned cover for restaurants without a brand.
  cover_review_id: string | null;
  cover_photo_id: string | null;
  is_food_truck: boolean;
  latitude: number | null;
  longitude: number | null;
};

// A photo of the place or its menu, added without a review.
type PlacePhoto = {
  id: string;
  user_id: string;
  photo_path: string;
  kind: 'place' | 'menu';
};

type DishSummary = {
  id: string;
  name: string;
  nameKey: string;
  averageRating: number;
  reviewCount: number;
  // Set on variants: the name_key of the dish listed above them.
  variantOf: string | null;
  variantLabel: string | null;
  // Every location's row is discontinued.
  discontinued: boolean;
  // Menu section from the menu import ("Tacos", "Drinks").
  category: string | null;
  // When the first row was added; menu imports add dishes in menu order.
  addedAt: number;
  // Public tags this page cares about (drinks and availability).
  tags: string[];
  // The current user has reviewed it at any location.
  tried: boolean;
  // Best review photo of it, if any.
  photoPath: string | null;
  // Your latest rating of it, at any location.
  myRating: number | null;
};

type RestaurantReview = {
  id: string;
  user_id: string;
  dish_id: string;
  rating: number;
  review_text: string | null;
  photo_path: string | null;
  created_at: string;
  likeCount: number;
  profiles: {
    username: string;
    display_name: string | null;
  } | null;
  dishes: {
    id: string;
    name: string;
  } | null;
};

// One of the current user's visits (a restaurant rating from the Log tab or
// the Rate button).
type MyVisit = {
  id: string;
  rating: number | null;
  notes: string | null;
  visited_at: string;
};

// A visit where someone wrote about the restaurant itself.
type RestaurantNote = {
  id: string;
  user_id: string;
  rating: number | null;
  notes: string;
  visited_at: string;
  authorName: string;
};

const CAROUSEL_COUNT = 10;

const PHOTO_COUNT = 15;

const MENU_PREVIEW_COUNT = 6;

const REVIEW_PAGE_SIZE = 5;

const RESTAURANT_NOTE_COUNT = 5;

// Each dish's average starts with this many imaginary reviews at the
// restaurant's average, so one 5-star review can't top the list.
const RANKING_PRIOR = 3;

const DRINK_TAGS = ['drink', 'coffee-tea', 'alcoholic-drink'];

// Items that aren't always on the menu. They don't count toward "tried".
const AVAILABILITY_LABELS: Record<string, string> = {
  'limited-time': 'Limited',
  seasonal: 'Seasonal',
  'secret-menu': 'Secret Menu',
};

// Matches dish_tag_vote_threshold() in SQL.
const TAG_VOTE_THRESHOLD = 2;

function getPhotoUrl(path: string) {
  return supabase.storage.from('review-photos').getPublicUrl(path).data
    .publicUrl;
}

// Public drink and availability tags for each dish, keyed by name_key so
// every location of a dish shares them (like dish_public_tags() in SQL).
async function fetchTagsByNameKey(
  dishes: { id: string; name_key: string }[]
) {
  const tags = [...DRINK_TAGS, ...Object.keys(AVAILABILITY_LABELS)];
  const dishIds = dishes.map((dish) => dish.id);
  const keyById = new Map(dishes.map((dish) => [dish.id, dish.name_key]));
  const byKey = new Map<string, Set<string>>();

  if (dishIds.length === 0) {
    return byKey;
  }

  const [{ data: menuTags }, { data: votes }] = await Promise.all([
    supabase
      .from('dish_menu_tags')
      .select('dish_id, tag')
      .in('dish_id', dishIds)
      .in('tag', tags),
    supabase
      .from('dish_tag_votes')
      .select('dish_id, tag, user_id')
      .in('dish_id', dishIds)
      .in('tag', tags),
  ]);

  function add(key: string, tag: string) {
    byKey.set(key, (byKey.get(key) ?? new Set()).add(tag));
  }

  for (const row of menuTags ?? []) {
    const key = keyById.get(row.dish_id as string);
    if (key) add(key, row.tag as string);
  }

  const votersByKeyTag = new Map<string, Set<string>>();
  for (const row of votes ?? []) {
    const key = keyById.get(row.dish_id as string);
    if (!key) continue;

    const id = `${key}\n${row.tag}`;
    votersByKeyTag.set(
      id,
      (votersByKeyTag.get(id) ?? new Set()).add(row.user_id as string)
    );
  }

  for (const [id, voters] of votersByKeyTag) {
    if (voters.size < TAG_VOTE_THRESHOLD) continue;

    const [key, tag] = id.split('\n');
    add(key, tag);
  }

  return byKey;
}

export default function RestaurantDetailScreen() {
  const isPremium = useIsPremium();
  const isCurator = useIsCurator();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [dishes, setDishes] = useState<DishSummary[]>([]);
  const [reviews, setReviews] = useState<RestaurantReview[]>([]);
  const [coverPhotos, setCoverPhotos] = useState<CoverPhoto[]>([]);
  const [placePhotos, setPlacePhotos] = useState<PlacePhoto[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [myVisits, setMyVisits] = useState<MyVisit[]>([]);
  const [restaurantNotes, setRestaurantNotes] = useState<RestaurantNote[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDiscontinued, setShowDiscontinued] = useState(false);
  const [showFullMenu, setShowFullMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [reviewSort, setReviewSort] = useState<'top' | 'recent'>('top');
  const [reviewLimit, setReviewLimit] = useState(REVIEW_PAGE_SIZE);

  useFocusEffect(
    useCallback(() => {
      loadRestaurant();
    }, [id])
  );

  // Photos of the place from every location of the brand, newest first.
  async function loadPlacePhotos(locationIds: string[]) {
    const { data, error } = await supabase
      .from('restaurant_photos')
      .select('id, user_id, photo_path, kind')
      .in('restaurant_id', locationIds)
      .order('created_at', { ascending: false })
      .limit(PHOTO_COUNT);

    if (error) {
      console.log('Restaurant photos error:', error.message);
      return;
    }

    setPlacePhotos(
      await withoutHiddenUsers((data ?? []) as PlacePhoto[], (photo) => photo.user_id)
    );
  }

  function addPlacePhoto() {
    Alert.alert('Add a photo', 'Show people what the place looks like.', [
      { text: 'Take photo', onPress: () => pickPlacePhoto('camera') },
      { text: 'Choose from library', onPress: () => pickPlacePhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickPlacePhoto(source: 'camera' | 'library') {
    if (!restaurant) return;

    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'Allow camera access in Settings to take a photo.'
          : 'Allow photo access in Settings to choose a photo.'
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets[0]) return;

    setUploadingPhoto(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('Log in to add photos.');

      const photoPath = await uploadPhoto(result.assets[0].uri, user.id);

      const { error } = await supabase.from('restaurant_photos').insert({
        restaurant_id: restaurant.id,
        photo_path: photoPath,
      });

      if (error) {
        // Don't leave the file behind if the row wasn't saved.
        await supabase.storage.from('review-photos').remove([photoPath]);
        throw new Error(
          error.message.includes('row-level security')
            ? 'You’ve added a lot of photos today. Try again tomorrow.'
            : error.message
        );
      }

      loadPlacePhotos(
        await getBrandLocationIds(restaurant.id, restaurant.brand_id)
      );
    } catch (error) {
      Alert.alert(
        'Photo not added',
        error instanceof Error ? error.message : 'Something went wrong.'
      );
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function toggleFoodTruck() {
    if (!restaurant) return;

    const on = !restaurant.is_food_truck;
    const { error } = await supabase.rpc('set_food_truck', {
      p_restaurant_id: restaurant.id,
      p_on: on,
    });

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setRestaurant({ ...restaurant, is_food_truck: on });
  }

  async function loadRestaurant() {
    if (!id) {
      return;
    }

    setLoading(true);

    try {
      const { data: restaurantData, error: restaurantError } = await supabase
        .from('restaurants')
        .select(
          'id, name, brand_id, cover_review_id, cover_photo_id, is_food_truck, latitude, longitude, brands (name, cover_review_id, cover_photo_id)'
        )
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

      loadPlacePhotos(locationIds);

      // Visits to any of the brand's locations (from the Log tab) plus
      // brand-wide ratings (from the Rate button). Each row is one visit;
      // rating is null when the user skipped the restaurant stars.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setMyUserId(user?.id ?? null);

      const ratingQuery = supabase
        .from('restaurant_ratings')
        .select('id, user_id, rating, notes, visited_at');

      const { data: ratingData, error: ratingError } = restaurantRow.brand_id
        ? await ratingQuery.or(
            `restaurant_id.in.(${locationIds.join(',')}),brand_id.eq.${restaurantRow.brand_id}`
          )
        : await ratingQuery.in('restaurant_id', locationIds);

      if (ratingError) throw new Error(ratingError.message);

      setMyVisits(
        (ratingData ?? [])
          .filter((row) => row.user_id === user?.id)
          .map((row) => ({
            id: row.id as string,
            rating: row.rating === null ? null : Number(row.rating),
            notes: row.notes as string | null,
            visited_at: row.visited_at as string,
          }))
          .sort((a, b) => b.visited_at.localeCompare(a.visited_at))
      );

      // Average each person's ratings first so someone who rated five
      // visits or locations counts the same as someone who rated one.
      const ratingsByUser = new Map<string, number[]>();
      for (const row of ratingData ?? []) {
        if (row.rating === null) continue;

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

      const notesQuery = supabase
        .from('restaurant_ratings')
        .select('id, user_id, rating, notes, visited_at')
        .not('notes', 'is', null)
        .order('visited_at', { ascending: false })
        .limit(RESTAURANT_NOTE_COUNT);

      const { data: notesData, error: notesError } = restaurantRow.brand_id
        ? await notesQuery.or(
            `restaurant_id.in.(${locationIds.join(',')}),brand_id.eq.${restaurantRow.brand_id}`
          )
        : await notesQuery.in('restaurant_id', locationIds);

      if (notesError) throw new Error(notesError.message);

      // restaurant_ratings links to auth users, not profiles, so look up
      // names separately.
      const noteAuthorIds = [
        ...new Set((notesData ?? []).map((row) => row.user_id as string)),
      ];

      const { data: authorData } =
        noteAuthorIds.length > 0
          ? await supabase
              .from('profiles')
              .select('id, username, display_name')
              .in('id', noteAuthorIds)
          : { data: [] };

      const authorNames = new Map(
        (authorData ?? []).map((profile) => [
          profile.id as string,
          (profile.display_name || profile.username || 'User') as string,
        ])
      );

      const visibleNotes = await withoutHiddenUsers(
        notesData ?? [],
        (row) => row.user_id as string
      );

      setRestaurantNotes(
        visibleNotes.map((row) => ({
          id: row.id as string,
          user_id: row.user_id as string,
          rating: row.rating === null ? null : Number(row.rating),
          notes: row.notes as string,
          visited_at: row.visited_at as string,
          authorName: authorNames.get(row.user_id as string) ?? 'User',
        }))
      );

      const { data: dishData, error: dishError } = await supabase
        .from('dishes')
        .select(
          'id, name, name_key, variant_of, variant_label, discontinued_at, category, created_at'
        )
        .in('restaurant_id', locationIds);

      if (dishError) throw new Error(dishError.message);

      const dishIds = (dishData ?? []).map((dish) => dish.id as string);

      const [covers, tagsByKey] = await Promise.all([
        fetchCoverPhotos(
          dishIds,
          restaurantRow.brands?.cover_review_id ??
            restaurantRow.cover_review_id ??
            null
        ),
        fetchTagsByNameKey(
          (dishData ?? []).map((dish) => ({
            id: dish.id as string,
            name_key: dish.name_key as string,
          }))
        ),
      ]);

      // A pinned restaurant photo leads the cover.
      const pinnedPhotoId = restaurantRow.brand_id
        ? (restaurantRow.brands?.cover_photo_id ?? null)
        : restaurantRow.cover_photo_id;
      const { data: pinnedPhoto } = pinnedPhotoId
        ? await supabase
            .from('restaurant_photos')
            .select('id, photo_path')
            .eq('id', pinnedPhotoId)
            .maybeSingle()
        : { data: null };

      setCoverPhotos(
        pinnedPhoto
          ? [
              {
                review_id: '',
                place_photo_id: pinnedPhoto.id,
                photo_path: pinnedPhoto.photo_path,
              },
              ...covers,
            ]
          : covers
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
                photo_path,
                created_at,
                profiles:user_id (
                  username,
                  display_name
                ),
                dishes (
                  id,
                  name
                ),
                review_reactions (
                  reaction
                )
              `)
              .in('dish_id', dishIds)
              .order('created_at', { ascending: false })
          : { data: [], error: null };

      if (reviewError) throw new Error(reviewError.message);

      const allReviews: RestaurantReview[] = (
        (reviewData ?? []) as unknown as (RestaurantReview & {
          review_reactions: { reaction: string }[] | null;
        })[]
      ).map(({ review_reactions, ...review }) => ({
        ...review,
        likeCount: review_reactions?.length ?? 0,
      }));

      // Blocked people's ratings still count toward scores; only their posts
      // (and photos) are hidden.
      const visibleReviews = await withoutHiddenUsers(
        allReviews,
        (review) => review.user_id
      );

      const ratingsByDishId = new Map<string, number[]>();
      for (const review of allReviews) {
        ratingsByDishId.set(review.dish_id, [
          ...(ratingsByDishId.get(review.dish_id) ?? []),
          Number(review.rating),
        ]);
      }

      const triedDishIds = new Set(
        allReviews
          .filter((review) => review.user_id === user?.id)
          .map((review) => review.dish_id)
      );

      // Your latest review of each dish row.
      const myLatestByDishId = new Map<string, RestaurantReview>();
      for (const review of allReviews) {
        if (review.user_id !== user?.id) continue;
        const latest = myLatestByDishId.get(review.dish_id);
        if (!latest || review.created_at > latest.created_at) {
          myLatestByDishId.set(review.dish_id, review);
        }
      }

      // Same scoring as cover_photos(): likes count double, then stars.
      const bestPhotoByDishId = new Map<string, RestaurantReview>();
      for (const review of visibleReviews) {
        if (!review.photo_path) continue;

        const best = bestPhotoByDishId.get(review.dish_id);
        if (
          !best ||
          review.likeCount * 2 + Number(review.rating) >
            best.likeCount * 2 + Number(best.rating)
        ) {
          bestPhotoByDishId.set(review.dish_id, review);
        }
      }

      // Merge same-named dishes from different locations into one menu item.
      // The most-reviewed row is the one the menu links to.
      const groups = new Map<
        string,
        {
          id: string;
          name: string;
          topCount: number;
          ratings: number[];
          variantOf: string | null;
          variantLabel: string | null;
          discontinued: boolean;
          category: string | null;
          addedAt: number;
          tried: boolean;
          mine: RestaurantReview | null;
          photo: RestaurantReview | null;
        }
      >();

      for (const dish of dishData ?? []) {
        const ratings = ratingsByDishId.get(dish.id) ?? [];
        const key = dish.name_key as string;
        const group = groups.get(key);
        const photo = bestPhotoByDishId.get(dish.id) ?? null;
        const mine = myLatestByDishId.get(dish.id) ?? null;
        const addedAt = new Date(dish.created_at as string).getTime();

        if (!group) {
          groups.set(key, {
            id: dish.id,
            name: dish.name.trim(),
            topCount: ratings.length,
            ratings: [...ratings],
            variantOf: dish.variant_of,
            variantLabel: dish.variant_label,
            discontinued: dish.discontinued_at !== null,
            category: dish.category,
            addedAt,
            tried: triedDishIds.has(dish.id),
            mine,
            photo,
          });
          continue;
        }

        if (mine && (!group.mine || mine.created_at > group.mine.created_at)) {
          group.mine = mine;
        }

        group.ratings.push(...ratings);
        group.variantOf ??= dish.variant_of;
        group.variantLabel ??= dish.variant_label;
        group.category ??= dish.category;
        group.discontinued &&= dish.discontinued_at !== null;
        group.addedAt = Math.min(group.addedAt, addedAt);
        group.tried ||= triedDishIds.has(dish.id);
        if (
          photo &&
          (!group.photo ||
            photo.likeCount * 2 + Number(photo.rating) >
              group.photo.likeCount * 2 + Number(group.photo.rating))
        ) {
          group.photo = photo;
        }
        if (ratings.length > group.topCount) {
          group.id = dish.id;
          group.topCount = ratings.length;
        }
      }

      const dishSummaries: DishSummary[] = [...groups.entries()].map(
        ([nameKey, group]) => ({
          id: group.id,
          name: group.name,
          nameKey,
          variantOf: group.variantOf,
          variantLabel: group.variantLabel,
          discontinued: group.discontinued,
          category: group.category?.trim() || null,
          addedAt: group.addedAt,
          tags: [...(tagsByKey.get(nameKey) ?? [])],
          tried: group.tried,
          myRating: group.mine ? Number(group.mine.rating) : null,
          photoPath: group.photo?.photo_path ?? null,
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
      setReviews(visibleReviews);
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

  // A variant row (under its dish) shows just its label ("Steak"). A dish
  // with variants shows the combined rating of it and its variants.
  function renderDishRow(
    dish: DishSummary,
    options: { asVariant?: boolean; variants?: DishSummary[] } = {}
  ) {
    const family = [dish, ...(options.variants ?? [])];
    const reviewCount = family.reduce((sum, item) => sum + item.reviewCount, 0);
    const averageRating =
      reviewCount > 0
        ? family.reduce(
            (sum, item) => sum + item.averageRating * item.reviewCount,
            0
          ) / reviewCount
        : 0;
    const variantCount = options.variants?.length ?? 0;
    const availability = dish.tags.filter((tag) => AVAILABILITY_LABELS[tag]);

    return (
      <TouchableOpacity
        key={dish.id}
        style={[styles.dishRow, options.asVariant && styles.variantRow]}
        onPress={() =>
          router.push({
            pathname: '/dish/[id]',
            params: { id: dish.id },
          })
        }
      >
        <View style={styles.dishInfo}>
          <View style={styles.dishNameRow}>
            <Text
              style={[styles.dishName, options.asVariant && styles.variantName]}
              numberOfLines={2}
            >
              {options.asVariant ? (dish.variantLabel ?? dish.name) : dish.name}
            </Text>

            {dish.tried ? <Text style={styles.triedMark}>✓</Text> : null}
          </View>

          <View style={styles.dishMetaRow}>
            <Text style={styles.dishSubtext}>
              {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
              {variantCount > 0
                ? ` · ${variantCount} ${variantCount === 1 ? 'type' : 'types'}`
                : ''}
            </Text>

            {availability.map((tag) => (
              <View key={tag} style={styles.pill}>
                <Text style={styles.pillText}>{AVAILABILITY_LABELS[tag]}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.dishRating}>
          {averageRating > 0 ? `${formatAverage(averageRating)} ★` : '—'}
        </Text>
      </TouchableOpacity>
    );
  }

  function renderMenuEntry(dish: DishSummary, variants: DishSummary[]) {
    return (
      <View key={dish.id}>
        {renderDishRow(dish, { variants })}
        {variants.map((variant) => renderDishRow(variant, { asVariant: true }))}
      </View>
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

  const restaurantName = restaurant.brands?.name ?? restaurant.name;

  // Variants are listed under their dish when it's on the menu; ones whose
  // dish isn't are listed on their own.
  const onMenu = dishes.filter((dish) => !dish.discontinued);
  const discontinued = dishes.filter((dish) => dish.discontinued);
  const menuKeys = new Set(onMenu.map((dish) => dish.nameKey));
  const variantsOf = (dish: DishSummary) =>
    onMenu.filter((variant) => variant.variantOf === dish.nameKey);
  const menuEntries = onMenu.filter(
    (dish) => !dish.variantOf || !menuKeys.has(dish.variantOf)
  );

  // "Tried" counts menu entries (a dish and its variants count once) that
  // are always on the menu.
  const regularEntries = menuEntries.filter(
    (dish) => !dish.tags.some((tag) => AVAILABILITY_LABELS[tag])
  );
  const triedCount = regularEntries.filter((dish) =>
    [dish, ...variantsOf(dish)].some((item) => item.tried)
  ).length;
  const triedPercent =
    regularEntries.length > 0
      ? Math.round((triedCount / regularEntries.length) * 100)
      : 0;

  const reviewTotal = onMenu.reduce((sum, dish) => sum + dish.reviewCount, 0);
  const restaurantMean =
    reviewTotal > 0
      ? onMenu.reduce(
          (sum, dish) => sum + dish.averageRating * dish.reviewCount,
          0
        ) / reviewTotal
      : 0;
  const rankScore = (dish: DishSummary) =>
    (dish.averageRating * dish.reviewCount + RANKING_PRIOR * restaurantMean) /
    (dish.reviewCount + RANKING_PRIOR);
  const ranked = onMenu
    .filter((dish) => dish.reviewCount > 0)
    .sort((a, b) => rankScore(b) - rankScore(a) || b.reviewCount - a.reviewCount);
  const isDrink = (dish: DishSummary) =>
    dish.tags.some((tag) => DRINK_TAGS.includes(tag));
  const topDishes = ranked.filter((dish) => !isDrink(dish)).slice(0, CAROUSEL_COUNT);
  const topDrinks = ranked.filter(isDrink).slice(0, CAROUSEL_COUNT);
  // Everything you've rated here, dishes and drinks, your favorite first.
  const myFavorites = dishes
    .filter((dish) => dish.myRating !== null)
    .sort((a, b) => (b.myRating ?? 0) - (a.myRating ?? 0))
    .slice(0, CAROUSEL_COUNT);

  const photos = reviews
    .filter((review) => review.photo_path)
    .slice(0, PHOTO_COUNT);

  // Menu sections in the order the menu import added them; dishes without
  // one go last. Fewer than two sections reads better as one list.
  const categoryOrder = new Map<string, number>();
  for (const dish of menuEntries) {
    if (!dish.category) continue;
    categoryOrder.set(
      dish.category,
      Math.min(categoryOrder.get(dish.category) ?? Infinity, dish.addedAt)
    );
  }
  const useSections = categoryOrder.size >= 2;
  const menuSections = useSections
    ? [
        ...[...categoryOrder.entries()]
          .sort((a, b) => a[1] - b[1])
          .map(([category]) => ({
            title: category,
            dishes: menuEntries.filter((dish) => dish.category === category),
          })),
        {
          title: 'More',
          dishes: menuEntries.filter((dish) => !dish.category),
        },
      ].filter((section) => section.dishes.length > 0)
    : [{ title: null, dishes: menuEntries }];

  // The collapsed menu shows the first few entries across sections.
  let menuRemaining = showFullMenu ? Infinity : MENU_PREVIEW_COUNT;
  const visibleSections = menuSections
    .map((section) => {
      const shown = section.dishes.slice(0, Math.max(menuRemaining, 0));
      menuRemaining -= shown.length;
      return { ...section, dishes: shown };
    })
    .filter((section) => section.dishes.length > 0);

  const search = query.trim().toLowerCase();
  const searchResults = search
    ? dishes.filter((dish) =>
        [dish.name, dish.variantLabel, dish.category].some((text) =>
          text?.toLowerCase().includes(search)
        )
      )
    : [];

  const myReviews = reviews.filter((review) => review.user_id === myUserId);
  const myRatings = myVisits
    .map((visit) => visit.rating)
    .filter((rating): rating is number => rating !== null);
  const myRating =
    myRatings.length > 0
      ? myRatings.reduce((sum, rating) => sum + rating, 0) / myRatings.length
      : null;

  const sortedReviews =
    reviewSort === 'recent'
      ? reviews
      : [...reviews].sort(
          (a, b) =>
            b.likeCount - a.likeCount ||
            Number(b.rating) - Number(a.rating) ||
            b.created_at.localeCompare(a.created_at)
        );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <CoverPhotos photos={coverPhotos} />

      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerInfo}>
            <Text style={styles.title}>{restaurantName}</Text>

            {restaurant.is_food_truck ? (
              <Text style={styles.foodTruckBadge}>🚚 Food truck</Text>
            ) : null}

            {/* Only places without a location on the map can be food trucks. */}
            {isCurator &&
            (restaurant.is_food_truck ||
              (restaurant.latitude === null && restaurant.longitude === null)) ? (
              <TouchableOpacity onPress={toggleFoodTruck}>
                <Text style={styles.curatorLink}>
                  {restaurant.is_food_truck
                    ? 'Curator: not a food truck'
                    : 'Curator: mark as food truck'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {myVisits.length > 0 ? (
              <Text style={styles.visitCount}>
                You’ve been here{' '}
                {myVisits.length === 1 ? 'once' : `${myVisits.length} times`}
              </Text>
            ) : null}
          </View>

          <View style={styles.headerRating}>
            <Text style={styles.ratingNumber}>
              {restaurantRating > 0 ? formatAverage(restaurantRating) : '—'} ★
            </Text>

            <Text style={styles.ratingLabel}>
              {ratingCount > 0
                ? `${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}`
                : 'No ratings yet'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <RateRestaurantButton
            restaurantId={restaurant.id}
            brandId={restaurant.brand_id}
            restaurantName={restaurantName}
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

        {myUserId && regularEntries.length > 0 ? (
          <TouchableOpacity
            style={styles.progressCard}
            activeOpacity={0.8}
            onPress={() => setShowMine((open) => !open)}
          >
            <View style={styles.progressTop}>
              <Text style={styles.progressPercent}>{triedPercent}%</Text>

              <View style={styles.progressInfo}>
                <Text style={styles.progressTitle}>of the menu tried</Text>
                <Text style={styles.progressSubtext}>
                  {triedCount} of {regularEntries.length} regular menu items
                </Text>
              </View>

              <Text style={styles.chevron}>{showMine ? '⌃' : '⌄'}</Text>
            </View>

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${triedPercent}%` },
                ]}
              />
            </View>

            {showMine ? (
              <View style={styles.mine}>
                <View style={styles.mineHeader}>
                  <Text style={styles.mineTitle}>Your rating</Text>
                  <Text style={styles.mineRating}>
                    {myRating !== null
                      ? `${formatRating(myRating, isPremium)}★`
                      : 'Not rated'}
                  </Text>
                </View>

                {myVisits.length === 0 ? (
                  <Text style={styles.mineEmpty}>
                    You haven’t rated a visit here yet.
                  </Text>
                ) : (
                  myVisits.map((visit) => (
                    <View key={visit.id} style={styles.mineRow}>
                      <View style={styles.mineRowTop}>
                        <Text style={styles.mineRowTitle}>
                          {new Date(visit.visited_at).toLocaleDateString(
                            undefined,
                            { month: 'short', day: 'numeric', year: 'numeric' }
                          )}
                        </Text>
                        <Text style={styles.mineRowRating}>
                          {visit.rating !== null
                            ? `${formatRating(visit.rating, isPremium)}★`
                            : '—'}
                        </Text>
                      </View>

                      {visit.notes ? (
                        <Text style={styles.mineRowText} numberOfLines={3}>
                          {visit.notes}
                        </Text>
                      ) : null}
                    </View>
                  ))
                )}

                <Text style={[styles.mineTitle, styles.mineSubheading]}>
                  Your dish reviews ({myReviews.length})
                </Text>

                {myReviews.length === 0 ? (
                  <Text style={styles.mineEmpty}>
                    You haven’t reviewed a dish here yet.
                  </Text>
                ) : (
                  myReviews.map((review) => (
                    <TouchableOpacity
                      key={review.id}
                      style={styles.mineRow}
                      onPress={() =>
                        router.push({
                          pathname: '/review/[id]',
                          params: { id: review.id },
                        })
                      }
                    >
                      <View style={styles.mineRowTop}>
                        <Text style={styles.mineRowTitle} numberOfLines={1}>
                          {review.dishes?.name ?? 'Unknown dish'}
                        </Text>
                        <Text style={styles.mineRowRating}>
                          {formatRating(review.rating, isPremium)}★
                        </Text>
                      </View>

                      {review.review_text ? (
                        <Text style={styles.mineRowText} numberOfLines={2}>
                          {review.review_text}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))
                )}
              </View>
            ) : null}
          </TouchableOpacity>
        ) : null}

        {dishes.length > 0 ? (
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>⌕</Text>

            <TextInput
              style={styles.searchInput}
              placeholder={`Search ${restaurantName}’s menu`}
              placeholderTextColor={Palette.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              returnKeyType="search"
            />

            {query ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
                <Text style={styles.searchClear}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      {search ? (
        <View style={styles.container}>
          <Text style={styles.resultsCount}>
            {searchResults.length}{' '}
            {searchResults.length === 1 ? 'result' : 'results'}
          </Text>

          {searchResults.length === 0 ? (
            <Text style={styles.emptyText}>
              Nothing on the menu matches “{query.trim()}”.
            </Text>
          ) : (
            searchResults.map((dish) => renderDishRow(dish))
          )}
        </View>
      ) : (
        <>
          {topDishes.length > 0 ? (
            <View style={styles.carouselSection}>
              <Text style={[styles.sectionTitle, styles.inset]}>Top Dishes</Text>
              <DishCarousel dishes={topDishes} />
            </View>
          ) : null}

          {myFavorites.length > 0 ? (
            <View style={styles.carouselSection}>
              <Text style={[styles.sectionTitle, styles.inset]}>
                Your Favorites
              </Text>
              <DishCarousel dishes={myFavorites} showMine />
            </View>
          ) : null}

          {topDrinks.length > 0 ? (
            <View style={styles.carouselSection}>
              <Text style={[styles.sectionTitle, styles.inset]}>Top Drinks</Text>
              <DishCarousel dishes={topDrinks} />
            </View>
          ) : null}

          <View style={styles.carouselSection}>
            <Text style={[styles.sectionTitle, styles.inset]}>Photos</Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photoRow}
            >
              <TouchableOpacity
                style={[styles.photo, styles.addPhotoTile]}
                activeOpacity={0.8}
                onPress={addPlacePhoto}
                disabled={uploadingPhoto}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator color={Palette.accent} />
                ) : (
                  <>
                    <Text style={styles.addPhotoPlus}>+</Text>
                    <Text style={styles.addPhotoText}>Add photo</Text>
                  </>
                )}
              </TouchableOpacity>

              {placePhotos.map((photo) => (
                <TouchableOpacity
                  key={photo.id}
                  activeOpacity={0.8}
                  onPress={() =>
                    router.push({
                      pathname: '/restaurant-photo/[id]',
                      params: { id: photo.id },
                    })
                  }
                >
                  <Image
                    source={{ uri: getPhotoUrl(photo.photo_path) }}
                    style={styles.photo}
                    contentFit="cover"
                    transition={150}
                  />
                  {photo.kind === 'menu' ? (
                    <View style={styles.photoBadge}>
                      <Text style={styles.photoBadgeText}>Menu</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              ))}

              {photos.map((review) => (
                <TouchableOpacity
                  key={review.id}
                  activeOpacity={0.8}
                  onPress={() =>
                    router.push({
                      pathname: '/review/[id]',
                      params: { id: review.id },
                    })
                  }
                >
                  <Image
                    source={{ uri: getPhotoUrl(review.photo_path!) }}
                    style={styles.photo}
                    contentFit="cover"
                    transition={150}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.container}>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Menu</Text>
                {/* Anyone can scan a menu that's just getting started. */}
                {isCurator || menuEntries.length < 10 ? (
                  <TouchableOpacity
                    onPress={() =>
                      router.push({
                        pathname: '/menu-import',
                        params: {
                          restaurantId: restaurant.id,
                          restaurantName,
                        },
                      })
                    }
                  >
                    <Text style={styles.sectionLink}>Scan menu</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {menuEntries.length === 0 ? (
                <Text style={styles.emptyText}>
                  No dishes added yet. Log what you had, or scan the menu to
                  add it for everyone.
                </Text>
              ) : (
                visibleSections.map((section) => (
                  <View key={section.title ?? 'menu'}>
                    {section.title ? (
                      <Text style={styles.menuSectionTitle}>
                        {section.title}
                      </Text>
                    ) : null}

                    {section.dishes.map((dish) =>
                      renderMenuEntry(dish, variantsOf(dish))
                    )}
                  </View>
                ))
              )}

              {menuEntries.length > MENU_PREVIEW_COUNT ? (
                <TouchableOpacity
                  style={styles.moreButton}
                  onPress={() => setShowFullMenu((open) => !open)}
                >
                  <Text style={styles.moreButtonText}>
                    {showFullMenu
                      ? 'Show less'
                      : `View full menu (${menuEntries.length})`}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {discontinued.length > 0 && (showFullMenu || menuEntries.length <= MENU_PREVIEW_COUNT) ? (
              <View style={styles.section}>
                <TouchableOpacity
                  onPress={() => setShowDiscontinued((open) => !open)}
                >
                  <Text style={styles.discontinuedToggle}>
                    {showDiscontinued ? '− ' : '+ '}Discontinued (
                    {discontinued.length})
                  </Text>
                </TouchableOpacity>

                {showDiscontinued
                  ? discontinued.map((dish) => renderDishRow(dish))
                  : null}
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Reviews</Text>

                {reviews.length > 1 ? (
                  <View style={styles.segmented}>
                    {(['top', 'recent'] as const).map((sort) => (
                      <TouchableOpacity
                        key={sort}
                        style={[
                          styles.segment,
                          reviewSort === sort && styles.segmentActive,
                        ]}
                        onPress={() => {
                          setReviewSort(sort);
                          setReviewLimit(REVIEW_PAGE_SIZE);
                        }}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            reviewSort === sort && styles.segmentTextActive,
                          ]}
                        >
                          {sort === 'top' ? 'Top' : 'Recent'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>

              {reviews.length === 0 ? (
                <Text style={styles.emptyText}>No reviews yet.</Text>
              ) : (
                sortedReviews.slice(0, reviewLimit).map((review) => (
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
                          {' · '}
                          {new Date(review.created_at).toLocaleDateString(
                            undefined,
                            { month: 'short', day: 'numeric' }
                          )}
                        </Text>
                      </View>

                      <Text style={styles.reviewRating}>
                        {formatRating(review.rating, isPremium)}★
                      </Text>
                    </View>

                    <View style={styles.reviewBody}>
                      <View style={styles.reviewBodyText}>
                        {review.review_text ? (
                          <Text style={styles.reviewText} numberOfLines={3}>
                            {review.review_text}
                          </Text>
                        ) : null}

                        {review.likeCount > 0 ? (
                          <Text style={styles.reviewLikes}>
                            ♥ {review.likeCount}
                          </Text>
                        ) : null}
                      </View>

                      {review.photo_path ? (
                        <Image
                          source={{ uri: getPhotoUrl(review.photo_path) }}
                          style={styles.reviewPhoto}
                          contentFit="cover"
                        />
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))
              )}

              {sortedReviews.length > reviewLimit ? (
                <TouchableOpacity
                  style={styles.moreButton}
                  onPress={() =>
                    setReviewLimit((limit) => limit + REVIEW_PAGE_SIZE * 2)
                  }
                >
                  <Text style={styles.moreButtonText}>More reviews</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {restaurantNotes.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>What people are saying</Text>

                {restaurantNotes.map((note) => (
                  <TouchableOpacity
                    key={note.id}
                    style={styles.reviewCard}
                    onPress={() =>
                      router.push({
                        pathname: '/user/[id]',
                        params: { id: note.user_id },
                      })
                    }
                  >
                    <View style={styles.reviewTopRow}>
                      <View style={styles.reviewInfo}>
                        <Text style={styles.reviewer}>{note.authorName}</Text>

                        <Text style={styles.reviewDish}>
                          {new Date(note.visited_at).toLocaleDateString()}
                        </Text>
                      </View>

                      {note.rating !== null ? (
                        <Text style={styles.reviewRating}>
                          {formatRating(note.rating, isPremium)}★
                        </Text>
                      ) : null}

                      <ContentMenu
                        targetType="restaurant_note"
                        targetId={note.id}
                        authorId={note.user_id}
                        authorName={note.authorName}
                        onBlocked={() =>
                          setRestaurantNotes((current) =>
                            current.filter(
                              (other) => other.user_id !== note.user_id
                            )
                          )
                        }
                      />
                    </View>

                    <Text style={styles.reviewText} numberOfLines={4}>
                      {note.notes}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        </>
      )}
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
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  inset: {
    paddingHorizontal: 24,
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
  foodTruckBadge: {
    alignSelf: 'flex-start',
    color: Palette.text,
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: Palette.surface,
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 8,
  },
  curatorLink: {
    color: Palette.accent,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  visitCount: {
    color: Palette.textSecondary,
    fontSize: 14,
    marginTop: 6,
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
  progressCard: {
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
    backgroundColor: Palette.surface,
  },
  progressTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  progressPercent: {
    color: Palette.accent,
    fontSize: 34,
    fontWeight: '800',
  },
  progressInfo: {
    flex: 1,
  },
  progressTitle: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  progressSubtext: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  chevron: {
    color: Palette.textMuted,
    fontSize: 20,
    fontWeight: '700',
  },
  mine: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  mineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  mineTitle: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  mineSubheading: {
    marginTop: 18,
    marginBottom: 4,
  },
  mineRating: {
    color: Palette.accent,
    fontSize: 18,
    fontWeight: '800',
  },
  mineEmpty: {
    color: Palette.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  mineRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  mineRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  mineRowTitle: {
    color: Palette.textBody,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  mineRowRating: {
    color: Palette.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  mineRowText: {
    color: Palette.textSecondary,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 4,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Palette.elevated,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Palette.accent,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
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
  resultsCount: {
    color: Palette.textMuted,
    fontSize: 13,
    marginBottom: 4,
  },
  carouselSection: {
    marginTop: 30,
  },
  photoRow: {
    gap: 8,
    paddingHorizontal: 24,
  },
  photo: {
    width: 110,
    height: 110,
    borderRadius: 12,
    backgroundColor: Palette.surface,
  },
  photoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  photoBadgeText: {
    color: Palette.text,
    fontSize: 11,
    fontWeight: '700',
  },
  addPhotoTile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Palette.borderStrong,
  },
  addPhotoPlus: {
    color: Palette.accent,
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 32,
  },
  addPhotoText: {
    color: Palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginTop: 6,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionLink: {
    color: Palette.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    color: Palette.text,
    fontSize: 21,
    fontWeight: '700',
    marginBottom: 10,
  },
  menuSectionTitle: {
    color: Palette.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 2,
  },
  emptyText: {
    fontSize: 15,
    color: Palette.textMuted,
  },
  moreButton: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    alignItems: 'center',
  },
  moreButtonText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '600',
  },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  variantRow: {
    paddingLeft: 20,
    paddingVertical: 10,
  },
  variantName: {
    fontSize: 15,
    fontWeight: '500',
  },
  discontinuedToggle: {
    color: Palette.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  dishInfo: {
    flex: 1,
    paddingRight: 16,
  },
  dishNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dishName: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '600',
    flexShrink: 1,
  },
  triedMark: {
    color: Palette.accent,
    fontSize: 14,
    fontWeight: '800',
  },
  dishMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 3,
  },
  dishSubtext: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: Palette.elevated,
  },
  pillText: {
    color: Palette.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  dishRating: {
    color: Palette.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  segmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 10,
    backgroundColor: Palette.surface,
    marginBottom: 10,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: Palette.elevated,
  },
  segmentText: {
    color: Palette.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: Palette.text,
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
  reviewBody: {
    flexDirection: 'row',
    gap: 12,
  },
  reviewBodyText: {
    flex: 1,
  },
  reviewText: {
    color: Palette.text,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 9,
  },
  reviewLikes: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 8,
  },
  reviewPhoto: {
    width: 64,
    height: 64,
    borderRadius: 10,
    marginTop: 10,
    backgroundColor: Palette.surface,
  },
});
