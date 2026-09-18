import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useState } from 'react';
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
} from 'react-native';

import { supabase } from '@/lib/supabase';

type RestaurantResult = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
};

type DishResult = {
  id: string;
  name: string;
};

export default function LogScreen() {
  const [restaurantName, setRestaurantName] = useState('');

  const [restaurantResults, setRestaurantResults] = useState<
    RestaurantResult[]
  >([]);

  const [selectedRestaurantId, setSelectedRestaurantId] =
    useState<string | null>(null);

  const [city, setCity] = useState('');
  const [state, setState] = useState('');

  const [latitude, setLatitude] =
    useState<number | null>(null);

  const [longitude, setLongitude] =
    useState<number | null>(null);

  const [gettingLocation, setGettingLocation] =
    useState(false);

  const [dishName, setDishName] = useState('');

  const [dishResults, setDishResults] =
    useState<DishResult[]>([]);

  const [selectedDishId, setSelectedDishId] =
    useState<string | null>(null);

  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState('');

  const [photoUri, setPhotoUri] =
    useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  async function searchRestaurants(text: string) {
    setRestaurantName(text);
    setSelectedRestaurantId(null);

    setCity('');
    setState('');
    setLatitude(null);
    setLongitude(null);

    setDishName('');
    setSelectedDishId(null);
    setDishResults([]);

    const trimmed = text.trim();

    if (trimmed.length < 2) {
      setRestaurantResults([]);
      return;
    }

    const { data, error } = await supabase
      .from('restaurants')
      .select(`
        id,
        name,
        city,
        state,
        latitude,
        longitude
      `)
      .ilike('name', `%${trimmed}%`)
      .limit(8);

    if (error) {
      console.log(
        'Restaurant search error:',
        error.message
      );
      return;
    }

    setRestaurantResults(
      (data ?? []) as RestaurantResult[]
    );
  }

  function selectRestaurant(
    restaurant: RestaurantResult
  ) {
    setRestaurantName(restaurant.name);
    setCity(restaurant.city ?? '');
    setState(restaurant.state ?? '');

    setLatitude(
      restaurant.latitude !== null
        ? Number(restaurant.latitude)
        : null
    );

    setLongitude(
      restaurant.longitude !== null
        ? Number(restaurant.longitude)
        : null
    );

    setSelectedRestaurantId(restaurant.id);
    setRestaurantResults([]);

    setDishName('');
    setSelectedDishId(null);
    setDishResults([]);
  }

  async function useCurrentLocation() {
    if (selectedRestaurantId) {
      Alert.alert(
        'Existing restaurant',
        'Location is already tied to this restaurant record. We will add editing for existing restaurant locations later.'
      );
      return;
    }

    Alert.alert(
      'Use current location?',
      'Only use this if you are currently at the restaurant.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Use Location',
          onPress: getCurrentLocation,
        },
      ]
    );
  }

  async function getCurrentLocation() {
    setGettingLocation(true);

    try {
      const permission =
        await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Location permission needed',
          'Allow location access if you want to save this restaurant’s location.'
        );
        return;
      }

      const location =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

      setLatitude(location.coords.latitude);
      setLongitude(location.coords.longitude);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not get your location.';

      Alert.alert(
        'Location error',
        message
      );
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

    if (!selectedRestaurantId) {
      setDishResults([]);
      return;
    }

    const { data, error } = await supabase
      .from('dishes')
      .select('id, name')
      .eq(
        'restaurant_id',
        selectedRestaurantId
      )
      .ilike(
        'name',
        `%${trimmed}%`
      )
      .limit(8);

    if (error) {
      console.log(
        'Dish search error:',
        error.message
      );
      return;
    }

    setDishResults(data ?? []);
  }

  function selectDish(dish: DishResult) {
    setDishName(dish.name);
    setSelectedDishId(dish.id);
    setDishResults([]);
  }

  async function pickPhoto() {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Photo permission needed',
        'Allow photo access to add a photo to your review.'
      );
      return;
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

    if (result.canceled) {
      return;
    }

    setPhotoUri(
      result.assets[0].uri
    );
  }

  async function uploadPhoto(
    uri: string,
    userId: string
  ) {
    const uriParts = uri.split('.');

    const rawExtension =
      uriParts[
        uriParts.length - 1
      ]?.toLowerCase();

    const extension =
      rawExtension === 'png'
        ? 'png'
        : rawExtension === 'webp'
        ? 'webp'
        : 'jpg';

    const contentType =
      extension === 'png'
        ? 'image/png'
        : extension === 'webp'
        ? 'image/webp'
        : 'image/jpeg';

    const filePath =
      `${userId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${extension}`;

    const response =
      await fetch(uri);

    const arrayBuffer =
      await response.arrayBuffer();

    const { error } =
      await supabase.storage
        .from('review-photos')
        .upload(
          filePath,
          arrayBuffer,
          {
            contentType,
            upsert: false,
          }
        );

    if (error) {
      throw new Error(
        error.message
      );
    }

    return filePath;
  }

  async function findOrCreateRestaurant() {
    if (selectedRestaurantId) {
      return selectedRestaurantId;
    }

    const trimmedName =
      restaurantName.trim();

    const trimmedCity =
      city.trim();

    const trimmedState =
      state.trim();

    let exactQuery = supabase
      .from('restaurants')
      .select(
        'id, name, city, state'
      )
      .ilike(
        'name',
        trimmedName
      );

    exactQuery =
      exactQuery.ilike(
        'city',
        trimmedCity
      );

    exactQuery =
      exactQuery.ilike(
        'state',
        trimmedState
      );

    const {
      data: exactMatches,
      error: exactError,
    } = await exactQuery.limit(1);

    if (exactError) {
      throw new Error(
        exactError.message
      );
    }

    if (
      exactMatches &&
      exactMatches.length > 0
    ) {
      return exactMatches[0].id;
    }

    const {
      data: newRestaurant,
      error: insertError,
    } = await supabase
      .from('restaurants')
      .insert({
        name: trimmedName,
        city: trimmedCity,
        state: trimmedState,
        latitude,
        longitude,
      })
      .select('id')
      .single();

    if (
      insertError ||
      !newRestaurant
    ) {
      throw new Error(
        insertError?.message ||
          'Could not create restaurant.'
      );
    }

    return newRestaurant.id;
  }

  async function findOrCreateDish(
    restaurantId: string
  ) {
    if (selectedDishId) {
      return selectedDishId;
    }

    const trimmedDishName =
      dishName.trim();

    const {
      data: exactMatches,
      error: exactError,
    } = await supabase
      .from('dishes')
      .select('id, name')
      .eq(
        'restaurant_id',
        restaurantId
      )
      .ilike(
        'name',
        trimmedDishName
      )
      .limit(1);

    if (exactError) {
      throw new Error(
        exactError.message
      );
    }

    if (
      exactMatches &&
      exactMatches.length > 0
    ) {
      return exactMatches[0].id;
    }

    const {
      data: newDish,
      error: insertError,
    } = await supabase
      .from('dishes')
      .insert({
        restaurant_id:
          restaurantId,
        name: trimmedDishName,
      })
      .select('id')
      .single();

    if (
      insertError ||
      !newDish
    ) {
      throw new Error(
        insertError?.message ||
          'Could not create dish.'
      );
    }

    return newDish.id;
  }

  async function logDish() {
    if (!restaurantName.trim()) {
      Alert.alert(
        'Missing restaurant',
        'Enter a restaurant name.'
      );
      return;
    }

    if (
      !selectedRestaurantId &&
      !city.trim()
    ) {
      Alert.alert(
        'Missing city',
        'Enter the city for this new restaurant.'
      );
      return;
    }

    if (
      !selectedRestaurantId &&
      !state.trim()
    ) {
      Alert.alert(
        'Missing state',
        'Enter the state for this new restaurant.'
      );
      return;
    }

    if (!dishName.trim()) {
      Alert.alert(
        'Missing dish',
        'Enter a dish name.'
      );
      return;
    }

    if (
      rating < 0.5 ||
      rating > 5
    ) {
      Alert.alert(
        'Missing rating',
        'Choose a rating before logging the dish.'
      );
      return;
    }

    setLoading(true);

    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !user
    ) {
      setLoading(false);

      Alert.alert(
        'Error',
        'You must be signed in to log a dish.'
      );

      return;
    }

    let uploadedPhotoPath:
      | string
      | null = null;

    try {
      const restaurantId =
        await findOrCreateRestaurant();

      const dishId =
        await findOrCreateDish(
          restaurantId
        );

      if (photoUri) {
        uploadedPhotoPath =
          await uploadPhoto(
            photoUri,
            user.id
          );
      }

      const { error: reviewError } =
        await supabase
          .from('reviews')
          .insert({
            user_id: user.id,
            dish_id: dishId,
            rating,
            review_text:
              reviewText.trim() ||
              null,
            photo_path:
              uploadedPhotoPath,
          });

      if (reviewError) {
        if (
          uploadedPhotoPath
        ) {
          await supabase.storage
            .from('review-photos')
            .remove([
              uploadedPhotoPath,
            ]);
        }

        throw new Error(
          reviewError.message
        );
      }

      Alert.alert(
        'Logged!',
        `${dishName.trim()} was added to your diary.`
      );

      setRestaurantName('');
      setRestaurantResults([]);
      setSelectedRestaurantId(null);

      setCity('');
      setState('');

      setLatitude(null);
      setLongitude(null);

      setDishName('');
      setDishResults([]);
      setSelectedDishId(null);

      setRating(0);
      setReviewText('');
      setPhotoUri(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Something went wrong.';

      Alert.alert(
        'Log error',
        message
      );
    } finally {
      setLoading(false);
    }
  }

  const creatingNewRestaurant =
    restaurantName.trim()
      .length >= 2 &&
    !selectedRestaurantId;

  const creatingNewDish =
    dishName.trim().length >=
      2 &&
    !selectedDishId;

  const hasCoordinates =
    latitude !== null &&
    longitude !== null;

  return (
    <KeyboardAvoidingView
      style={
        styles.keyboardView
      }
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : 'height'
      }
    >
      <ScrollView
        contentContainerStyle={
          styles.container
        }
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>
          Log Food
        </Text>

        <Text style={styles.subtitle}>
          Rate a specific menu item
          you ate.
        </Text>

        <Text style={styles.label}>
          Restaurant
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Search restaurant"
          placeholderTextColor="#888888"
          value={restaurantName}
          onChangeText={
            searchRestaurants
          }
        />

        {restaurantResults.length >
          0 &&
        !selectedRestaurantId ? (
          <View
            style={
              styles.resultsBox
            }
          >
            <Text
              style={
                styles.resultsLabel
              }
            >
              Existing restaurants
            </Text>

            {restaurantResults.map(
              (restaurant) => {
                const locationText =
                  [
                    restaurant.city,
                    restaurant.state,
                  ]
                    .filter(Boolean)
                    .join(', ');

                return (
                  <TouchableOpacity
                    key={
                      restaurant.id
                    }
                    style={
                      styles.resultItem
                    }
                    onPress={() =>
                      selectRestaurant(
                        restaurant
                      )
                    }
                  >
                    <Text
                      style={
                        styles.resultName
                      }
                    >
                      {
                        restaurant.name
                      }
                    </Text>

                    {locationText ? (
                      <Text
                        style={
                          styles.resultSubtext
                        }
                      >
                        {
                          locationText
                        }
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              }
            )}
          </View>
        ) : null}

        {selectedRestaurantId ? (
          <View
            style={
              styles.selectedBox
            }
          >
            <Text
              style={
                styles.selectedTitle
              }
            >
              ✓ Existing restaurant
              selected
            </Text>

            <Text
              style={
                styles.selectedText
              }
            >
              {restaurantName}
            </Text>

            {(city || state) ? (
              <Text
                style={
                  styles.selectedLocation
                }
              >
                {[city, state]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            ) : null}
          </View>
        ) : creatingNewRestaurant ? (
          <View
            style={
              styles.newItemBox
            }
          >
            <Text
              style={
                styles.newItemTitle
              }
            >
              New restaurant
            </Text>

            <Text
              style={
                styles.newItemText
              }
            >
              If you don&apos;t
              select a result above,
              &quot;
              {restaurantName.trim()}
              &quot; will be created.
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>
          City
        </Text>

        <TextInput
          style={[
            styles.input,
            selectedRestaurantId &&
              styles.inputDisabled,
          ]}
          placeholder="City"
          placeholderTextColor="#888888"
          value={city}
          onChangeText={setCity}
          editable={
            !selectedRestaurantId
          }
        />

        <Text style={styles.label}>
          State
        </Text>

        <TextInput
          style={[
            styles.input,
            selectedRestaurantId &&
              styles.inputDisabled,
          ]}
          placeholder="State, e.g. AZ"
          placeholderTextColor="#888888"
          value={state}
          onChangeText={setState}
          autoCapitalize="characters"
          maxLength={30}
          editable={
            !selectedRestaurantId
          }
        />

        {!selectedRestaurantId &&
        creatingNewRestaurant ? (
          <View
            style={
              styles.locationSection
            }
          >
            <Text
              style={
                styles.locationLabel
              }
            >
              Restaurant Location
            </Text>

            <Text
              style={
                styles.locationHelper
              }
            >
              Optional. Only use your
              current location if you
              are physically at the
              restaurant.
            </Text>

            {hasCoordinates ? (
              <View
                style={
                  styles.locationSavedBox
                }
              >
                <View
                  style={
                    styles.locationSavedInfo
                  }
                >
                  <Text
                    style={
                      styles.locationSavedTitle
                    }
                  >
                    ✓ Location saved
                  </Text>

                  <Text
                    style={
                      styles.locationSavedText
                    }
                  >
                    Coordinates will be
                    attached to this
                    restaurant.
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={
                    removeLocation
                  }
                >
                  <Text
                    style={
                      styles.removeLocationText
                    }
                  >
                    Remove
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={
                  styles.locationButton
                }
                onPress={
                  useCurrentLocation
                }
                disabled={
                  gettingLocation
                }
              >
                {gettingLocation ? (
                  <ActivityIndicator
                    size="small"
                  />
                ) : (
                  <Text
                    style={
                      styles.locationButtonText
                    }
                  >
                    Use Current Location
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <Text style={styles.label}>
          Dish
        </Text>

        <TextInput
          style={[
            styles.input,
            !selectedRestaurantId &&
              styles.inputNeedsRestaurant,
          ]}
          placeholder={
            selectedRestaurantId
              ? 'Search or add a menu item'
              : 'Enter restaurant first'
          }
          placeholderTextColor="#888888"
          value={dishName}
          onChangeText={
            searchDishes
          }
        />

        {!selectedRestaurantId &&
        restaurantName.trim()
          .length >= 2 ? (
          <Text
            style={
              styles.helperText
            }
          >
            Select an existing
            restaurant above to search
            its existing dishes. If
            this is a new restaurant,
            enter the dish and
            we&apos;ll check for
            duplicates again when you
            log it.
          </Text>
        ) : null}

        {dishResults.length > 0 &&
        !selectedDishId ? (
          <View
            style={
              styles.resultsBox
            }
          >
            <Text
              style={
                styles.resultsLabel
              }
            >
              Existing dishes
            </Text>

            {dishResults.map(
              (dish) => (
                <TouchableOpacity
                  key={dish.id}
                  style={
                    styles.resultItem
                  }
                  onPress={() =>
                    selectDish(dish)
                  }
                >
                  <Text
                    style={
                      styles.resultName
                    }
                  >
                    {dish.name}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        ) : null}

        {selectedDishId ? (
          <View
            style={
              styles.selectedBox
            }
          >
            <Text
              style={
                styles.selectedTitle
              }
            >
              ✓ Existing dish selected
            </Text>

            <Text
              style={
                styles.selectedText
              }
            >
              {dishName}
            </Text>
          </View>
        ) : creatingNewDish ? (
          <View
            style={
              styles.newItemBox
            }
          >
            <Text
              style={
                styles.newItemTitle
              }
            >
              New dish
            </Text>

            <Text
              style={
                styles.newItemText
              }
            >
              We&apos;ll use an
              existing exact match if
              one already exists.
              Otherwise, &quot;
              {dishName.trim()}
              &quot; will be created.
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>
          Rating
        </Text>

        <View
          style={
            styles.ratingRow
          }
        >
          {[1, 2, 3, 4, 5].map(
            (star) => (
              <TouchableOpacity
                key={star}
                style={
                  styles.starButton
                }
                onPress={() =>
                  setRating(star)
                }
              >
                <Text
                  style={styles.star}
                >
                  {rating >= star
                    ? '★'
                    : '☆'}
                </Text>
              </TouchableOpacity>
            )
          )}
        </View>

        <View
          style={
            styles.halfRatingRow
          }
        >
          {[
            0.5,
            1.5,
            2.5,
            3.5,
            4.5,
          ].map((half) => (
            <TouchableOpacity
              key={half}
              style={[
                styles.halfButton,
                rating === half &&
                  styles.halfButtonSelected,
              ]}
              onPress={() =>
                setRating(half)
              }
            >
              <Text
                style={
                  styles.halfButtonText
                }
              >
                {half}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text
          style={
            styles.ratingHint
          }
        >
          {rating > 0
            ? `${rating} out of 5`
            : 'Choose a rating'}
        </Text>

        <Text style={styles.label}>
          Review
        </Text>

        <TextInput
          style={[
            styles.input,
            styles.reviewInput,
          ]}
          placeholder="What did you think?"
          placeholderTextColor="#888888"
          multiline
          value={reviewText}
          onChangeText={
            setReviewText
          }
        />

        <Text style={styles.label}>
          Photo
        </Text>

        {photoUri ? (
          <View
            style={
              styles.photoArea
            }
          >
            <Image
              source={{
                uri: photoUri,
              }}
              style={
                styles.photoPreview
              }
            />

            <View
              style={
                styles.photoActions
              }
            >
              <TouchableOpacity
                style={
                  styles.changePhotoButton
                }
                onPress={pickPhoto}
              >
                <Text
                  style={
                    styles.changePhotoText
                  }
                >
                  Change Photo
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={
                  styles.removePhotoButton
                }
                onPress={() =>
                  setPhotoUri(null)
                }
              >
                <Text
                  style={
                    styles.removePhotoText
                  }
                >
                  Remove
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={
              styles.addPhotoButton
            }
            onPress={pickPhoto}
          >
            <Text
              style={
                styles.addPhotoIcon
              }
            >
              +
            </Text>

            <View>
              <Text
                style={
                  styles.addPhotoTitle
                }
              >
                Add Photo
              </Text>

              <Text
                style={
                  styles.addPhotoSubtitle
                }
              >
                Optional
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.button,
            loading &&
              styles.buttonDisabled,
          ]}
          onPress={logDish}
          disabled={loading}
        >
          <Text
            style={
              styles.buttonText
            }
          >
            {loading
              ? photoUri
                ? 'Uploading & Logging...'
                : 'Logging...'
              : 'Log Dish'}
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
    marginBottom: 30,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#111111',
    marginBottom: 12,
    backgroundColor: '#ffffff',
  },
  inputDisabled: {
    backgroundColor: '#f5f5f5',
    color: '#666666',
  },
  inputNeedsRestaurant: {
    borderColor: '#dddddd',
  },
  resultsBox: {
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 10,
    marginBottom: 14,
    overflow: 'hidden',
  },
  resultsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#777777',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  resultItem: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#eeeeee',
  },
  resultName: {
    fontSize: 16,
    fontWeight: '600',
  },
  resultSubtext: {
    fontSize: 13,
    color: '#777777',
    marginTop: 2,
  },
  selectedBox: {
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    backgroundColor: '#f7f7f7',
  },
  selectedTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#555555',
  },
  selectedText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 3,
  },
  selectedLocation: {
    fontSize: 12,
    color: '#777777',
    marginTop: 3,
  },
  newItemBox: {
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  newItemTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#777777',
  },
  newItemText: {
    fontSize: 13,
    color: '#666666',
    lineHeight: 18,
    marginTop: 3,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#777777',
    marginTop: -4,
    marginBottom: 14,
  },
  locationSection: {
    marginBottom: 20,
  },
  locationLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  locationHelper: {
    fontSize: 12,
    color: '#777777',
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 10,
  },
  locationButton: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  locationSavedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#f7f7f7',
  },
  locationSavedInfo: {
    flex: 1,
    paddingRight: 12,
  },
  locationSavedTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  locationSavedText: {
    fontSize: 12,
    color: '#777777',
    marginTop: 2,
  },
  removeLocationText: {
    fontSize: 12,
    color: '#b42318',
    fontWeight: '600',
  },
  ratingRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  starButton: {
    marginRight: 8,
  },
  star: {
    fontSize: 38,
  },
  halfRatingRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  halfButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 8,
    marginRight: 8,
  },
  halfButtonSelected: {
    borderColor: '#111111',
    backgroundColor: '#eeeeee',
  },
  halfButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  ratingHint: {
    fontSize: 13,
    color: '#777777',
    marginBottom: 18,
  },
  reviewInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 12,
    padding: 16,
    marginBottom: 22,
  },
  addPhotoIcon: {
    fontSize: 28,
    marginRight: 14,
    fontWeight: '300',
  },
  addPhotoTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  addPhotoSubtitle: {
    fontSize: 12,
    color: '#888888',
    marginTop: 2,
  },
  photoArea: {
    marginBottom: 22,
  },
  photoPreview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 14,
    backgroundColor: '#eeeeee',
  },
  photoActions: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 16,
  },
  changePhotoButton: {
    paddingVertical: 6,
  },
  changePhotoText: {
    fontSize: 13,
    fontWeight: '700',
  },
  removePhotoButton: {
    paddingVertical: 6,
  },
  removePhotoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#b42318',
  },
  button: {
    backgroundColor: '#111111',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});