import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fetchUserLists, ListSummary, ListType } from '@/lib/lists';

type ListsSectionProps = {
  userId: string;
  isOwner: boolean;
};

export function ListsSection({ userId, isOwner }: ListsSectionProps) {
  const [listType, setListType] = useState<ListType>('dish');
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadLists();
    }, [userId])
  );

  async function loadLists() {
    try {
      setLists(await fetchUserLists(userId));
    } catch (error) {
      console.log('Lists error:', error);
    } finally {
      setLoaded(true);
    }
  }

  const visibleLists = lists.filter((list) => list.list_type === listType);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Lists</Text>

        {isOwner ? (
          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: '/create-list',
                params: { type: listType },
              })
            }
          >
            <Text style={styles.newListLink}>+ New List</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.toggle}>
        {(['dish', 'restaurant'] as const).map((type) => (
          <TouchableOpacity
            key={type}
            style={[
              styles.toggleButton,
              listType === type && styles.toggleButtonActive,
            ]}
            onPress={() => setListType(type)}
          >
            <Text
              style={[
                styles.toggleText,
                listType === type && styles.toggleTextActive,
              ]}
            >
              {type === 'dish' ? 'Dishes' : 'Restaurants'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!loaded ? null : visibleLists.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {listType === 'dish' ? 'No dish lists yet.' : 'No restaurant lists yet.'}
          </Text>
        </View>
      ) : (
        visibleLists.map((list) => (
          <TouchableOpacity
            key={list.id}
            style={styles.listRow}
            onPress={() =>
              router.push({
                pathname: '/list/[id]',
                params: { id: list.id },
              })
            }
          >
            <Text style={styles.listName} numberOfLines={1}>
              {list.name}
            </Text>

            <Text style={styles.listMeta}>
              {list.itemCount} {list.itemCount === 1 ? 'item' : 'items'}
              {list.is_public ? '' : ' · Private'}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 21,
    fontWeight: '700',
  },
  newListLink: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555555',
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#f2f2f2',
    borderRadius: 10,
    padding: 3,
    marginBottom: 10,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#ffffff',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#777777',
  },
  toggleTextActive: {
    color: '#111111',
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 12,
    padding: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#777777',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  listName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    paddingRight: 12,
  },
  listMeta: {
    fontSize: 13,
    color: '#777777',
  },
});
