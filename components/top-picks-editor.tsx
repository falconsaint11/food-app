import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

// Something the user can put in their top 4.
export type PickOption = {
  // What identifies the option on screen (a dish id, or a brand id so each
  // restaurant appears once).
  key: string;
  // The id saved in the rankings table.
  saveId: string;
  name: string;
  subtitle: string | null;
};

type TopPicksEditorProps = {
  noun: 'dishes' | 'restaurants';
  rankingTable: 'dish_rankings' | 'restaurant_rankings';
  idColumn: 'dish_id' | 'restaurant_id';
  // Everything the user rated, and the keys of their current top 4 in order.
  loadOptions: (
    userId: string
  ) => Promise<{ options: PickOption[]; selectedKeys: string[] }>;
};

const MAX_PICKS = 4;

// Picks a profile's top 4 dishes or restaurants. The current picks sit in a
// row at the top (tap to remove), with everything else the user rated below
// in A–Z order and a search box. Every change saves right away.
export function TopPicksEditor({
  noun,
  rankingTable,
  idColumn,
  loadOptions,
}: TopPicksEditorProps) {
  const [options, setOptions] = useState<PickOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Saves run one after another so a quick second tap can't interleave
  // with the first one's delete and insert.
  const saveQueue = useRef(Promise.resolve());

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('No signed-in user found.');

      userIdRef.current = user.id;

      const result = await loadOptions(user.id);

      setOptions(
        [...result.options].sort((a, b) => a.name.localeCompare(b.name))
      );
      setSelected(result.selectedKeys.slice(0, MAX_PICKS));
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : `Could not load your ${noun}.`
      );
    } finally {
      setLoading(false);
    }
  }, [loadOptions, noun]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function save(keys: string[]) {
    const userId = userIdRef.current;
    if (!userId) return;

    const saveIds = keys
      .map((key) => options.find((option) => option.key === key)?.saveId)
      .filter((id): id is string => Boolean(id));

    setSaveStatus('saving');

    saveQueue.current = saveQueue.current.then(async () => {
      const { error: deleteError } = await supabase
        .from(rankingTable)
        .delete()
        .eq('user_id', userId);

      if (deleteError) {
        setSaveStatus(null);
        Alert.alert('Error', deleteError.message);
        return;
      }

      if (saveIds.length > 0) {
        const { error: insertError } = await supabase.from(rankingTable).insert(
          saveIds.map((id, index) => ({
            user_id: userId,
            [idColumn]: id,
            rank: index + 1,
          }))
        );

        if (insertError) {
          setSaveStatus(null);
          Alert.alert('Error', insertError.message);
          return;
        }
      }

      setSaveStatus('saved');
    });
  }

  function add(key: string) {
    if (selected.length >= MAX_PICKS) {
      Alert.alert(
        'Top 4 is full',
        `Tap one of your top ${noun} to remove it first.`
      );
      return;
    }

    const next = [...selected, key];
    setSelected(next);
    save(next);
  }

  function remove(key: string) {
    const next = selected.filter((item) => item !== key);
    setSelected(next);
    save(next);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Palette.accent} />
      </View>
    );
  }

  const query = search.trim().toLowerCase();
  const rest = options.filter(
    (option) =>
      !selected.includes(option.key) &&
      (!query ||
        option.name.toLowerCase().includes(query) ||
        option.subtitle?.toLowerCase().includes(query))
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.topHeader}>
          <Text style={styles.sectionTitle}>Your top 4</Text>
          <Text style={styles.saveStatus}>
            {saveStatus === 'saving'
              ? 'Saving…'
              : saveStatus === 'saved'
                ? 'Saved'
                : 'Tap to remove'}
          </Text>
        </View>

        <View style={styles.slots}>
          {Array.from({ length: MAX_PICKS }, (_, index) => {
            const key = selected[index];
            const option = options.find((item) => item.key === key);

            if (!key) {
              return (
                <View key={index} style={[styles.slot, styles.emptySlot]}>
                  <Text style={styles.emptySlotText}>#{index + 1}</Text>
                </View>
              );
            }

            return (
              <TouchableOpacity
                key={key}
                style={styles.slot}
                onPress={() => remove(key)}
              >
                <View style={styles.slotTop}>
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankBadgeText}>#{index + 1}</Text>
                  </View>
                  <Text style={styles.removeIcon}>✕</Text>
                </View>
                <Text style={styles.slotName} numberOfLines={3}>
                  {option?.name ?? 'Unknown'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search your ${noun}`}
          placeholderTextColor={Palette.textMuted}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={rest}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {query
              ? `No ${noun} match "${search.trim()}".`
              : options.length === 0
                ? `Rate some ${noun} and they'll show up here.`
                : `All your rated ${noun} are in your top 4.`}
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => add(item.key)}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.subtitle ? (
                <Text style={styles.rowSubtitle} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              ) : null}
            </View>
            <Text style={styles.addIcon}>+</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Palette.background,
  },
  header: {
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  sectionTitle: {
    color: Palette.text,
    fontSize: 18,
    fontWeight: '700',
  },
  saveStatus: {
    color: Palette.textMuted,
    fontSize: 13,
  },
  slots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  slot: {
    flex: 1,
    minHeight: 92,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    backgroundColor: Palette.surface,
    padding: 8,
  },
  emptySlot: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySlotText: {
    color: Palette.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  slotTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rankBadge: {
    backgroundColor: Palette.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rankBadgeText: {
    color: Palette.text,
    fontSize: 11,
    fontWeight: '700',
  },
  removeIcon: {
    color: Palette.textMuted,
    fontSize: 12,
  },
  slotName: {
    color: Palette.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  search: {
    backgroundColor: Palette.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Palette.text,
    fontSize: 16,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  rowInfo: {
    flex: 1,
    paddingRight: 16,
  },
  rowName: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 14,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  addIcon: {
    color: Palette.accent,
    fontSize: 24,
    fontWeight: '600',
  },
  emptyText: {
    color: Palette.textSecondary,
    fontSize: 15,
    paddingVertical: 24,
  },
});
