import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type RestaurantTag = {
  tag_key: string;
  label: string;
  votes: number;
  mine: boolean;
};

type RestaurantTagsProps = {
  restaurantId: string;
};

// How many tags show before "+N more".
const COLLAPSED_COUNT = 6;

// Suggested until enough people have tagged places for popular tags to take over.
const STARTER_TAGS = [
  'Date Night',
  'Late Night',
  'Patio',
  'Good for Groups',
  'Family Friendly',
  'Cheap Eats',
  'Quick Bite',
  'Cozy',
  'Hidden Gem',
  'Great Service',
  'Happy Hour',
  'Vegan Friendly',
  'Dog Friendly',
  'Live Music',
  'Sports Bar',
  'Drive-Thru',
];

// Matches the database rule: 2-24 letters, numbers, spaces and & ' + . / -
const TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} &'+./-]*$/u;

function cleanTag(text: string) {
  return text.trim().replace(/\s+/g, ' ');
}

// Steam-style tags: people tag a restaurant or vote for an existing tag, and
// the tags with the most votes show first. Tap a tag to add or remove your
// vote.
export function RestaurantTags({ restaurantId }: RestaurantTagsProps) {
  const [tags, setTags] = useState<RestaurantTag[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    const { data, error } = await supabase.rpc('restaurant_tags', {
      p_restaurant_id: restaurantId,
    });

    if (error) {
      console.log('Restaurant tags error:', error.message);
      return;
    }

    setTags((data ?? []) as RestaurantTag[]);
  }, [restaurantId]);

  useFocusEffect(
    useCallback(() => {
      loadTags();
    }, [loadTags])
  );

  async function openSheet() {
    setDraft('');
    setSheetOpen(true);

    const { data, error } = await supabase.rpc('popular_restaurant_tags', {
      p_limit: 20,
    });

    if (error) {
      console.log('Popular tags error:', error.message);
    }

    const popular = ((data ?? []) as { label: string }[]).map((tag) => tag.label);
    const seen = new Set<string>();

    setSuggestions(
      [...popular, ...STARTER_TAGS].filter((label) => {
        const key = label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
    );
  }

  async function addVote(text: string) {
    const label = cleanTag(text);
    const key = label.toLowerCase();

    if (label.length < 2 || label.length > 24 || !TAG_PATTERN.test(label)) {
      Alert.alert(
        'Check your tag',
        "Tags are 2-24 characters: letters, numbers, spaces and & ' + . / -"
      );
      return;
    }

    if (tags.some((tag) => tag.tag_key === key && tag.mine)) {
      setSheetOpen(false);
      return;
    }

    setSaving(key);

    const { error } = await supabase
      .from('restaurant_tag_votes')
      .insert({ restaurant_id: restaurantId, label });

    setSaving(null);

    if (error) {
      Alert.alert('Tag error', error.message);
      return;
    }

    setSheetOpen(false);
    loadTags();
  }

  async function removeVote(tag: RestaurantTag) {
    setSaving(tag.tag_key);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('restaurant_tag_votes')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('tag_key', tag.tag_key)
      .eq('user_id', user?.id ?? '');

    setSaving(null);

    if (error) {
      Alert.alert('Tag error', error.message);
      return;
    }

    loadTags();
  }

  function toggle(tag: RestaurantTag) {
    if (saving) return;

    if (tag.mine) {
      removeVote(tag);
    } else {
      addVote(tag.label);
    }
  }

  const visible = showAll ? tags : tags.slice(0, COLLAPSED_COUNT);
  const hiddenCount = tags.length - visible.length;
  const myKeys = new Set(tags.filter((tag) => tag.mine).map((tag) => tag.tag_key));

  return (
    <View style={styles.section}>
      <View style={styles.chips}>
        {visible.map((tag) => (
          <TouchableOpacity
            key={tag.tag_key}
            style={[styles.chip, tag.mine && styles.chipMine]}
            onPress={() => toggle(tag)}
            disabled={saving !== null}
            accessibilityLabel={`${tag.label}, ${tag.votes} ${
              tag.votes === 1 ? 'vote' : 'votes'
            }${tag.mine ? ', you tagged this' : ''}`}
          >
            <Text style={[styles.chipText, tag.mine && styles.chipTextMine]}>
              {tag.label}
            </Text>
            {saving === tag.tag_key ? (
              <ActivityIndicator size="small" color={Palette.textMuted} />
            ) : (
              <Text style={styles.chipCount}>{tag.votes}</Text>
            )}
          </TouchableOpacity>
        ))}

        {hiddenCount > 0 ? (
          <TouchableOpacity style={styles.chip} onPress={() => setShowAll(true)}>
            <Text style={styles.moreText}>+{hiddenCount} more</Text>
          </TouchableOpacity>
        ) : null}

        {showAll && tags.length > COLLAPSED_COUNT ? (
          <TouchableOpacity style={styles.chip} onPress={() => setShowAll(false)}>
            <Text style={styles.moreText}>Show less</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={[styles.chip, styles.addChip]} onPress={openSheet}>
          <Text style={styles.addText}>+ Tag</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)} />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Tag this restaurant</Text>
            <Text style={styles.sheetHint}>
              What&apos;s it good for? Pick a tag or make your own.
            </Text>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="e.g. Date Night"
                placeholderTextColor={Palette.textMuted}
                maxLength={24}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={() => addVote(draft)}
              />

              <TouchableOpacity
                style={[styles.addButton, !cleanTag(draft) && styles.disabled]}
                onPress={() => addVote(draft)}
                disabled={!cleanTag(draft) || saving !== null}
              >
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.suggestionScroll}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.chips}>
                {suggestions
                  .filter((label) => !myKeys.has(label.toLowerCase()))
                  .filter((label) =>
                    label.toLowerCase().includes(cleanTag(draft).toLowerCase())
                  )
                  .map((label) => (
                    <TouchableOpacity
                      key={label}
                      style={styles.chip}
                      onPress={() => addVote(label)}
                      disabled={saving !== null}
                    >
                      <Text style={styles.chipText}>{label}</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => setSheetOpen(false)}
            >
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 14,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
  },
  chipMine: {
    borderColor: Palette.accent,
  },
  chipText: {
    color: Palette.textBody,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextMine: {
    color: Palette.accent,
  },
  chipCount: {
    color: Palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  moreText: {
    color: Palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  addChip: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  addText: {
    color: Palette.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 24,
    paddingBottom: 40,
  },
  sheetTitle: {
    color: Palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  sheetHint: {
    color: Palette.textMuted,
    fontSize: 14,
    marginTop: 4,
    marginBottom: 14,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: Palette.text,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  addButtonText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  suggestionScroll: {
    maxHeight: 220,
  },
  doneButton: {
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: Palette.elevated,
    alignItems: 'center',
  },
  doneText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
