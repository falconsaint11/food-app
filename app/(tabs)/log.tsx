import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";

import * as Location from "expo-location";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { StarRatingInput } from "@/components/star-rating-input";
import { dishKey, getBrandLocationIds } from "@/lib/brands";
import { supabase } from "@/lib/supabase";
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

type DishResult = {
  id: string;

  name: string;

  restaurant_id: string;
};

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

export default function LogScreen() {
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

  const [website, setWebsite] = useState<string | null>(null);

  const [address, setAddress] = useState("");

  const [city, setCity] = useState("");

  const [state, setState] = useState("");

  const [latitude, setLatitude] = useState<number | null>(null);

  const [longitude, setLongitude] = useState<number | null>(null);

  const [searchLatitude, setSearchLatitude] = useState<number | null>(null);

  const [searchLongitude, setSearchLongitude] = useState<number | null>(null);

  const [gettingLocation, setGettingLocation] = useState(false);

  const [dishName, setDishName] = useState("");

  const [dishResults, setDishResults] = useState<DishResult[]>([]);

  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);

  // A suggestion can come from another location of the same brand.
  const [selectedDishRestaurantId, setSelectedDishRestaurantId] = useState<
    string | null
  >(null);

  // Every saved location of the selected restaurant's brand, so dish
  // suggestions cover the whole chain's menu.
  const [menuLocationIds, setMenuLocationIds] = useState<string[]>([]);

  const [rating, setRating] = useState(0);

  // Optional, separate from the dish rating. 0 means "not rated".
  const [restaurantRating, setRestaurantRating] = useState(0);

  const [reviewText, setReviewText] = useState("");
  const [friends, setFriends] = useState<TaggableFriend[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [friendSearch, setFriendSearch] = useState("");
  const [friendsLoading, setFriendsLoading] = useState(true);

  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  const googleSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const googleSessionToken = useRef(createSessionToken());

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

  function resetGoogleSession() {
    googleSessionToken.current = createSessionToken();
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

  // Show the user's existing rating for this location; logging again updates it.
  useEffect(() => {
    if (!selectedRestaurantId) {
      return;
    }

    let cancelled = false;

    async function loadExistingRestaurantRating() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data, error } = await supabase
        .from("restaurant_ratings")
        .select("rating")
        .eq("user_id", user.id)
        .eq("restaurant_id", selectedRestaurantId)
        .maybeSingle();

      if (error) {
        console.log("Restaurant rating lookup error:", error.message);
        return;
      }

      if (!cancelled && data) {
        setRestaurantRating((current) =>
          current > 0 ? current : Number(data.rating),
        );
      }
    }

    loadExistingRestaurantRating();

    return () => {
      cancelled = true;
    };
  }, [selectedRestaurantId]);

  useFocusEffect(
    useCallback(() => {
      loadMutualFollowers();
    }, []),
  );

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

            sessionToken: googleSessionToken.current,

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

  async function searchRestaurants(text: string) {
    setRestaurantName(text);

    setSelectedRestaurantId(null);

    setGooglePlaceId(null);

    setWebsite(null);

    setRestaurantRating(0);

    setAddress("");

    setCity("");

    setState("");

    setLatitude(null);

    setLongitude(null);

    setDishName("");

    setSelectedDishId(null);

    setDishResults([]);

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
        `

        id,

        name,

        city,

        state,

        latitude,

        longitude,

        address,

        google_place_id

      `,
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

    setDishName("");

    setSelectedDishId(null);

    setDishResults([]);
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

            sessionToken: googleSessionToken.current,
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
          `

            id,

            name,

            city,

            state,

            latitude,

            longitude,

            address,

            google_place_id

          `,
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

      setSelectedRestaurantId(null);

      setRestaurantResults([]);

      setGoogleResults([]);

      setDishName("");

      setSelectedDishId(null);

      setDishResults([]);

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

  async function useCurrentLocation() {
    if (selectedRestaurantId) {
      Alert.alert(
        "Existing restaurant",

        "Location is already tied to this restaurant record.",
      );

      return;
    }

    Alert.alert(
      "Use current location?",

      "Only use this if you are currently at the restaurant.",

      [
        {
          text: "Cancel",

          style: "cancel",
        },

        {
          text: "Use Location",

          onPress: getCurrentLocation,
        },
      ],
    );
  }

  async function getCurrentLocation() {
    setGettingLocation(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Location permission needed",

          "Allow location access if you want to save this restaurant's location.",
        );

        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLatitude(location.coords.latitude);

      setLongitude(location.coords.longitude);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not get your location.";

      Alert.alert("Location error", message);
    } finally {
      setGettingLocation(false);
    }
  }

  function removeLocation() {
    setLatitude(null);

    setLongitude(null);
  }

  async function searchDishes(text: string) {
    setDishName(text);

    setSelectedDishId(null);

    const trimmed = text.trim();

    if (trimmed.length < 2) {
      setDishResults([]);

      return;
    }

    if (menuLocationIds.length === 0) {
      setDishResults([]);

      return;
    }

    const { data, error } = await supabase

      .from("dishes")

      .select("id, name, restaurant_id")

      .in("restaurant_id", menuLocationIds)

      .ilike("name", `%${trimmed}%`)

      .limit(30);

    if (error) {
      console.log("Dish search error:", error.message);

      return;
    }

    // Each location has its own row for the same dish; show each name once,
    // preferring this location's row.
    const uniqueDishes = new Map<string, DishResult>();

    for (const dish of (data ?? []) as DishResult[]) {
      const key = dishKey(dish.name);
      const existing = uniqueDishes.get(key);

      if (!existing || dish.restaurant_id === selectedRestaurantId) {
        uniqueDishes.set(key, dish);
      }
    }

    setDishResults([...uniqueDishes.values()].slice(0, 8));
  }

  function selectDish(dish: DishResult) {
    setDishName(dish.name);

    setSelectedDishId(dish.id);

    setSelectedDishRestaurantId(dish.restaurant_id);

    setDishResults([]);
  }

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Photo permission needed",

        "Allow photo access to add a photo to your review.",
      );

      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],

      allowsEditing: true,

      aspect: [4, 3],

      quality: 0.8,
    });

    if (result.canceled) {
      return;
    }

    setPhotoUri(result.assets[0].uri);
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

  async function findOrCreateRestaurant() {
    if (selectedRestaurantId) {
      return selectedRestaurantId;
    }

    const trimmedName = restaurantName.trim();

    const trimmedCity = city.trim();

    const trimmedState = state.trim();

    const trimmedAddress = address.trim();

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
        return googleMatch.id;
      }
    }

    let exactQuery = supabase

      .from("restaurants")

      .select("id, name, city, state")

      .ilike("name", trimmedName);

    exactQuery = exactQuery.ilike("city", trimmedCity);

    exactQuery = exactQuery.ilike("state", trimmedState);

    const { data: exactMatches, error: exactError } = await exactQuery.limit(1);

    if (exactError) {
      throw new Error(exactError.message);
    }

    if (exactMatches && exactMatches.length > 0) {
      return exactMatches[0].id;
    }

    const { data: newRestaurant, error: insertError } = await supabase

      .from("restaurants")

      .insert({
        name: trimmedName,

        city: trimmedCity,

        state: trimmedState,

        address: trimmedAddress || null,

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

    return newRestaurant.id;
  }

  async function findOrCreateDish(restaurantId: string) {
    // A dish picked from another location of the brand gets its own row here,
    // so the review stays tied to the location the user actually visited.
    if (selectedDishId && selectedDishRestaurantId === restaurantId) {
      return selectedDishId;
    }

    const trimmedDishName = dishName.trim();

    const { data: exactMatches, error: exactError } = await supabase

      .from("dishes")

      .select("id, name")

      .eq("restaurant_id", restaurantId)

      .ilike("name", trimmedDishName)

      .limit(1);

    if (exactError) {
      throw new Error(exactError.message);
    }

    if (exactMatches && exactMatches.length > 0) {
      return exactMatches[0].id;
    }

    const { data: newDish, error: insertError } = await supabase

      .from("dishes")

      .insert({
        restaurant_id: restaurantId,

        name: trimmedDishName,
      })

      .select("id")

      .single();

    if (insertError || !newDish) {
      throw new Error(insertError?.message || "Could not create dish.");
    }

    return newDish.id;
  }

  async function logDish() {
    if (!restaurantName.trim()) {
      Alert.alert("Missing restaurant", "Enter a restaurant name.");

      return;
    }

    if (!selectedRestaurantId && !city.trim()) {
      Alert.alert("Missing city", "Enter the city for this new restaurant.");

      return;
    }

    if (!selectedRestaurantId && !state.trim()) {
      Alert.alert("Missing state", "Enter the state for this new restaurant.");

      return;
    }

    if (!dishName.trim()) {
      Alert.alert("Missing dish", "Enter a dish name.");

      return;
    }

    if (rating < 0.5 || rating > 5) {
      Alert.alert("Missing rating", "Choose a rating before logging the dish.");

      return;
    }

    setLoading(true);

    const {
      data: { user },

      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);

      Alert.alert("Error", "You must be signed in to log a dish.");

      return;
    }

    let uploadedPhotoPath: string | null = null;

    try {
      const restaurantId = await findOrCreateRestaurant();

      const dishId = await findOrCreateDish(restaurantId);

      if (photoUri) {
        uploadedPhotoPath = await uploadPhoto(photoUri, user.id);
      }

      const { data: createdReview, error: reviewError } = await supabase
        .from("reviews")
        .insert({
          user_id: user.id,
          dish_id: dishId,
          rating,
          review_text: reviewText.trim() || null,
          photo_path: uploadedPhotoPath,
        })
        .select("id")
        .single();

      if (reviewError) {
        if (uploadedPhotoPath) {
          await supabase.storage

            .from("review-photos")

            .remove([uploadedPhotoPath]);
        }

        throw new Error(reviewError.message);
      }

      if (!createdReview) {
        throw new Error("Review was saved but its ID was not returned.");
      }

      // Review creation and tag creation are separate requests. If tagging fails,
      // keep the successfully created review and tell the user what happened.
      let tagsSaved = true;
      if (selectedFriends.length > 0) {
        const { error: tagsError } = await supabase.from("review_tags").insert(
          selectedFriends.map((friendId) => ({
            review_id: createdReview.id,
            tagged_user_id: friendId,
          })),
        );
        if (tagsError) {
          console.log("Review tags error:", tagsError.message);
          tagsSaved = false;
        }
      }

      let restaurantRatingSaved = true;
      if (restaurantRating > 0) {
        const { error: restaurantRatingError } = await supabase
          .from("restaurant_ratings")
          .upsert(
            {
              user_id: user.id,
              restaurant_id: restaurantId,
              rating: restaurantRating,
            },
            { onConflict: "user_id,restaurant_id" },
          );
        if (restaurantRatingError) {
          console.log(
            "Restaurant rating error:",
            restaurantRatingError.message,
          );
          restaurantRatingSaved = false;
        }
      }

      const failedExtras = [
        !tagsSaved && "the friend tags",
        !restaurantRatingSaved && "the restaurant rating",
      ].filter(Boolean);

      Alert.alert(
        failedExtras.length === 0 ? "Logged!" : "Logged, with a problem",
        failedExtras.length === 0
          ? `${dishName.trim()} was added to your diary.`
          : `${dishName.trim()} was added to your diary, but ${failedExtras.join(" and ")} could not be saved.`,
      );

      setRestaurantName("");

      setRestaurantResults([]);

      setGoogleResults([]);

      setSelectedRestaurantId(null);

      setGooglePlaceId(null);

      setWebsite(null);

      setAddress("");

      setCity("");

      setState("");

      setLatitude(null);

      setLongitude(null);

      setDishName("");

      setDishResults([]);

      setSelectedDishId(null);

      setRating(0);

      setRestaurantRating(0);

      setReviewText("");

      setPhotoUri(null);
      setSelectedFriends([]);
      setFriendSearch("");

      resetGoogleSession();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";

      Alert.alert("Log error", message);
    } finally {
      setLoading(false);
    }
  }

  const creatingNewRestaurant =
    restaurantName.trim().length >= 2 && !selectedRestaurantId;

  const creatingNewDish = dishName.trim().length >= 2 && !selectedDishId;

  const hasCoordinates = latitude !== null && longitude !== null;

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Log Food</Text>

        <Text style={styles.subtitle}>Rate a specific menu item you ate.</Text>

        <Text style={styles.label}>Restaurant</Text>

        <TextInput
          style={styles.input}
          placeholder="Search restaurant"
          placeholderTextColor={Palette.textMuted}
          value={restaurantName}
          onChangeText={searchRestaurants}
        />

        {restaurantResults.length > 0 ? (
          <View style={styles.resultsBox}>
            <Text style={styles.resultsLabel}>Already on Food App</Text>

            {restaurantResults.map((restaurant) => {
              const locationText =
                restaurant.address ||
                [restaurant.city, restaurant.state].filter(Boolean).join(", ");

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

            <Text style={styles.googleLoadingText}>
              Searching Google Places...
            </Text>
          </View>
        ) : null}

        {googleResults.length > 0 && !selectedRestaurantId ? (
          <View style={styles.resultsBox}>
            <Text style={styles.resultsLabel}>Google Places</Text>

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
                    <Text style={styles.resultSubtext}>{secondaryText}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {selectedRestaurantId ? (
          <View style={styles.selectedBox}>
            <Text style={styles.selectedTitle}>
              ✓ Existing restaurant selected
            </Text>

            <Text style={styles.selectedText}>{restaurantName}</Text>

            {address ? (
              <Text style={styles.selectedLocation}>{address}</Text>
            ) : city || state ? (
              <Text style={styles.selectedLocation}>
                {[city, state].filter(Boolean).join(", ")}
              </Text>
            ) : null}
          </View>
        ) : googlePlaceId ? (
          <View style={styles.googleSelectedBox}>
            <Text style={styles.selectedTitle}>
              ✓ Google restaurant selected
            </Text>

            <Text style={styles.selectedText}>{restaurantName}</Text>

            {address ? (
              <Text style={styles.selectedLocation}>{address}</Text>
            ) : null}

            <TouchableOpacity
              style={styles.changeRestaurantButton}
              onPress={() => {
                setRestaurantName("");

                setGooglePlaceId(null);

                setAddress("");

                setCity("");

                setState("");

                setLatitude(null);

                setLongitude(null);

                setRestaurantResults([]);

                setGoogleResults([]);

                setDishName("");

                setSelectedDishId(null);

                setDishResults([]);

                resetGoogleSession();
              }}
            >
              <Text style={styles.changeRestaurantText}>Change restaurant</Text>
            </TouchableOpacity>
          </View>
        ) : creatingNewRestaurant ? (
          <View style={styles.newItemBox}>
            <Text style={styles.newItemTitle}>New restaurant</Text>

            <Text style={styles.newItemText}>
              Select a Google result above when possible. If you don't, "
              {restaurantName.trim()}" will be created manually.
            </Text>
          </View>
        ) : null}

        {!googlePlaceId ? (
          <>
            <Text style={styles.label}>City</Text>

            <TextInput
              style={[
                styles.input,

                selectedRestaurantId && styles.inputDisabled,
              ]}
              placeholder="City"
              placeholderTextColor={Palette.textMuted}
              value={city}
              onChangeText={setCity}
              editable={!selectedRestaurantId}
            />

            <Text style={styles.label}>State</Text>

            <TextInput
              style={[
                styles.input,

                selectedRestaurantId && styles.inputDisabled,
              ]}
              placeholder="State, e.g. AZ"
              placeholderTextColor={Palette.textMuted}
              value={state}
              onChangeText={setState}
              autoCapitalize="characters"
              maxLength={30}
              editable={!selectedRestaurantId}
            />
          </>
        ) : null}

        {!selectedRestaurantId && creatingNewRestaurant ? (
          <View style={styles.locationSection}>
            <Text style={styles.locationLabel}>Restaurant Location</Text>

            {googlePlaceId && hasCoordinates ? (
              <View style={styles.locationSavedBox}>
                <View style={styles.locationSavedInfo}>
                  <Text style={styles.locationSavedTitle}>
                    ✓ Google location saved
                  </Text>

                  <Text style={styles.locationSavedText}>
                    This restaurant's coordinates came from Google Places.
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.locationHelper}>
                  Optional. Only use your current location if you are physically
                  at the restaurant.
                </Text>

                {hasCoordinates ? (
                  <View style={styles.locationSavedBox}>
                    <View style={styles.locationSavedInfo}>
                      <Text style={styles.locationSavedTitle}>
                        ✓ Location saved
                      </Text>

                      <Text style={styles.locationSavedText}>
                        Coordinates will be attached to this restaurant.
                      </Text>
                    </View>

                    <TouchableOpacity onPress={removeLocation}>
                      <Text style={styles.removeLocationText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.locationButton}
                    onPress={useCurrentLocation}
                    disabled={gettingLocation}
                  >
                    {gettingLocation ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Text style={styles.locationButtonText}>
                        Use Current Location
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        ) : null}

        <Text style={styles.label}>Dish</Text>

        <TextInput
          style={[
            styles.input,

            !selectedRestaurantId && styles.inputNeedsRestaurant,
          ]}
          placeholder={
            menuLocationIds.length > 0
              ? "Search or add a menu item"
              : "Enter dish name"
          }
          placeholderTextColor={Palette.textMuted}
          value={dishName}
          onChangeText={searchDishes}
        />

        {!selectedRestaurantId && restaurantName.trim().length >= 2 ? (
          <Text style={styles.helperText}>
            If this restaurant has not been saved yet, enter the dish name and
            we'll check for duplicates after the restaurant is created.
          </Text>
        ) : null}

        {dishResults.length > 0 && !selectedDishId ? (
          <View style={styles.resultsBox}>
            <Text style={styles.resultsLabel}>Existing dishes</Text>

            {dishResults.map((dish) => (
              <TouchableOpacity
                key={dish.id}
                style={styles.resultItem}
                onPress={() => selectDish(dish)}
              >
                <Text style={styles.resultName}>{dish.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {selectedDishId ? (
          <View style={styles.selectedBox}>
            <Text style={styles.selectedTitle}>✓ Existing dish selected</Text>

            <Text style={styles.selectedText}>{dishName}</Text>
          </View>
        ) : creatingNewDish ? (
          <View style={styles.newItemBox}>
            <Text style={styles.newItemTitle}>New dish</Text>

            <Text style={styles.newItemText}>
              We'll use an existing exact match if one already exists.
              Otherwise, "{dishName.trim()}" will be created.
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>Rating</Text>

        <StarRatingInput value={rating} onChange={setRating} />

        <Text style={styles.label}>Review</Text>

        <TextInput
          style={[styles.input, styles.reviewInput]}
          placeholder="What did you think?"
          placeholderTextColor={Palette.textMuted}
          multiline
          value={reviewText}
          onChangeText={setReviewText}
        />

        <View style={styles.optionalLabelRow}>
          <Text style={styles.label}>
            How was the restaurant? (Optional)
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
        />

        <Text style={styles.label}>Who'd you go with? (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Search your mutual followers..."
          placeholderTextColor={Palette.textMuted}
          value={friendSearch}
          onChangeText={setFriendSearch}
        />

        {friendsLoading ? (
          <ActivityIndicator size="small" style={styles.friendsLoading} />
        ) : friends.length === 0 ? (
          <Text style={styles.friendsHelper}>No mutual followers yet.</Text>
        ) : (
          <View style={styles.friendsList}>
            {friends
              .filter((friend) =>
                `${friend.username} ${friend.display_name ?? ""}`
                  .toLowerCase()
                  .includes(friendSearch.trim().toLowerCase()),
              )
              .map((friend) => {
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
          </View>
        )}

        {selectedFriends.length > 0 ? (
          <Text style={styles.friendsHelper}>
            {selectedFriends.length} friend(s) selected
          </Text>
        ) : null}

        <Text style={styles.label}>Photo</Text>

        {photoUri ? (
          <View style={styles.photoArea}>
            <Image
              source={{
                uri: photoUri,
              }}
              style={styles.photoPreview}
            />

            <View style={styles.photoActions}>
              <TouchableOpacity
                style={styles.changePhotoButton}
                onPress={pickPhoto}
              >
                <Text style={styles.changePhotoText}>Change Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.removePhotoButton}
                onPress={() => setPhotoUri(null)}
              >
                <Text style={styles.removePhotoText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.addPhotoButton} onPress={pickPhoto}>
            <Text style={styles.addPhotoIcon}>+</Text>

            <View>
              <Text style={styles.addPhotoTitle}>Add Photo</Text>

              <Text style={styles.addPhotoSubtitle}>Optional</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={logDish}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading
              ? photoUri
                ? "Uploading & Logging..."
                : "Logging..."
              : "Log Dish"}
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
  },

  subtitle: {
    fontSize: 16,

    color: Palette.textSecondary,

    marginTop: 8,

    marginBottom: 30,
  },

  label: {
    color: Palette.text,
    fontSize: 14,

    fontWeight: "600",

    marginBottom: 6,
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

  inputDisabled: {
    backgroundColor: Palette.surface,

    color: Palette.textSecondary,
  },

  inputNeedsRestaurant: {
    borderColor: Palette.borderStrong,
  },

  resultsBox: {
    borderWidth: 1,

    borderColor: Palette.border,

    borderRadius: 10,

    marginBottom: 14,

    overflow: "hidden",
  },

  resultsLabel: {
    fontSize: 12,

    fontWeight: "700",

    color: Palette.textMuted,

    paddingHorizontal: 12,

    paddingTop: 10,

    paddingBottom: 6,
  },

  resultItem: {
    paddingHorizontal: 12,

    paddingVertical: 11,

    borderTopWidth: 1,

    borderTopColor: Palette.border,
  },

  resultName: {
    color: Palette.text,
    fontSize: 16,

    fontWeight: "600",
  },

  resultSubtext: {
    fontSize: 13,

    color: Palette.textMuted,

    marginTop: 2,
  },

  googleLoadingRow: {
    flexDirection: "row",

    alignItems: "center",

    marginBottom: 14,

    paddingVertical: 4,
  },

  googleLoadingText: {
    fontSize: 12,

    color: Palette.textMuted,

    marginLeft: 8,
  },

  selectedBox: {
    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    padding: 12,

    marginBottom: 16,

    backgroundColor: Palette.surface,
  },

  googleSelectedBox: {
    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    padding: 12,

    marginBottom: 16,

    backgroundColor: Palette.surface,
  },

  selectedTitle: {
    fontSize: 12,

    fontWeight: "700",

    color: Palette.textSecondary,
  },

  selectedText: {
    color: Palette.text,
    fontSize: 14,

    fontWeight: "600",

    marginTop: 3,
  },

  selectedLocation: {
    fontSize: 12,

    color: Palette.textMuted,

    marginTop: 3,
  },

  newItemBox: {
    borderWidth: 1,

    borderColor: Palette.border,

    borderRadius: 10,

    padding: 12,

    marginBottom: 16,
  },

  newItemTitle: {
    fontSize: 12,

    fontWeight: "700",

    color: Palette.textMuted,
  },

  newItemText: {
    fontSize: 13,

    color: Palette.textSecondary,

    lineHeight: 18,

    marginTop: 3,
  },

  helperText: {
    fontSize: 12,

    lineHeight: 17,

    color: Palette.textMuted,

    marginTop: -4,

    marginBottom: 14,
  },

  locationSection: {
    marginBottom: 20,
  },

  locationLabel: {
    color: Palette.text,
    fontSize: 14,

    fontWeight: "600",
  },

  locationHelper: {
    fontSize: 12,

    color: Palette.textMuted,

    lineHeight: 17,

    marginTop: 4,

    marginBottom: 10,
  },

  locationButton: {
    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    minHeight: 46,

    justifyContent: "center",

    alignItems: "center",
  },

  locationButtonText: {
    color: Palette.text,
    fontSize: 14,

    fontWeight: "700",
  },

  locationSavedBox: {
    flexDirection: "row",

    alignItems: "center",

    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    padding: 12,

    backgroundColor: Palette.surface,
  },

  locationSavedInfo: {
    flex: 1,

    paddingRight: 12,
  },

  locationSavedTitle: {
    color: Palette.text,
    fontSize: 13,

    fontWeight: "700",
  },

  locationSavedText: {
    fontSize: 12,

    color: Palette.textMuted,

    marginTop: 2,
  },

  removeLocationText: {
    fontSize: 12,

    color: Palette.danger,

    fontWeight: "600",
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

  reviewInput: {
    minHeight: 110,

    textAlignVertical: "top",
  },

  addPhotoButton: {
    flexDirection: "row",

    alignItems: "center",

    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 12,

    padding: 16,

    marginBottom: 22,
  },

  addPhotoIcon: {
    color: Palette.text,
    fontSize: 28,

    marginRight: 14,

    fontWeight: "300",
  },

  addPhotoTitle: {
    color: Palette.text,
    fontSize: 15,

    fontWeight: "700",
  },

  addPhotoSubtitle: {
    fontSize: 12,

    color: Palette.textMuted,

    marginTop: 2,
  },

  photoArea: {
    marginBottom: 22,
  },

  photoPreview: {
    width: "100%",

    aspectRatio: 4 / 3,

    borderRadius: 14,

    backgroundColor: Palette.elevated,
  },

  photoActions: {
    flexDirection: "row",

    marginTop: 10,

    gap: 16,
  },

  changePhotoButton: {
    paddingVertical: 6,
  },

  changePhotoText: {
    color: Palette.text,
    fontSize: 13,

    fontWeight: "700",
  },

  removePhotoButton: {
    paddingVertical: 6,
  },

  removePhotoText: {
    fontSize: 13,

    fontWeight: "600",

    color: Palette.danger,
  },

  button: {
    backgroundColor: Palette.accent,

    padding: 16,

    borderRadius: 10,

    alignItems: "center",

    marginTop: 4,
  },

  buttonDisabled: {
    opacity: 0.5,
  },

  buttonText: {
    color: Palette.text,

    fontSize: 16,

    fontWeight: "600",
  },

  changeRestaurantButton: {
    marginTop: 10,

    alignSelf: "flex-start",
  },

  changeRestaurantText: {
    fontSize: 13,

    fontWeight: "600",

    color: Palette.textSecondary,

    textDecorationLine: "underline",
  },

  friendsLoading: {
    marginBottom: 12,
  },
  friendsList: {
    marginBottom: 12,
  },
  friendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 10,
    marginBottom: 8,
  },
  friendSelected: {
    backgroundColor: Palette.surface,
    borderColor: Palette.accent,
  },
  friendName: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: "600",
  },
  friendHandle: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 3,
  },
  friendCheck: {
    color: Palette.text,
    fontSize: 20,
    fontWeight: "700",
  },
  friendsHelper: {
    fontSize: 13,
    color: Palette.textMuted,
    marginBottom: 15,
  },
});
