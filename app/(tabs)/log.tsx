import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import * as Location from "expo-location";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  createDishEntry,
  DishEntry,
  DishResult,
  LogDishCard,
} from "@/components/log-dish-card";
import { StarRatingInput } from "@/components/star-rating-input";
import { getBrandLocationIds } from "@/lib/brands";
import { supabase } from "@/lib/supabase";
import { fetchTags, Tag } from "@/lib/tags";
import { Palette } from "@/constants/theme";

type RestaurantResult = {
  id: string;

  name: string;

  city: string | null;

  state: string | null;

  latitude: number | null;

  longitude: number | null;

  address: string | null;

  google_place_id: string | null;
};

type DishMatch = DishResult & {
  score: number;

  is_exact: boolean;
};

// How close a typed name must be to an existing dish before we ask
// "Did you mean ...?" ("fry" vs "French Fries" qualifies, "fry sauce" doesn't).
const SIMILAR_DISH_PROMPT_SCORE = 0.5;

type GooglePlaceSuggestion = {
  placePrediction?: {
    placeId?: string;

    text?: {
      text?: string;
    };

    structuredFormat?: {
      mainText?: {
        text?: string;
      };

      secondaryText?: {
        text?: string;
      };
    };
  };
};

type GooglePlaceDetails = {
  google_place_id: string;

  name: string;

  address: string | null;

  city: string | null;

  state: string | null;

  latitude: number | null;

  longitude: number | null;

  website?: string | null;
};

type TaggableFriend = {
  id: string;
  username: string;
  display_name: string | null;
};

function createSessionToken() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,

    (character) => {
      const random = Math.floor(Math.random() * 16);

      const value = character === "x" ? random : (random & 0x3) | 0x8;

      return value.toString(16);
    },
  );
}

