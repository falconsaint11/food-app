import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { MenuAction } from '@/components/content-menu';
import { useIsCurator } from '@/lib/admin';
import { supabase } from '@/lib/supabase';

type Target = 'dish' | 'restaurant';

// Curator options for a review photo's "⋯" menu: pin it as the cover of its
// dish or its restaurant (see pin_cover_photo()), or unpin it. Empty for
// everyone else.
export function useCoverPinActions(reviewId: string, hasPhoto: boolean) {
  const isCurator = useIsCurator();
  const [pinned, setPinned] = useState<Record<Target, boolean> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isCurator || !hasPhoto) return;

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
  }, [isCurator, hasPhoto, reviewId]);

  if (!isCurator || !hasPhoto || !pinned) {
    return [];
  }

  async function toggle(target: Target) {
    if (!pinned || busy) return;

    const pin = !pinned[target];
    setBusy(true);

    const { error } = await supabase.rpc('pin_cover_photo', {
      p_review_id: reviewId,
      p_target: target,
      p_pin: pin,
    });

    setBusy(false);

    if (error) {
      Alert.alert('Could not pin', error.message);
      return;
    }

    setPinned({ ...pinned, [target]: pin });
  }

  return (['dish', 'restaurant'] as const).map((target): MenuAction => ({
    label: pinned[target]
      ? `Unpin ${target} cover 📌`
      : `Pin as ${target} cover`,
    onPress: () => toggle(target),
  }));
}
