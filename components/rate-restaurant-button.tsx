import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import { StarRatingInput } from '@/components/star-rating-input';
import { Palette } from '@/constants/theme';
import { getBrandLocationIds } from '@/lib/brands';
import { supabase } from '@/lib/supabase';

type RateRestaurantButtonProps = {
  restaurantId: string;
  brandId: string | null;
  restaurantName: string;
  onSaved: () => void;
  style?: StyleProp<ViewStyle>;
};

// Rates the restaurant as a whole, with no location to pick. Each save is a
// new visit, so people can rate a place again after every trip. (The Log tab
// records visits to a specific location.) Restaurants without a brand fall
// back to that one location.
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
  const [rating, setRating] = useState(0);
  const [pastRatings, setPastRatings] = useState<number[]>([]);

  async function openSheet() {
    setOpen(true);
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be signed in to rate.');

      // The user's earlier ratings at any location of this brand, newest
      // first, to show their history.
      const locationIds = await getBrandLocationIds(restaurantId, brandId);

      const query = supabase
        .from('restaurant_ratings')
        .select('rating')
        .eq('user_id', user.id)
        .not('rating', 'is', null)
        .order('visited_at', { ascending: false });

      const { data, error } = brandId
        ? await query.or(
            `restaurant_id.in.(${locationIds.join(',')}),brand_id.eq.${brandId}`
          )
        : await query.eq('restaurant_id', restaurantId);

      if (error) throw new Error(error.message);

      setPastRatings((data ?? []).map((row) => Number(row.rating)));
      setRating(0);
    } catch (error) {
      setOpen(false);
      Alert.alert(
        'Rating error',
        error instanceof Error ? error.message : 'Could not load your rating.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveRating() {
    if (rating < 0.5) {
      return;
    }

    setSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be signed in to rate.');

      const { error } = await supabase
        .from('restaurant_ratings')
        .insert(
          brandId
            ? { user_id: user.id, brand_id: brandId, rating }
            : { user_id: user.id, restaurant_id: restaurantId, rating }
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

          {!loading && pastRatings.length > 0 ? (
            <Text style={styles.historyText}>
              You’ve rated it{' '}
              {pastRatings.length === 1
                ? 'once'
                : `${pastRatings.length} times`}{' '}
              · last {pastRatings[0].toFixed(1)} ★
            </Text>
          ) : null}

          {loading ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <>
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
  historyText: {
    color: Palette.textSecondary,
    fontSize: 14,
    marginTop: -8,
    marginBottom: 16,
  },
  loading: {
    marginVertical: 24,
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
