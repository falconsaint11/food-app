import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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

import { getBrandLocationIds } from '@/lib/brands';
import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

// One choice for "Flavor or type": the dish itself (label null) or one of
// its flavors, across every location of the restaurant.
type FlavorChoice = {
  nameKey: string;
  name: string;
  label: string | null;
  // This location's row of it, if it has one.
  rowHere: string | null;
};

type ReviewDish = {
  id: string;
  name: string;
  name_key: string;
  variant_of: string | null;
  variant_label: string | null;
  restaurant_id: string;
  restaurants: {
    name: string;
    brand_id: string | null;
  } | null;
};

const ratingOptions = [
  0.5,
  1,
  1.5,
  2,
  2.5,
  3,
  3.5,
  4,
  4.5,
  5,
];

export default function EditReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [rating, setRating] = useState<number>(0);
  const [reviewText, setReviewText] = useState('');
  const [dateEaten, setDateEaten] = useState('');
  const [dishName, setDishName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');

  const [existingPhotoPath, setExistingPhotoPath] =
    useState<string | null>(null);

  const [newPhotoUri, setNewPhotoUri] =
    useState<string | null>(null);

  const [removeExistingPhoto, setRemoveExistingPhoto] =
    useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // The reviewed dish, its flavors, and the one picked here.
  const [reviewDish, setReviewDish] = useState<ReviewDish | null>(null);
  const [flavors, setFlavors] = useState<FlavorChoice[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A new flavor typed in with "+ New", created on save.
  const [newFlavor, setNewFlavor] = useState<string | null>(null);
  const [flavorDraft, setFlavorDraft] = useState<string | null>(null);

  useEffect(() => {
    loadReview();
  }, [id]);

  async function loadReview() {
    if (!id) {
      return;
    }

    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);

      Alert.alert(
        'Error',
        'You must be signed in.'
      );

      router.back();
      return;
    }

    const { data, error } = await supabase
      .from('reviews')
      .select(`
        id,
        user_id,
        rating,
        review_text,
        date_eaten,
        photo_path,
        dishes (
          id,
          name,
          name_key,
          variant_of,
          variant_label,
          restaurant_id,
          restaurants (
            name,
            brand_id
          )
        )
      `)
      .eq('id', id)
      .maybeSingle();

    setLoading(false);

    if (error) {
      Alert.alert(
        'Review error',
        error.message
      );
      return;
    }

    if (!data) {
      Alert.alert(
        'Error',
        'Review not found.'
      );

      router.back();
      return;
    }

    if (data.user_id !== user.id) {
      Alert.alert(
        'Not allowed',
        'You can only edit your own reviews.'
      );

      router.back();
      return;
    }

    setRating(Number(data.rating));
    setReviewText(data.review_text ?? '');
    setDateEaten(data.date_eaten ?? '');
    setExistingPhotoPath(data.photo_path ?? null);
    setNewPhotoUri(null);
    setRemoveExistingPhoto(false);

    const dish = data.dishes as unknown as ReviewDish | null;

    setDishName(
      dish?.name ??
        'Unknown dish'
    );

    setRestaurantName(
      dish?.restaurants?.name ??
        'Unknown restaurant'
    );

    setReviewDish(dish);
    setSelectedKey(dish?.name_key ?? null);
    setNewFlavor(null);
    setFlavorDraft(null);

    if (dish) {
      loadFlavors(dish).catch((flavorError) =>
        console.log('Flavors error:', flavorError)
      );
    }
  }

  // The dish and all its flavors at any location of the restaurant.
  async function loadFlavors(dish: ReviewDish) {
    const rootKey = dish.variant_of ?? dish.name_key;
    const locationIds = await getBrandLocationIds(
      dish.restaurant_id,
      dish.restaurants?.brand_id ?? null
    );

    const { data, error } = await supabase
      .from('dishes')
      .select('id, name, name_key, variant_label, restaurant_id, discontinued_at')
      .in('restaurant_id', locationIds)
      .or(`name_key.eq."${rootKey}",variant_of.eq."${rootKey}"`);

    if (error) throw new Error(error.message);

    const byKey = new Map<string, FlavorChoice>();

    for (const row of data ?? []) {
      // Discontinued flavors only stay if this review is of one.
      if (row.discontinued_at && row.id !== dish.id) continue;

      const choice = byKey.get(row.name_key) ?? {
        nameKey: row.name_key as string,
        name: row.name as string,
        label: row.name_key === rootKey ? null : (row.variant_label ?? row.name),
        rowHere: null,
      };

      if (row.restaurant_id === dish.restaurant_id) {
        choice.rowHere = row.id as string;
      }

      byKey.set(row.name_key, choice);
    }

    setFlavors(
      [...byKey.values()].sort((a, b) =>
        a.label === null ? -1 : b.label === null ? 1 : a.label.localeCompare(b.label)
      )
    );
  }

  function addFlavor() {
    const label = flavorDraft?.trim();
    if (!label) return;

    const existing = flavors.find(
      (flavor) => flavor.label?.toLowerCase() === label.toLowerCase()
    );

    if (existing) {
      setSelectedKey(existing.nameKey);
      setNewFlavor(null);
    } else {
      setNewFlavor(label);
      setSelectedKey(null);
    }

    setFlavorDraft(null);
  }

  // The dish the review should be of after saving: the same one, another
  // flavor (added at this location if it's only at another one), or a new
  // flavor.
  async function resolveFlavorDish(): Promise<string | null> {
    if (!reviewDish) return null;

    const rootKey = reviewDish.variant_of ?? reviewDish.name_key;
    const root = flavors.find((flavor) => flavor.label === null);
    const rootName =
      root?.name ??
      (reviewDish.variant_label
        ? reviewDish.name.replace(reviewDish.variant_label, '').trim()
        : reviewDish.name);

    if (newFlavor) {
      const { data, error } = await supabase
        .from('dishes')
        .insert({
          restaurant_id: reviewDish.restaurant_id,
          name: `${newFlavor} ${rootName}`,
          variant_of: rootKey,
          variant_label: newFlavor,
        })
        .select('id')
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? 'Could not add the flavor.');
      }

      return data.id as string;
    }

    const choice = flavors.find((flavor) => flavor.nameKey === selectedKey);

    if (!choice || choice.nameKey === reviewDish.name_key) {
      return reviewDish.id;
    }

    if (choice.rowHere) {
      return choice.rowHere;
    }

    const { data, error } = await supabase
      .from('dishes')
      .insert({
        restaurant_id: reviewDish.restaurant_id,
        name: choice.name,
        variant_of: choice.label ? rootKey : null,
        variant_label: choice.label,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? 'Could not switch the flavor.');
    }

    return data.id as string;
  }

  function getPhotoUrl(path: string) {
    const { data } = supabase.storage
      .from('review-photos')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  // Camera or library, whichever they want.
  function pickPhoto() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => choosePhoto('camera') },
      { text: 'Choose from library', onPress: () => choosePhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function choosePhoto(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        source === 'camera'
          ? 'Camera permission needed'
          : 'Photo permission needed',
        source === 'camera'
          ? 'Allow camera access to take a photo for your review.'
          : 'Allow photo access to add a photo to your review.'
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled) {
      return;
    }

    setNewPhotoUri(
      result.assets[0].uri
    );

    setRemoveExistingPhoto(false);
  }

  async function uploadPhoto(
    uri: string,
    userId: string
  ) {
    const uriParts =
      uri.split('.');

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

  function handleRemovePhoto() {
    setNewPhotoUri(null);

    if (existingPhotoPath) {
      setRemoveExistingPhoto(true);
    }
  }

  function isValidDate(date: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date);
  }

  async function saveReview() {
    if (!id || saving) {
      return;
    }

    if (
      rating < 0.5 ||
      rating > 5
    ) {
      Alert.alert(
        'Rating required',
        'Choose a rating.'
      );

      return;
    }

    if (!isValidDate(dateEaten)) {
      Alert.alert(
        'Invalid date',
        'Enter the date as YYYY-MM-DD.'
      );

      return;
    }

    setSaving(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSaving(false);

      Alert.alert(
        'Error',
        'You must be signed in.'
      );

      return;
    }

    let uploadedPhotoPath:
      | string
      | null = null;

    try {
      let finalPhotoPath =
        existingPhotoPath;

      if (newPhotoUri) {
        uploadedPhotoPath =
          await uploadPhoto(
            newPhotoUri,
            user.id
          );

        finalPhotoPath =
          uploadedPhotoPath;
      } else if (
        removeExistingPhoto
      ) {
        finalPhotoPath = null;
      }

      const trimmedReview =
        reviewText.trim();

      const flavorDishId =
        await resolveFlavorDish();

      const { error } =
        await supabase
          .from('reviews')
          .update({
            rating,
            review_text:
              trimmedReview.length > 0
                ? trimmedReview
                : null,
            date_eaten:
              dateEaten,
            photo_path:
              finalPhotoPath,
            ...(flavorDishId
              ? { dish_id: flavorDishId }
              : {}),
          })
          .eq('id', id)
          .eq(
            'user_id',
            user.id
          );

      if (error) {
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
          error.message
        );
      }

      const replacingPhoto =
        existingPhotoPath &&
        uploadedPhotoPath;

      const deletingPhoto =
        existingPhotoPath &&
        removeExistingPhoto &&
        !uploadedPhotoPath;

      if (
        replacingPhoto ||
        deletingPhoto
      ) {
        await supabase.storage
          .from('review-photos')
          .remove([
            existingPhotoPath,
          ]);
      }

      router.back();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Something went wrong.';

      Alert.alert(
        'Update error',
        message
      );
    } finally {
      setSaving(false);
    }
  }

  // The header follows the flavor picked below.
  const selectedFlavor = flavors.find(
    (flavor) => flavor.nameKey === selectedKey
  );
  const rootFlavorName =
    flavors.find((flavor) => flavor.label === null)?.name ?? dishName;
  const displayedDishName = newFlavor
    ? `${newFlavor} ${rootFlavorName}`
    : (selectedFlavor?.name ?? dishName);

  const displayedPhotoUri =
    newPhotoUri
      ? newPhotoUri
      : existingPhotoPath &&
        !removeExistingPhoto
      ? getPhotoUrl(
          existingPhotoPath
        )
      : null;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : undefined
      }
    >
      <ScrollView
        contentContainerStyle={
          styles.container
        }
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>
          Edit Review
        </Text>

        <Text style={styles.dishName}>
          {displayedDishName}
        </Text>

        <Text
          style={styles.restaurantName}
        >
          {restaurantName}
        </Text>

        <View style={styles.section}>
          <Text style={styles.label}>
            Rating
          </Text>

          <View
            style={
              styles.ratingGrid
            }
          >
            {ratingOptions.map(
              (option) => {
                // Scores from comparisons (4.37) highlight
                // their half-star (4.5).
                const selected =
                  Math.round(rating * 2) / 2 ===
                  option;

                return (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.ratingButton,
                      selected &&
                        styles.ratingButtonSelected,
                    ]}
                    onPress={() =>
                      setRating(option)
                    }
                  >
                    <Text
                      style={[
                        styles.ratingButtonText,
                        selected &&
                          styles.ratingButtonTextSelected,
                      ]}
                    >
                      {option}★
                    </Text>
                  </TouchableOpacity>
                );
              }
            )}
          </View>
        </View>

        {reviewDish ? (
          <View style={styles.section}>
            <Text style={styles.label}>Flavor or type</Text>

            <View style={styles.ratingGrid}>
              {flavors.map((flavor) => {
                const selected = !newFlavor && selectedKey === flavor.nameKey;

                return (
                  <TouchableOpacity
                    key={flavor.nameKey}
                    style={[
                      styles.ratingButton,
                      selected && styles.ratingButtonSelected,
                    ]}
                    onPress={() => {
                      setSelectedKey(flavor.nameKey);
                      setNewFlavor(null);
                    }}
                  >
                    <Text
                      style={[
                        styles.ratingButtonText,
                        selected && styles.ratingButtonTextSelected,
                      ]}
                    >
                      {flavor.label ?? 'Plain'}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {newFlavor ? (
                <View style={[styles.ratingButton, styles.ratingButtonSelected]}>
                  <Text
                    style={[
                      styles.ratingButtonText,
                      styles.ratingButtonTextSelected,
                    ]}
                  >
                    {newFlavor}
                  </Text>
                </View>
              ) : null}

              {flavorDraft === null ? (
                <TouchableOpacity
                  style={styles.ratingButton}
                  onPress={() => setFlavorDraft('')}
                >
                  <Text style={styles.ratingButtonText}>+ New</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {flavorDraft !== null ? (
              <View style={styles.flavorInputRow}>
                <TextInput
                  style={styles.flavorInput}
                  value={flavorDraft}
                  onChangeText={setFlavorDraft}
                  onSubmitEditing={addFlavor}
                  placeholder="Like Pistachio or Steak"
                  placeholderTextColor={Palette.textMuted}
                  maxLength={40}
                  autoFocus
                />
                <TouchableOpacity onPress={addFlavor}>
                  <Text style={styles.flavorAddText}>Add</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.label}>
            Review
          </Text>

          <TextInput
            style={
              styles.reviewInput
            }
            value={reviewText}
            onChangeText={
              setReviewText
            }
            placeholder="What did you think?"
            placeholderTextColor={Palette.textMuted}
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>
            Photo
          </Text>

          {displayedPhotoUri ? (
            <View
              style={
                styles.photoArea
              }
            >
              <Image
                source={{
                  uri: displayedPhotoUri,
                }}
                style={
                  styles.photoPreview
                }
                resizeMode="cover"
              />

              <View
                style={
                  styles.photoActions
                }
              >
                <TouchableOpacity
                  style={
                    styles.photoActionButton
                  }
                  onPress={pickPhoto}
                  disabled={saving}
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
                    styles.photoActionButton
                  }
                  onPress={
                    handleRemovePhoto
                  }
                  disabled={saving}
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
              disabled={saving}
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
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>
            Date eaten
          </Text>

          <View style={styles.datePicker}>
            <DateTimePicker
              value={
                isValidDate(dateEaten)
                  ? new Date(`${dateEaten}T12:00:00`)
                  : new Date()
              }
              mode="date"
              display="compact"
              maximumDate={new Date()}
              themeVariant="dark"
              accentColor={Palette.accent}
              onValueChange={(_event, date) => {
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                setDateEaten(`${date.getFullYear()}-${month}-${day}`);
              }}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.saveButton,
            saving &&
              styles.saveButtonDisabled,
          ]}
          onPress={saveReview}
          disabled={saving}
        >
          <Text
            style={
              styles.saveButtonText
            }
          >
            {saving
              ? newPhotoUri
                ? 'Uploading & Saving...'
                : 'Saving...'
              : 'Save Changes'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() =>
            router.back()
          }
          disabled={saving}
        >
          <Text
            style={
              styles.cancelButtonText
            }
          >
            Cancel
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  datePicker: {
    alignItems: 'flex-start',
    marginTop: 4,
  },
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 50,
    backgroundColor: Palette.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Palette.background,
  },
  title: {
    color: Palette.text,
    fontSize: 30,
    fontWeight: '700',
  },
  dishName: {
    color: Palette.text,
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  restaurantName: {
    fontSize: 14,
    color: Palette.textSecondary,
    marginTop: 4,
  },
  section: {
    marginTop: 28,
  },
  label: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  ratingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ratingButton: {
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Palette.background,
  },
  ratingButtonSelected: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  ratingButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.text,
  },
  ratingButtonTextSelected: {
    color: Palette.text,
  },
  flavorInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  flavorInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Palette.text,
  },
  flavorAddText: {
    color: Palette.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  reviewInput: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    lineHeight: 22,
    color: Palette.text,
    backgroundColor: Palette.background,
  },
  photoArea: {
    marginTop: 2,
  },
  photoPreview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 14,
    backgroundColor: Palette.elevated,
  },
  photoActions: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 18,
  },
  photoActionButton: {
    paddingVertical: 6,
  },
  changePhotoText: {
    color: Palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  removePhotoText: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.danger,
  },
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 12,
    padding: 16,
  },
  addPhotoIcon: {
    color: Palette.text,
    fontSize: 28,
    marginRight: 14,
    fontWeight: '300',
  },
  addPhotoTitle: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  addPhotoSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  saveButton: {
    backgroundColor: Palette.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 32,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
});