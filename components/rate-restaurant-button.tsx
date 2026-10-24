import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import { StarRatingInput } from '@/components/star-rating-input';
import { Palette } from '@/constants/theme';
import {
  BrandLocation,
  describeLocation,
  getBrandLocationsNearestFirst,
} from '@/lib/brands';
import { supabase } from '@/lib/supabase';

type RateRestaurantButtonProps = {
  restaurantId: string;
  brandId: string | null;
  restaurantName: string;
  onSaved: () => void;
  style?: StyleProp<ViewStyle>;
};

// Restaurant ratings are stored per location, so the sheet defaults to the
// nearest saved location and lets the user switch for a past visit.
export function RateRestaurantButton({
  restaurantId,
  brandId,
  restaurantName,
  onSaved,
  style,
}: RateRestaurantButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locations, setLocations] = useState<BrandLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    null
  );
  const [existingRatings, setExistingRatings] = useState<Map<string, number>>(
    new Map()
  );
  const [rating, setRating] = useState(0);

  async function openSheet() {
    setOpen(true);
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be signed in to rate.');

      const brandLocations = await getBrandLocationsNearestFirst(
        restaurantId,
        brandId
      );

      const { data, error } = await supabase
        .from('restaurant_ratings')
        .select('restaurant_id, rating')
        .eq('user_id', user.id)
        .in(
          'restaurant_id',
          brandLocations.map((location) => location.id)
        );

      if (error) throw new Error(error.message);

      const ratings = new Map(
        (data ?? []).map((row) => [
          row.restaurant_id as string,
          Number(row.rating),
        ])
      );

      const firstId = brandLocations[0]?.id ?? null;

      setLocations(brandLocations);
      setExistingRatings(ratings);
      setSelectedLocationId(firstId);
      setRating(firstId ? ratings.get(firstId) ?? 0 : 0);
    } catch (error) {
      setOpen(false);
      Alert.alert(
        'Rating error',
        error instanceof Error ? error.message : 'Could not load ratings.'
      );
    } finally {
      setLoading(false);
    }
  }

  function selectLocation(locationId: string) {
    setSelectedLocationId(locationId);
    setRating(existingRatings.get(locationId) ?? 0);
  }

  async function saveRating() {
    if (!selectedLocationId || rating < 0.5) {
      return;
    }

    setSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be signed in to rate.');

      const { error } = await supabase.from('restaurant_ratings').upsert(
        {
          user_id: user.id,
          restaurant_id: selectedLocationId,
          rating,
        },
        { onConflict: 'user_id,restaurant_id' }
      );

      if (error) throw new Error(error.message);

      setOpen(false);
      onSaved();
    } catch (error) {
      Alert.alert(
        'Rating error',
        error instanceof Error ? error.message : 'Could not save your rating.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <TouchableOpacity style={[styles.button, style]} onPress={openSheet}>
        <Text style={styles.buttonText} numberOfLines={1}>
          ★ Rate
        </Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />

        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Rate {restaurantName}</Text>

          {loading ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <>
              {locations.length > 1 ? (
                <>
                  <Text style={styles.label}>Which location?</Text>

                  <ScrollView style={styles.locationList}>
                    {locations.map((location) => {
                      const selected = location.id === selectedLocationId;
                      const existing = existingRatings.get(location.id);

                      return (
                        <TouchableOpacity
                          key={location.id}
                          style={[
                            styles.locationOption,
                            selected && styles.locationOptionSelected,
                          ]}
                          onPress={() => selectLocation(location.id)}
                        >
                          <Text
                            style={styles.locationText}
                            numberOfLines={1}
                          >
                            {describeLocation(location)}
                          </Text>

                          {existing ? (
                            <Text style={styles.locationRating}>
                              {existing.toFixed(1)} ★
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              ) : null}

              <StarRatingInput value={rating} onChange={setRating} />

              <TouchableOpacity
                style={[
                  styles.saveButton,
                  (rating < 0.5 || saving) && styles.saveButtonDisabled,
                ]}
                disabled={rating < 0.5 || saving}
                onPress={saveRating}
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : 'Save rating'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
  },
  buttonText: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  sheet: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  sheetTitle: {
    color: Palette.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  loading: {
    marginVertical: 24,
  },
  label: {
    color: Palette.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  locationList: {
    flexGrow: 0,
    maxHeight: 180,
    marginBottom: 18,
  },
  locationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    marginBottom: 8,
  },
  locationOptionSelected: {
    borderColor: Palette.accent,
  },
  locationText: {
    flex: 1,
    color: Palette.text,
    fontSize: 14,
    paddingRight: 10,
  },
  locationRating: {
    color: Palette.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  saveButton: {
    backgroundColor: Palette.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
