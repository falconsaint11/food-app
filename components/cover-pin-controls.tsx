import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { useIsCurator } from '@/lib/admin';
import { supabase } from '@/lib/supabase';

type Target = 'dish' | 'restaurant';

// Curator buttons under a review photo: pin it as the cover of its dish or
// its restaurant (see pin_cover_photo()), or unpin it. Hidden for everyone
// else.
export function CoverPinControls({ reviewId }: { reviewId: string }) {
  const isCurator = useIsCurator();
  const [pinned, setPinned] = useState<Record<Target, boolean> | null>(null);
  const [busy, setBusy] = useState<Target | null>(null);

  useEffect(() => {
    if (!isCurator) return;

    supabase
      .rpc('cover_pin_status', { p_review_id: reviewId })
      .then(({ data, error }) => {
        if (error) {
          console.log('Pin status error:', error.message);
          return;
        }

        const row = (data ?? [])[0];
        setPinned({
          dish: row?.dish_pinned === true,
          restaurant: row?.restaurant_pinned === true,
        });
      });
  }, [isCurator, reviewId]);

  if (!isCurator || !pinned) {
    return null;
  }

  async function toggle(target: Target) {
    if (!pinned) return;

    const pin = !pinned[target];
    setBusy(target);

    const { error } = await supabase.rpc('pin_cover_photo', {
      p_review_id: reviewId,
      p_target: target,
      p_pin: pin,
    });

    setBusy(null);

    if (error) {
      Alert.alert('Could not pin', error.message);
      return;
    }

    setPinned({ ...pinned, [target]: pin });
  }

  return (
    <View style={styles.row}>
      {(['dish', 'restaurant'] as const).map((target) => (
        <TouchableOpacity
          key={target}
          style={[styles.button, pinned[target] && styles.buttonOn]}
          onPress={() => toggle(target)}
          disabled={busy !== null}
        >
          <Text style={[styles.text, pinned[target] && styles.textOn]}>
            {busy === target
              ? '…'
              : pinned[target]
                ? `📌 ${target === 'dish' ? 'Dish' : 'Restaurant'} cover · Unpin`
                : `Pin as ${target} cover`}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
  },
  buttonOn: {
    borderColor: Palette.accent,
  },
  text: {
    color: Palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  textOn: {
    color: Palette.accent,
  },
});
