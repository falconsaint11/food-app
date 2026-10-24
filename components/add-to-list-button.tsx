import { router } from 'expo-router';
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

import { fetchUserLists, ListSummary, ListType } from '@/lib/lists';
import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

type AddToListButtonProps = {
  listType: ListType;
  targetId: string;
  style?: StyleProp<ViewStyle>;
};

export function AddToListButton({
  listType,
  targetId,
  style,
}: AddToListButtonProps) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [containing, setContaining] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [savingListId, setSavingListId] = useState<string | null>(null);

  const targetColumn = listType === 'dish' ? 'dish_id' : 'restaurant_id';

  async function openSheet() {
    setOpen(true);
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('No signed-in user found.');
      }

      const userLists = await fetchUserLists(user.id, listType);

      setLists(userLists);

      if (userLists.length === 0) {
        setContaining(new Set());
        return;
      }

      const { data, error } = await supabase
        .from('list_items')
        .select('list_id')
        .eq(targetColumn, targetId)
        .in(
          'list_id',
          userLists.map((list) => list.id)
        );

      if (error) {
        throw new Error(error.message);
      }

      setContaining(new Set((data ?? []).map((item) => item.list_id)));
    } catch (error) {
      setOpen(false);
      Alert.alert(
        'List error',
        error instanceof Error ? error.message : 'Could not load your lists.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function toggleList(list: ListSummary) {
    setSavingListId(list.id);

    const isInList = containing.has(list.id);

    const { error } = isInList
      ? await supabase
          .from('list_items')
          .delete()
          .eq('list_id', list.id)
          .eq(targetColumn, targetId)
      : await supabase.from('list_items').insert({
          list_id: list.id,
          [targetColumn]: targetId,
          position: list.itemCount,
        });

    setSavingListId(null);

    if (error) {
      Alert.alert('List error', error.message);
      return;
    }

    const next = new Set(containing);
    const countChange = isInList ? -1 : 1;

    if (isInList) {
      next.delete(list.id);
    } else {
      next.add(list.id);
    }

    setContaining(next);
    setLists((current) =>
      current.map((item) =>
        item.id === list.id
          ? { ...item, itemCount: item.itemCount + countChange }
          : item
      )
    );
  }

  function createNewList() {
    setOpen(false);

    router.push({
      pathname: '/create-list',
      params: listType === 'dish' ? { dishId: targetId } : { restaurantId: targetId },
    });
  }

  return (
    <>
      <TouchableOpacity style={[styles.button, style]} onPress={openSheet}>
        <Text style={styles.buttonText} numberOfLines={1}>
          + Add to List
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
          <Text style={styles.sheetTitle}>
            {listType === 'dish' ? 'Your dish lists' : 'Your restaurant lists'}
          </Text>

          {loading ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <ScrollView style={styles.listScroll}>
              {lists.length === 0 ? (
                <Text style={styles.emptyText}>
                  You don&apos;t have any {listType} lists yet.
                </Text>
              ) : (
                lists.map((list) => {
                  const checked = containing.has(list.id);

                  return (
                    <TouchableOpacity
                      key={list.id}
                      style={styles.listRow}
                      onPress={() => toggleList(list)}
                      disabled={savingListId !== null}
                    >
                      <View style={styles.listInfo}>
                        <Text style={styles.listName} numberOfLines={1}>
                          {list.name}
                        </Text>

                        <Text style={styles.listMeta}>
                          {list.itemCount}{' '}
                          {list.itemCount === 1 ? 'item' : 'items'}
                        </Text>
                      </View>

                      {savingListId === list.id ? (
                        <ActivityIndicator />
                      ) : (
                        <View
                          style={[
                            styles.checkbox,
                            checked && styles.checkboxChecked,
                          ]}
                        >
                          {checked ? (
                            <Text style={styles.checkmark}>✓</Text>
                          ) : null}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.newListButton} onPress={createNewList}>
            <Text style={styles.newListText}>+ New List</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => setOpen(false)}
          >
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
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
    maxHeight: '70%',
  },
  sheetTitle: {
    color: Palette.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
  },
  loading: {
    marginVertical: 24,
  },
  listScroll: {
    flexGrow: 0,
  },
  emptyText: {
    fontSize: 15,
    color: Palette.textMuted,
    paddingVertical: 12,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  listInfo: {
    flex: 1,
    paddingRight: 12,
  },
  listName: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  listMeta: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  checkmark: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  newListButton: {
    paddingVertical: 16,
  },
  newListText: {
    fontSize: 16,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  doneButton: {
    paddingVertical: 15,
    borderRadius: 10,
    backgroundColor: Palette.accent,
    alignItems: 'center',
  },
  doneText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
