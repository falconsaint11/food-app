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

import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

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
          name,
          restaurants (
            name
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

    const dish = data.dishes as unknown as {
      name: string;
      restaurants: {
        name: string;
      } | null;
    } | null;

    setDishName(
      dish?.name ??
        'Unknown dish'
    );

    setRestaurantName(
      dish?.restaurants?.name ??
        'Unknown restaurant'
    );
  }

  function getPhotoUrl(path: string) {
    const { data } = supabase.storage
      .from('review-photos')
      .getPublicUrl(path);

    return data.publicUrl;
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
          {dishName}
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

          <TextInput
            style={styles.dateInput}
            value={dateEaten}
            onChangeText={
              setDateEaten
            }
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Palette.textMuted}
            autoCapitalize="none"
            maxLength={10}
          />

          <Text
            style={styles.dateHelp}
          >
            Use YYYY-MM-DD
          </Text>
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
  dateInput: {
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: Palette.text,
    backgroundColor: Palette.background,
  },
  dateHelp: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 6,
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