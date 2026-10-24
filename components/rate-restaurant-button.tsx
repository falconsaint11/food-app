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
import { supabase } from '@/lib/supabase';

type RateRestaurantButtonProps = {
  restaurantId: string;
  brandId: string | null;
  restaurantName: string;
  onSaved: () => void;
  style?: StyleProp<ViewStyle>;
};

// Rates the restaurant as a whole: one brand-wide rating per user, with no
// location to pick. (Logging in the Log tab rates the specific location.)
// Restaurants without a brand fall back to rating that one location.
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

  async function openSheet() {
    setOpen(true);
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be signed in to rate.');

      const query = supabase
        .from('restaurant_ratings')
        .select('rating')
        .eq('user_id', user.id);

      const { data, error } = brandId
        ? await query.eq('brand_id', brandId).maybeSingle()
        : await query.eq('restaurant_id', restaurantId).maybeSingle();

      if (error) throw new Error(error.message);

      setRating(data ? Number(data.rating) : 0);
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

      const { error } = brandId
        ? await supabase
            .from('restaurant_ratings')
            .upsert(
              { user_id: user.id, brand_id: brandId, rating },
              { onConflict: 'user_id,brand_id' }
            )
        : await supabase
            .from('restaurant_ratings')
            .upsert(
              { user_id: user.id, restaurant_id: restaurantId, rating },
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