async function uploadPhoto(uri: string, userId: string) {
  const uriParts = uri.split(".");

  const rawExtension = uriParts[uriParts.length - 1]?.toLowerCase();

  const extension =
    rawExtension === "png" ? "png" : rawExtension === "webp" ? "webp" : "jpg";

  const contentType =
    extension === "png"
      ? "image/png"
      : extension === "webp"
        ? "image/webp"
        : "image/jpeg";

  const filePath = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;

  const response = await fetch(uri);

  const arrayBuffer = await response.arrayBuffer();

  const { error } = await supabase.storage
    .from("review-photos")
    .upload(filePath, arrayBuffer, {
      contentType,

      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  return filePath;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "es"}`;
}

// Logs a visit: one restaurant, any number of dishes, an optional restaurant
// rating, and the friends who came along.
export default function LogScreen() {
  // Restaurant and dish pages can open this tab with these filled in.
  const prefill = useLocalSearchParams<{
    restaurantId?: string;
    dishName?: string;
  }>();

  const [restaurantName, setRestaurantName] = useState("");

  const [restaurantResults, setRestaurantResults] = useState<
    RestaurantResult[]
  >([]);

  const [googleResults, setGoogleResults] = useState<GooglePlaceSuggestion[]>(
    [],
  );

  const [googleLoading, setGoogleLoading] = useState(false);

  const [selectedRestaurantId, setSelectedRestaurantId] = useState<
    string | null
  >(null);

  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);

  // A restaurant Google doesn't know, added by name ("Can't find it?").
  const [manualRestaurant, setManualRestaurant] = useState(false);

  const [atManualRestaurant, setAtManualRestaurant] = useState(false);

  const [gettingLocation, setGettingLocation] = useState(false);

  const [website, setWebsite] = useState<string | null>(null);

  const [address, setAddress] = useState("");

  const [city, setCity] = useState("");

  const [state, setState] = useState("");

  const [latitude, setLatitude] = useState<number | null>(null);

  const [longitude, setLongitude] = useState<number | null>(null);

  const [searchLatitude, setSearchLatitude] = useState<number | null>(null);

  const [searchLongitude, setSearchLongitude] = useState<number | null>(null);

  // Every saved location of the selected restaurant's brand, so dish
  // suggestions cover the whole chain's menu.
  const [menuLocationIds, setMenuLocationIds] = useState<string[]>([]);

  const [dishes, setDishes] = useState<DishEntry[]>(() => [createDishEntry()]);

  // Optional, separate from dish ratings. 0 means "not rated".
  const [restaurantRating, setRestaurantRating] = useState(0);

  const [restaurantNotes, setRestaurantNotes] = useState("");

  const [friends, setFriends] = useState<TaggableFriend[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [friendSearch, setFriendSearch] = useState("");
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [showFriends, setShowFriends] = useState(false);

  const [allTags, setAllTags] = useState<Tag[]>([]);

  const [loading, setLoading] = useState(false);

  const googleSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Groups Google autocomplete + details calls into one billed session.
  const googleSessionToken = useRef<string | null>(null);

  function getSessionToken() {
    if (!googleSessionToken.current) {
      googleSessionToken.current = createSessionToken();
    }

    return googleSessionToken.current;
  }

  function resetGoogleSession() {
    googleSessionToken.current = null;
  }

  const restaurantChosen =
    Boolean(selectedRestaurantId || googlePlaceId) ||
    (manualRestaurant && restaurantName.trim().length > 0);

  const namedDishes = dishes.filter((dish) => dish.name.trim());

  function updateDish(key: string, patch: Partial<DishEntry>) {
    setDishes((current) =>
      current.map((dish) => (dish.key === key ? { ...dish, ...patch } : dish)),
    );
  }

  function removeDish(key: string) {
    setDishes((current) => current.filter((dish) => dish.key !== key));
  }

  // A suggestion picked for one restaurant doesn't belong to another.
  function clearDishMatches() {
    setDishes((current) =>
      current.map((dish) => ({ ...dish, matchedDish: null })),
    );
  }

  async function loadMutualFollowers() {
    setFriendsLoading(true);
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("You must be signed in.");

      const { data: following, error: followingError } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", user.id);
      if (followingError) throw followingError;

      const { data: followers, error: followersError } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("following_id", user.id);
      if (followersError) throw followersError;

      const followerIds = new Set(
        (followers ?? []).map((row) => row.follower_id),
      );
      const mutualIds = (following ?? [])
        .map((row) => row.following_id)
        .filter((userId) => followerIds.has(userId));

      if (mutualIds.length === 0) {
        setFriends([]);
        setSelectedFriends([]);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", mutualIds);
      if (profilesError) throw profilesError;

      const available = (profiles ?? []) as TaggableFriend[];
      setFriends(available);
      setSelectedFriends((current) =>
        current.filter((id) => available.some((friend) => friend.id === id)),
      );
    } catch (error) {
      console.log("Could not load mutual followers:", error);
      Alert.alert("Friends error", "Could not load your mutual followers.");
    } finally {
      setFriendsLoading(false);
    }
  }

  function toggleFriend(friendId: string) {
    setSelectedFriends((current) =>
      current.includes(friendId)
        ? current.filter((id) => id !== friendId)
        : [...current, friendId],
    );
  }

  async function searchGooglePlaces(text: string) {
    const trimmed = text.trim();

    if (trimmed.length < 3) {
      setGoogleResults([]);

      setGoogleLoading(false);

      return;
    }

    setGoogleLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "google-places-autocomplete",

        {
          body: {
            input: trimmed,

            sessionToken: getSessionToken(),

            latitude: searchLatitude,

            longitude: searchLongitude,
          },
        },
      );

      if (error) {
        console.log("Google autocomplete function error:", error.message);

        setGoogleResults([]);

        return;
      }

      const suggestions = Array.isArray(data?.suggestions)
        ? data.suggestions
        : [];

      setGoogleResults(suggestions);
    } catch (error) {
      console.log("Google autocomplete error:", error);

      setGoogleResults([]);
    } finally {
      setGoogleLoading(false);
    }
  }

  function clearRestaurant() {
    setSelectedRestaurantId(null);

    setGooglePlaceId(null);

    setManualRestaurant(false);

    setAtManualRestaurant(false);

    setWebsite(null);

    setRestaurantRating(0);

    setRestaurantNotes("");

    setAddress("");

    setCity("");

    setState("");

    setLatitude(null);

    setLongitude(null);

    clearDishMatches();
  }

  async function searchRestaurants(text: string) {
    setRestaurantName(text);

    clearRestaurant();

    const trimmed = text.trim();

    if (googleSearchTimeout.current) {
      clearTimeout(googleSearchTimeout.current);
    }

    if (trimmed.length < 2) {
      setRestaurantResults([]);

      setGoogleResults([]);

      setGoogleLoading(false);

      return;
    }

    const { data, error } = await supabase
      .from("restaurants")
      .select(
        "id, name, city, state, latitude, longitude, address, google_place_id",
      )
      .ilike("name", `%${trimmed}%`)
      .limit(8);

    if (error) {
      console.log("Restaurant search error:", error.message);
    } else {
      setRestaurantResults((data ?? []) as RestaurantResult[]);
    }

    if (trimmed.length >= 3) {
      setGoogleLoading(true);

      googleSearchTimeout.current = setTimeout(() => {
        searchGooglePlaces(trimmed);
      }, 350);
    } else {
      setGoogleResults([]);

      setGoogleLoading(false);
    }
  }

  function selectRestaurant(restaurant: RestaurantResult) {
    if (googleSearchTimeout.current) {
      clearTimeout(googleSearchTimeout.current);
    }

    clearRestaurant();

    setRestaurantName(restaurant.name);

    setCity(restaurant.city ?? "");

    setState(restaurant.state ?? "");

    setAddress(restaurant.address ?? "");

    setGooglePlaceId(restaurant.google_place_id ?? null);

    setLatitude(
      restaurant.latitude !== null ? Number(restaurant.latitude) : null,
    );

    setLongitude(
      restaurant.longitude !== null ? Number(restaurant.longitude) : null,
    );

    setSelectedRestaurantId(restaurant.id);

    setRestaurantResults([]);

    setGoogleResults([]);

    setGoogleLoading(false);
  }

  async function selectGoogleRestaurant(suggestion: GooglePlaceSuggestion) {
    const placeId = suggestion.placePrediction?.placeId;

    if (!placeId) {
      Alert.alert(
        "Google Places error",

        "This restaurant result did not include a place ID.",
      );

      return;
    }

    if (googleSearchTimeout.current) {
      clearTimeout(googleSearchTimeout.current);
    }

    setGoogleLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "google-place-details",

        {
          body: {
            placeId,

            sessionToken: getSessionToken(),
          },
        },
      );

      if (error) {
        throw new Error(error.message);
      }

      const details = data as GooglePlaceDetails;

      if (!details?.google_place_id || !details?.name) {
        throw new Error("Google did not return complete place details.");
      }

      const { data: existingRestaurant, error: existingError } = await supabase
        .from("restaurants")
        .select(
          "id, name, city, state, latitude, longitude, address, google_place_id",
        )
        .eq("google_place_id", details.google_place_id)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      if (existingRestaurant) {
        selectRestaurant(existingRestaurant as RestaurantResult);

        resetGoogleSession();

        return;
      }

      clearRestaurant();

      setRestaurantName(details.name);

      setGooglePlaceId(details.google_place_id);

      setWebsite(details.website ?? null);

      setAddress(details.address ?? "");

      setCity(details.city ?? "");

      setState(details.state ?? "");

      setLatitude(details.latitude !== null ? Number(details.latitude) : null);

      setLongitude(
        details.longitude !== null ? Number(details.longitude) : null,
      );

      setRestaurantResults([]);

      setGoogleResults([]);

      resetGoogleSession();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load this restaurant.";

      Alert.alert("Google Places error", message);
    } finally {
      setGoogleLoading(false);
    }
  }

  function addRestaurantByName() {
    if (googleSearchTimeout.current) {
      clearTimeout(googleSearchTimeout.current);
    }

    clearRestaurant();

    setManualRestaurant(true);

    setRestaurantResults([]);

    setGoogleResults([]);

    setGoogleLoading(false);
  }

  // For a restaurant added by name: save where the user is standing as its
  // location, and fill in the city and state from it.
  async function toggleAtManualRestaurant(value: boolean) {
    if (!value) {
      setAtManualRestaurant(false);

      setLatitude(null);

      setLongitude(null);

      setCity("");

      setState("");

      return;
    }

    setGettingLocation(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Location permission needed",
          "Allow location access to save where this restaurant is.",
        );

        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLatitude(position.coords.latitude);

      setLongitude(position.coords.longitude);

      const [place] = await Location.reverseGeocodeAsync(position.coords);

      setCity(place?.city ?? "");

      setState(place?.region ?? "");

      setAtManualRestaurant(true);
    } catch (error) {
      Alert.alert(
        "Location error",
        error instanceof Error ? error.message : "Could not get your location.",
      );
    } finally {
      setGettingLocation(false);
    }
  }

  // Fuzzy search ("fry" finds "French Fries"), one result per dish name.
  async function searchDishMatches(
    locationIds: string[],
    text: string,
    limit = 8,
  ) {
    const { data, error } = await supabase.rpc("search_dishes", {
      p_location_ids: locationIds,

      p_query: text,

      p_current_restaurant_id: selectedRestaurantId,

      p_limit: limit,
    });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as DishMatch[];
  }

  async function searchMenu(text: string): Promise<DishResult[]> {
    if (menuLocationIds.length === 0) {
      return [];
    }

    try {
      return await searchDishMatches(menuLocationIds, text);
    } catch (error) {
      console.log("Dish search error:", error);
      return [];
    }
  }

  function askAboutSimilarDish(match: DishResult, typedName: string) {
    return new Promise<"use" | "new" | "cancel">((resolve) => {
      Alert.alert(
        `Did you mean "${match.name}"?`,

        `"${match.name}" is already on this restaurant's menu. Using it keeps all its ratings together.`,

        [
          { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") },

          { text: `Add "${typedName}"`, onPress: () => resolve("new") },

          { text: `Use "${match.name}"`, onPress: () => resolve("use") },
        ],

        { cancelable: true, onDismiss: () => resolve("cancel") },
      );
    });
  }

  // Before creating a new dish, use an exact match ("Large Fries" -> "Fries")
  // or ask about a close one ("Fry" -> "French Fries"). Returns undefined if
  // the user cancels.
  async function resolveDishMatch(
    dish: DishEntry,
  ): Promise<DishResult | null | undefined> {
    if (dish.matchedDish || menuLocationIds.length === 0) {
      return dish.matchedDish;
    }

    try {
      const [best] = await searchDishMatches(
        menuLocationIds,
        dish.name.trim(),
        1,
      );

      if (best?.is_exact) {
        return best;
      }

      if (best && best.score >= SIMILAR_DISH_PROMPT_SCORE) {
        const choice = await askAboutSimilarDish(best, dish.name.trim());

        if (choice === "cancel") return undefined;

        if (choice === "use") return best;
      }
    } catch (error) {
      console.log("Similar dish check error:", error);
    }

    return null;
  }

  async function findOrCreateRestaurant() {
    if (selectedRestaurantId) {
      return selectedRestaurantId;
    }

    const trimmedName = restaurantName.trim();

    if (googlePlaceId) {
      const { data: googleMatch, error: googleMatchError } = await supabase
        .from("restaurants")
        .select("id")
        .eq("google_place_id", googlePlaceId)
        .maybeSingle();

      if (googleMatchError) {
        throw new Error(googleMatchError.message);
      }

      if (googleMatch) {
        return googleMatch.id as string;
      }
    } else if (city.trim()) {
      // A restaurant added by name: reuse one with the same name in the same
      // city. Without a city we can't tell same-named places apart.
      const { data: exactMatches, error: exactError } = await supabase
        .from("restaurants")
        .select("id")
        .is("google_place_id", null)
        .ilike("name", trimmedName)
        .ilike("city", city.trim())
        .ilike("state", state.trim())
        .limit(1);

      if (exactError) {
        throw new Error(exactError.message);
      }

      if (exactMatches && exactMatches.length > 0) {
        return exactMatches[0].id as string;
      }
    }

    const { data: newRestaurant, error: insertError } = await supabase
      .from("restaurants")
      .insert({
        name: trimmedName,

        city: city.trim(),

        state: state.trim(),

        address: address.trim() || null,

        latitude,

        longitude,

        google_place_id: googlePlaceId,

        website,
      })
      .select("id")
      .single();

    if (insertError || !newRestaurant) {
      throw new Error(insertError?.message || "Could not create restaurant.");
    }

    return newRestaurant.id as string;
  }

  async function findOrCreateDish(
    restaurantId: string,
    dishName: string,
    match: DishResult | null,
  ) {
    // A dish matched at another location of the brand gets its own row here,
    // so the review stays tied to the location the user actually visited.
    if (match?.restaurant_id === restaurantId) {
      return match.id;
    }

    // Reuse the brand's existing name so the dish groups across locations.
    const name = match?.name ?? dishName;

    const [existing] = await searchDishMatches([restaurantId], name, 1);

    if (existing?.is_exact) {
      return existing.id;
    }

    const { data: newDish, error: insertError } = await supabase
      .from("dishes")
      .insert({
        restaurant_id: restaurantId,

        name,
      })
      .select("id")
      .single();

    if (insertError || !newDish) {
      throw new Error(insertError?.message || "Could not create dish.");
    }

    return newDish.id as string;
  }

  // Each save is one visit to this location, with the restaurant stars if
  // given; the restaurant page counts visits and averages the stars.
  async function recordVisit(userId: string, restaurantId: string) {
    const { error } = await supabase.from("restaurant_ratings").insert({
      user_id: userId,
      restaurant_id: restaurantId,
      rating: restaurantRating > 0 ? restaurantRating : null,
      notes: restaurantNotes.trim() || null,
    });

    if (error) {
      console.log("Visit error:", error.message);
    }

    return error?.message ?? null;
  }

  // Saves one dish review plus its friend tags and dish tag votes. Throws if
  // the review itself fails; returns the extras that failed.
  async function saveDish(
    userId: string,
    restaurantId: string,
    dish: DishEntry,
    match: DishResult | null,
  ) {
    const dishId = await findOrCreateDish(restaurantId, dish.name.trim(), match);

    const photoPath = dish.photoUri
      ? await uploadPhoto(dish.photoUri, userId)
      : null;

    const { data: createdReview, error: reviewError } = await supabase
      .from("reviews")
      .insert({
        user_id: userId,
        dish_id: dishId,
        rating: dish.rating,
        review_text: dish.notes.trim() || null,
        photo_path: photoPath,
      })
      .select("id")
      .single();

    if (reviewError || !createdReview) {
      if (photoPath) {
        await supabase.storage.from("review-photos").remove([photoPath]);
      }

      throw new Error(reviewError?.message || "Could not save the review.");
    }

    const failedExtras: string[] = [];

    if (selectedFriends.length > 0) {
      const { error: tagsError } = await supabase.from("review_tags").insert(
        selectedFriends.map((friendId) => ({
          review_id: createdReview.id,
          tagged_user_id: friendId,
        })),
      );
      if (tagsError) {
        console.log("Review tags error:", tagsError.message);
        failedExtras.push("friend tags");
      }
    }

    // A tag shows publicly once enough people vote for it, so each user's
    // tags are votes; re-tagging the same dish is ignored.
    if (dish.tags.length > 0) {
      const { error: dishTagsError } = await supabase
        .from("dish_tag_votes")
        .upsert(
          dish.tags.map((tag) => ({
            user_id: userId,
            dish_id: dishId,
            tag,
          })),
          { onConflict: "user_id,dish_id,tag", ignoreDuplicates: true },
        );
      if (dishTagsError) {
        console.log("Dish tags error:", dishTagsError.message);
        failedExtras.push("dish tags");
      }
    }

    return failedExtras;
  }

  async function logVisit() {
    if (!restaurantChosen) {
      Alert.alert(
        "Pick a restaurant",
        "Search for where you ate, then pick it from the list.",
      );

      return;
    }

    const unratedDish = namedDishes.find((dish) => dish.rating < 0.5);

    if (unratedDish) {
      Alert.alert(
        "Missing rating",
        `Give "${unratedDish.name.trim()}" a rating, or remove it.`,
      );

      return;
    }

    const unnamedDish = dishes.find(
      (dish) =>
        !dish.name.trim() && (dish.rating > 0 || dish.notes || dish.photoUri),
    );

    if (unnamedDish) {
      Alert.alert("Missing dish name", "Name each dish you rated, or remove it.");

      return;
    }

    // No dishes means the user is only rating the restaurant.
    if (namedDishes.length === 0) {
      if (restaurantRating < 0.5) {
        Alert.alert(
          "Nothing to log",
          "Add a dish, or rate the restaurant to log just the restaurant.",
        );

        return;
      }

      if (selectedFriends.length > 0) {
        Alert.alert(
          "Add a dish",
          "Friends are tagged on dish reviews. Add a dish, or clear your friends to just rate the restaurant.",
        );

        return;
      }
    }

    const matches = new Map<string, DishResult | null>();

    for (const dish of namedDishes) {
      const match = await resolveDishMatch(dish);

      if (match === undefined) {
        return;
      }

      matches.set(dish.key, match);
    }

    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);

      Alert.alert("Error", "You must be signed in to log a visit.");

      return;
    }

    try {
      const restaurantId = await findOrCreateRestaurant();

      const failedDishes: DishEntry[] = [];
      const failedExtras = new Set<string>();

      for (const dish of namedDishes) {
        try {
          const extras = await saveDish(
            user.id,
            restaurantId,
            dish,
            matches.get(dish.key) ?? null,
          );

          extras.forEach((extra) => failedExtras.add(extra));
        } catch (error) {
          console.log(`Could not save ${dish.name}:`, error);
          failedDishes.push(dish);
        }
      }

      // Skip the visit if every dish failed; retrying will record it.
      const anythingSaved =
        namedDishes.length === 0 || failedDishes.length < namedDishes.length;

      if (anythingSaved) {
        const visitError = await recordVisit(user.id, restaurantId);

        if (visitError) {
          if (namedDishes.length === 0) throw new Error(visitError);

          if (restaurantRating > 0) failedExtras.add("the restaurant rating");
        }
      }

      if (failedDishes.length > 0) {
        // Keep only what didn't save so the user can retry it.
        setDishes(failedDishes);

        Alert.alert(
          "Some dishes didn't save",
          `${failedDishes.map((dish) => dish.name.trim()).join(", ")} couldn't be saved. They're still here so you can try again.`,
        );

        return;
      }

      const savedCount = namedDishes.length;

      Alert.alert(
        savedCount === 0 ? "Rated!" : "Logged!",
        savedCount === 0
          ? `Your rating for ${restaurantName.trim()} was saved.`
          : failedExtras.size === 0
            ? `${plural(savedCount, "dish")} from ${restaurantName.trim()} added to your diary.`
            : `${plural(savedCount, "dish")} added to your diary, but ${[...failedExtras].join(" and ")} couldn't be saved.`,
      );

      resetForm();

      router.navigate("/(tabs)");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";

      Alert.alert("Log error", message);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setRestaurantName("");

    setRestaurantResults([]);

    setGoogleResults([]);

    clearRestaurant();

    setDishes([createDishEntry()]);

    setSelectedFriends([]);

    setFriendSearch("");

    setShowFriends(false);

    resetGoogleSession();
  }

  useEffect(() => {
    async function loadSearchLocation() {
      try {
        const existingPermission =
          await Location.getForegroundPermissionsAsync();

        let permission = existingPermission;

        if (!existingPermission.granted) {
          permission = await Location.requestForegroundPermissionsAsync();
        }

        if (!permission.granted) {
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        setSearchLatitude(location.coords.latitude);

        setSearchLongitude(location.coords.longitude);
      } catch (error) {
        console.log("Could not get location for restaurant search:", error);
      }
    }

    loadSearchLocation();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMenuLocations() {
      try {
        if (selectedRestaurantId) {
          const { data, error } = await supabase
            .from("restaurants")
            .select("brand_id")
            .eq("id", selectedRestaurantId)
            .maybeSingle();

          if (error) throw new Error(error.message);

          const ids = await getBrandLocationIds(
            selectedRestaurantId,
            data?.brand_id ?? null,
          );

          if (!cancelled) setMenuLocationIds(ids);
          return;
        }

        // A Google place we haven't saved yet may still belong to a known chain.
        if (googlePlaceId) {
          const { data: brandId, error } = await supabase.rpc("find_brand", {
            p_name: restaurantName,
            p_website: website,
          });

          if (error) throw new Error(error.message);

          if (!brandId) {
            if (!cancelled) setMenuLocationIds([]);
            return;
          }

          const { data, error: locationsError } = await supabase
            .from("restaurants")
            .select("id")
            .eq("brand_id", brandId);

          if (locationsError) throw new Error(locationsError.message);

          if (!cancelled) {
            setMenuLocationIds((data ?? []).map((row) => row.id as string));
          }
          return;
        }

        if (!cancelled) setMenuLocationIds([]);
      } catch (error) {
        console.log("Could not load brand menu:", error);
        if (!cancelled) setMenuLocationIds([]);
      }
    }

    loadMenuLocations();

    return () => {
      cancelled = true;
    };
    // restaurantName and website are set together with googlePlaceId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRestaurantId, googlePlaceId]);

  useEffect(() => {
    const restaurantId = prefill.restaurantId;

    if (!restaurantId) {
      return;
    }

    const prefillDishName = prefill.dishName;

    let cancelled = false;

    async function prefillFromParams() {
      const { data, error } = await supabase
        .from("restaurants")
        .select(
          "id, name, city, state, latitude, longitude, address, google_place_id",
        )
        .eq("id", restaurantId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        console.log("Could not prefill restaurant:", error?.message);
      } else {
        selectRestaurant(data as RestaurantResult);

        setDishes([createDishEntry(prefillDishName ?? "")]);
      }

      // Clear so reopening the tab later starts fresh.
      router.setParams({ restaurantId: undefined, dishName: undefined });
    }

    prefillFromParams();

    return () => {
      cancelled = true;
    };
    // selectRestaurant only sets state; rerun only when new params arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill.restaurantId, prefill.dishName]);

  useEffect(() => {
    fetchTags()
      .then(setAllTags)
      .catch((error) => console.log("Could not load tags:", error));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMutualFollowers();
    }, []),
  );

  const showRestaurantSearch = !restaurantChosen;

  const restaurantSubtitle = manualRestaurant
    ? atManualRestaurant
      ? [city, state].filter(Boolean).join(", ") || "Added by you"
      : "Added by you"
    : address || [city, state].filter(Boolean).join(", ");

  const visibleFriends = friends.filter((friend) =>
    `${friend.username} ${friend.display_name ?? ""}`
      .toLowerCase()
      .includes(friendSearch.trim().toLowerCase()),
  );

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Log a Visit</Text>

        {showRestaurantSearch ? (
          <>
            <Text style={styles.label}>Where did you eat?</Text>

            <TextInput
              style={styles.input}
              placeholder="Search restaurants"
              placeholderTextColor={Palette.textMuted}
              value={restaurantName}
              onChangeText={searchRestaurants}
            />

            {restaurantResults.length > 0 ? (
              <View style={styles.resultsBox}>
                <Text style={styles.resultsLabel}>On Food App</Text>

                {restaurantResults.map((restaurant) => {
                  const locationText =
                    restaurant.address ||
                    [restaurant.city, restaurant.state]
                      .filter(Boolean)
                      .join(", ");

                  return (
                    <TouchableOpacity
                      key={restaurant.id}
                      style={styles.resultItem}
                      onPress={() => selectRestaurant(restaurant)}
                    >
                      <Text style={styles.resultName}>{restaurant.name}</Text>

                      {locationText ? (
                        <Text style={styles.resultSubtext}>{locationText}</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {googleLoading ? (
              <View style={styles.googleLoadingRow}>
                <ActivityIndicator size="small" />

                <Text style={styles.googleLoadingText}>Searching nearby…</Text>
              </View>
            ) : null}

            {googleResults.length > 0 ? (
              <View style={styles.resultsBox}>
                <Text style={styles.resultsLabel}>Nearby on Google</Text>

                {googleResults.map((suggestion, index) => {
                  const prediction = suggestion.placePrediction;

                  const placeId = prediction?.placeId ?? `google-${index}`;

                  const mainText =
                    prediction?.structuredFormat?.mainText?.text ??
                    prediction?.text?.text ??
                    "Restaurant";

                  const secondaryText =
                    prediction?.structuredFormat?.secondaryText?.text ?? "";

                  return (
                    <TouchableOpacity
                      key={placeId}
                      style={styles.resultItem}
                      onPress={() => selectGoogleRestaurant(suggestion)}
                    >
                      <Text style={styles.resultName}>{mainText}</Text>

                      {secondaryText ? (
                        <Text style={styles.resultSubtext}>
                          {secondaryText}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {restaurantName.trim().length >= 2 && !googleLoading ? (
              <TouchableOpacity onPress={addRestaurantByName}>
                <Text style={styles.fallbackLink}>
                  Can’t find it? Add “{restaurantName.trim()}” by name
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.restaurantCard}>
              <View style={styles.restaurantInfo}>
                <Text style={styles.restaurantName} numberOfLines={1}>
                  📍 {restaurantName.trim()}
                </Text>

                {restaurantSubtitle ? (
                  <Text style={styles.restaurantSubtitle} numberOfLines={1}>
                    {restaurantSubtitle}
                  </Text>
                ) : null}
              </View>

              <TouchableOpacity
                onPress={() => searchRestaurants("")}
                disabled={loading}
              >
                <Text style={styles.changeText}>Change</Text>
              </TouchableOpacity>
            </View>

            {manualRestaurant ? (
              <View style={styles.hereRow}>
                <Text style={styles.hereText}>
                  I’m here right now (saves its location)
                </Text>

                {gettingLocation ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Switch
                    value={atManualRestaurant}
                    onValueChange={toggleAtManualRestaurant}
                    trackColor={{ true: Palette.accent }}
                  />
                )}
              </View>
            ) : null}
          </>
        )}

        <Text style={[styles.label, styles.sectionLabel]}>
          What did you eat?
        </Text>

        {dishes.map((dish) => (
          <LogDishCard
            key={dish.key}
            entry={dish}
            allTags={allTags}
            onSearch={searchMenu}
            onChange={(patch) => updateDish(dish.key, patch)}
            onRemove={dishes.length > 1 ? () => removeDish(dish.key) : undefined}
            disabled={loading}
          />
        ))}

        <TouchableOpacity
          style={styles.addDishButton}
          onPress={() => setDishes((current) => [...current, createDishEntry()])}
          disabled={loading}
        >
          <Text style={styles.addDishText}>+ Add another dish</Text>
        </TouchableOpacity>

        <View style={styles.optionalLabelRow}>
          <Text style={[styles.label, styles.sectionLabel]}>
            {restaurantChosen
              ? `How was ${restaurantName.trim()}?`
              : "How was the restaurant?"}{" "}
            <Text style={styles.optionalText}>(optional)</Text>
          </Text>

          {restaurantRating > 0 ? (
            <TouchableOpacity onPress={() => setRestaurantRating(0)}>
              <Text style={styles.clearRatingText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <StarRatingInput
          value={restaurantRating}
          onChange={setRestaurantRating}
          compact
        />

        {/* Revealed once the restaurant is rated, to keep the screen short. */}
        {restaurantRating > 0 || restaurantNotes ? (
          <TextInput
            style={styles.restaurantNotesInput}
            placeholder="What stood out about the restaurant? (optional)"
            placeholderTextColor={Palette.textMuted}
            multiline
            maxLength={2000}
            value={restaurantNotes}
            onChangeText={setRestaurantNotes}
            editable={!loading}
          />
        ) : null}

        <TouchableOpacity onPress={() => setShowFriends((open) => !open)}>
          <Text style={styles.friendsToggle}>
            {showFriends
              ? "− Who’d you go with?"
              : selectedFriends.length > 0
                ? `+ Who’d you go with? (${selectedFriends.length} selected)`
                : "+ Who’d you go with?"}
          </Text>
        </TouchableOpacity>

        {showFriends ? (
          <View style={styles.friendsSection}>
            {friendsLoading ? (
              <ActivityIndicator size="small" style={styles.friendsLoading} />
            ) : friends.length === 0 ? (
              <Text style={styles.friendsHelper}>No mutual followers yet.</Text>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Search your mutual followers..."
                  placeholderTextColor={Palette.textMuted}
                  value={friendSearch}
                  onChangeText={setFriendSearch}
                />

                {visibleFriends.map((friend) => {
                  const selected = selectedFriends.includes(friend.id);

                  return (
                    <TouchableOpacity
                      key={friend.id}
                      style={[
                        styles.friendRow,
                        selected && styles.friendSelected,
                      ]}
                      onPress={() => toggleFriend(friend.id)}
                      disabled={loading}
                    >
                      <View>
                        <Text style={styles.friendName}>
                          {friend.display_name || friend.username}
                        </Text>

                        <Text style={styles.friendHandle}>
                          @{friend.username}
                        </Text>
                      </View>

                      <Text style={styles.friendCheck}>
                        {selected ? "✓" : "+"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={logVisit}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading
              ? "Saving..."
              : namedDishes.length > 0
                ? `Log ${plural(namedDishes.length, "dish")}`
                : "Save Restaurant Rating"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },

  container: {
    flexGrow: 1,

    padding: 24,

    paddingTop: 70,

    paddingBottom: 40,

    backgroundColor: Palette.background,
  },

  title: {
    color: Palette.text,

    fontSize: 30,

    fontWeight: "700",

    marginBottom: 24,
  },

  label: {
    color: Palette.text,

    fontSize: 14,

    fontWeight: "600",

    marginBottom: 6,
  },

  sectionLabel: {
    fontSize: 16,

    marginTop: 18,

    marginBottom: 10,
  },

  optionalText: {
    color: Palette.textMuted,

    fontWeight: "400",
  },

  input: {
    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    padding: 14,

    fontSize: 16,

    color: Palette.text,

    marginBottom: 12,

    backgroundColor: Palette.background,
  },

  resultsBox: {
    borderWidth: 1,

    borderColor: Palette.border,

    borderRadius: 10,

    marginBottom: 12,

    overflow: "hidden",

    backgroundColor: Palette.surface,
  },

  resultsLabel: {
    fontSize: 12,

    fontWeight: "700",

    color: Palette.textMuted,

    paddingHorizontal: 14,

    paddingTop: 10,

    paddingBottom: 4,

    textTransform: "uppercase",
  },

  resultItem: {
    paddingHorizontal: 14,

    paddingVertical: 12,

    borderTopWidth: 1,

    borderTopColor: Palette.border,
  },

  resultName: {
    fontSize: 16,

    fontWeight: "600",

    color: Palette.text,
  },

  resultSubtext: {
    fontSize: 13,

    color: Palette.textMuted,

    marginTop: 2,
  },

  googleLoadingRow: {
    flexDirection: "row",

    alignItems: "center",

    gap: 8,

    marginBottom: 12,
  },

  googleLoadingText: {
    fontSize: 14,

    color: Palette.textMuted,
  },

  fallbackLink: {
    fontSize: 14,

    color: Palette.textSecondary,

    textDecorationLine: "underline",

    marginBottom: 8,
  },

  restaurantCard: {
    flexDirection: "row",

    alignItems: "center",

    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 14,

    padding: 14,

    backgroundColor: Palette.surface,
  },

  restaurantInfo: {
    flex: 1,

    paddingRight: 12,
  },

  restaurantName: {
    fontSize: 17,

    fontWeight: "700",

    color: Palette.text,
  },

  restaurantSubtitle: {
    fontSize: 13,

    color: Palette.textMuted,

    marginTop: 3,
  },

  changeText: {
    fontSize: 14,

    fontWeight: "600",

    color: Palette.accent,
  },

  hereRow: {
    flexDirection: "row",

    alignItems: "center",

    justifyContent: "space-between",

    marginTop: 10,
  },

  hereText: {
    flex: 1,

    fontSize: 14,

    color: Palette.textSecondary,

    paddingRight: 12,
  },

  addDishButton: {
    borderWidth: 1,

    borderStyle: "dashed",

    borderColor: Palette.borderStrong,

    borderRadius: 14,

    paddingVertical: 14,

    alignItems: "center",
  },

  addDishText: {
    fontSize: 15,

    fontWeight: "600",

    color: Palette.textSecondary,
  },

  optionalLabelRow: {
    flexDirection: "row",

    justifyContent: "space-between",

    alignItems: "baseline",
  },

  clearRatingText: {
    fontSize: 13,

    color: Palette.textMuted,

    fontWeight: "600",
  },

  restaurantNotesInput: {
    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    padding: 12,

    minHeight: 80,

    fontSize: 15,

    color: Palette.text,

    textAlignVertical: "top",

    marginBottom: 16,
  },

  friendsToggle: {
    fontSize: 15,

    fontWeight: "600",

    color: Palette.textSecondary,

    marginBottom: 12,
  },

  friendsSection: {
    marginBottom: 8,
  },

  friendsLoading: {
    marginVertical: 12,
  },

  friendsHelper: {
    fontSize: 14,

    color: Palette.textMuted,

    marginBottom: 12,
  },

  friendRow: {
    flexDirection: "row",

    alignItems: "center",

    justifyContent: "space-between",

    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    paddingHorizontal: 14,

    paddingVertical: 10,

    marginBottom: 8,
  },

  friendSelected: {
    borderColor: Palette.accent,
  },

  friendName: {
    fontSize: 15,

    fontWeight: "600",

    color: Palette.text,
  },

  friendHandle: {
    fontSize: 13,

    color: Palette.textMuted,

    marginTop: 2,
  },

  friendCheck: {
    fontSize: 18,

    fontWeight: "700",

    color: Palette.accent,
  },

  button: {
    backgroundColor: Palette.accent,

    borderRadius: 12,

    paddingVertical: 16,

    alignItems: "center",

    marginTop: 16,
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  buttonText: {
    color: Palette.text,

    fontSize: 17,

    fontWeight: "700",
  },
});
