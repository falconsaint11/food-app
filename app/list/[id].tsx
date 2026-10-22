import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { ListItemSearch } from '@/components/list-item-search';
import {
    fetchDishRatings,
    fetchRestaurantRatings,
    formatRating,
    ListType,
    RatingSummary,
} from '@/lib/lists';
import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

type ListDetail = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  list_type: ListType;
  is_public: boolean;
  profiles: {
    username: string;
    display_name: string | null;
  } | null;
};

type ListItem = {
  id: string;
  position: number;
  dish_id: string | null;
  restaurant_id: string | null;
  dishes: {
    id: string;
    name: string;
    restaurants: {
      name: string;
    } | null;
  } | null;
  restaurants: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
  } | null;
};

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [list, setList] = useState<ListDetail | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [ratings, setRatings] = useState<Map<string, RatingSummary>>(
    new Map()
  );
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadList();
    }, [id])
  );

  async function loadList() {
    if (!id) {
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: listData, error: listError } = await supabase
      .from('lists')
      .select(`
        id,
        user_id,
        name,
        description,
        list_type,
        is_public,
        profiles (
          username,
          display_name
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (listError) {
      setLoading(false);
      Alert.alert('List error', listError.message);
      return;
    }

    if (!listData) {
      setList(null);
      setLoading(false);
      return;
    }

    const detail = listData as unknown as ListDetail;

    setList(detail);
    setIsOwner(user?.id === detail.user_id);

    await loadItems(detail.list_type);

    setLoading(false);
  }

  async function loadItems(listType: ListType) {
    const { data, error } = await supabase
      .from('list_items')
      .select(`
        id,
        position,
        dish_id,
        restaurant_id,
        dishes (
          id,
          name,
          restaurants (
            name
          )
        ),
        restaurants (
          id,
          name,
          city,
          state
        )
      `)
      .eq('list_id', id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      Alert.alert('List error', error.message);
      return;
    }

    const listItems = (data ?? []) as unknown as ListItem[];

    setItems(listItems);

    try {
      const targetIds = listItems
        .map((item) =>
          listType === 'dish' ? item.dish_id : item.restaurant_id
        )
        .filter((targetId): targetId is string => Boolean(targetId));

      setRatings(
        listType === 'dish'
          ? await fetchDishRatings(targetIds)
          : await fetchRestaurantRatings(targetIds)
      );
    } catch (ratingError) {
      console.log('List rating error:', ratingError);
    }
  }

  async function addItem(targetId: string) {
    if (!list) {
      return;
    }

    const alreadyAdded = items.some(
      (item) => item.dish_id === targetId || item.restaurant_id === targetId
    );

    if (alreadyAdded) {
      Alert.alert('Already added', 'That is already in this list.');
      return;
    }

    const nextPosition =
      items.length > 0
        ? Math.max(...items.map((item) => item.position)) + 1
        : 0;

    const { error } = await supabase.from('list_items').insert({
      list_id: list.id,
      dish_id: list.list_type === 'dish' ? targetId : null,
      restaurant_id: list.list_type === 'restaurant' ? targetId : null,
      position: nextPosition,
    });

    if (error) {
      throw new Error(error.message);
    }

    await loadItems(list.list_type);
  }

  async function removeItem(itemId: string) {
    const { error } = await supabase
      .from('list_items')
      .delete()
      .eq('id', itemId);

    if (error) {
      Alert.alert('List error', error.message);
      return;
    }

    setItems((current) => current.filter((item) => item.id !== itemId));
  }

  async function toggleVisibility() {
    if (!list) {
      return;
    }

    const { error } = await supabase
      .from('lists')
      .update({ is_public: !list.is_public })
      .eq('id', list.id);

    if (error) {
      Alert.alert('List error', error.message);
      return;
    }

    setList({ ...list, is_public: !list.is_public });
  }

  function confirmDelete() {
    Alert.alert('Delete list', 'Are you sure you want to delete this list?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('lists')
            .delete()
            .eq('id', id);

          if (error) {
            Alert.alert('List error', error.message);
            return;
          }

          router.back();
        },
      },
    ]);
  }

  function openItem(item: ListItem) {
    if (item.dish_id) {
      router.push({ pathname: '/dish/[id]', params: { id: item.dish_id } });
    } else if (item.restaurant_id) {
      router.push({
        pathname: '/restaurant/[id]',
        params: { id: item.restaurant_id },
      });
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'List' }} />
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!list) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'List' }} />
        <Text style={styles.notFound}>
          This list doesn&apos;t exist or is private.
        </Text>
      </View>
    );
  }

  const ownerName =
    list.profiles?.display_name || list.profiles?.username || 'User';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'List' }} />

      <Text style={styles.title}>{list.name}</Text>

      <Text style={styles.meta}>
        {list.list_type === 'dish' ? 'Dish list' : 'Restaurant list'} by{' '}
        {ownerName}
        {list.is_public ? '' : ' · Private'}
      </Text>

      {list.description ? (
        <Text style={styles.description}>{list.description}</Text>
      ) : null}

      {isOwner ? (
        <View style={styles.searchWrapper}>
          <ListItemSearch listType={list.list_type} onSelect={addItem} />
        </View>
      ) : null}

      <View style={styles.section}>
        {items.length === 0 ? (
          <Text style={styles.emptyText}>
            {isOwner
              ? 'Nothing here yet. Search above to add something.'
              : 'Nothing here yet.'}
          </Text>
        ) : (
          items.map((item, index) => {
            const targetId =
              list.list_type === 'dish' ? item.dish_id : item.restaurant_id;

            const title =
              list.list_type === 'dish'
                ? item.dishes?.name ?? 'Unknown dish'
                : item.restaurants?.name ?? 'Unknown restaurant';

            const subtitle =
              list.list_type === 'dish'
                ? item.dishes?.restaurants?.name ?? ''
                : [item.restaurants?.city, item.restaurants?.state]
                    .filter(Boolean)
                    .join(', ');

            return (
              <TouchableOpacity
                key={item.id}
                style={styles.itemRow}
                onPress={() => openItem(item)}
              >
                <Text style={styles.itemNumber}>{index + 1}</Text>

                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{title}</Text>

                  {subtitle ? (
                    <Text style={styles.itemSubtext}>{subtitle}</Text>
                  ) : null}
                </View>

                <Text style={styles.itemRating}>
                  {formatRating(targetId ? ratings.get(targetId) : undefined)}
                </Text>

                {isOwner ? (
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => removeItem(item.id)}
                    hitSlop={8}
                  >
                    <Text style={styles.removeText}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {isOwner ? (
        <View style={styles.ownerActions}>
          <TouchableOpacity onPress={toggleVisibility}>
            <Text style={styles.actionText}>
              {list.is_public ? 'Make Private' : 'Make Public'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={confirmDelete}>
            <Text style={styles.deleteText}>Delete List</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
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
    paddingBottom: 50,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: Palette.background,
  },
  notFound: {
    fontSize: 16,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  title: {
    color: Palette.text,
    fontSize: 28,
    fontWeight: '700',
  },
  meta: {
    fontSize: 14,
    color: Palette.textMuted,
    marginTop: 6,
  },
  description: {
    color: Palette.text,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 12,
  },
  searchWrapper: {
    marginTop: 22,
  },
  section: {
    marginTop: 20,
  },
  emptyText: {
    fontSize: 15,
    color: Palette.textMuted,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  itemNumber: {
    width: 28,
    fontSize: 15,
    fontWeight: '700',
    color: Palette.textMuted,
  },
  itemInfo: {
    flex: 1,
    paddingRight: 12,
  },
  itemName: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '600',
  },
  itemSubtext: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 3,
  },
  itemRating: {
    color: Palette.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  removeButton: {
    marginLeft: 14,
  },
  removeText: {
    fontSize: 15,
    color: Palette.textMuted,
  },
  ownerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 36,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  deleteText: {
    fontSize: 15,
    fontWeight: '600',
    color: Palette.danger,
  },
});
