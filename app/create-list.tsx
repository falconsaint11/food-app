import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import { ListType } from '@/lib/lists';
import { supabase } from '@/lib/supabase';

export default function CreateListScreen() {
  const params = useLocalSearchParams<{
    type?: string;
    dishId?: string;
    restaurantId?: string;
  }>();

  // When opened from "Add to list" on a dish or restaurant page, the type is
  // fixed and that item is added to the new list.
  const firstItemId = params.dishId ?? params.restaurantId ?? null;
  const lockedType: ListType | null = params.dishId
    ? 'dish'
    : params.restaurantId
      ? 'restaurant'
      : null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [listType, setListType] = useState<ListType>(
    lockedType ?? (params.type === 'restaurant' ? 'restaurant' : 'dish')
  );
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  async function createList() {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Give your list a name.');
      return;
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
      Alert.alert('Error', 'No signed-in user found.');
      return;
    }

    const { data: newList, error } = await supabase
      .from('lists')
      .insert({
        user_id: user.id,
        name: name.trim(),
        description: description.trim() || null,
        list_type: listType,
        is_public: isPublic,
      })
      .select('id')
      .single();

    if (error || !newList) {
      setSaving(false);

      // 23503 = foreign key violation: the user has no profile row yet
      Alert.alert(
        'List error',
        error?.code === '23503'
          ? 'Create your profile before making lists.'
          : error?.message ?? 'Could not create list.'
      );
      return;
    }

    if (firstItemId) {
      const { error: itemError } = await supabase.from('list_items').insert({
        list_id: newList.id,
        dish_id: listType === 'dish' ? firstItemId : null,
        restaurant_id: listType === 'restaurant' ? firstItemId : null,
        position: 0,
      });

      setSaving(false);

      if (itemError) {
        Alert.alert('List error', itemError.message);
      }

      router.back();
      return;
    }

    setSaving(false);

    router.replace({
      pathname: '/list/[id]',
      params: { id: newList.id },
    });
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: 'New List' }} />

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Name</Text>

        <TextInput
          style={styles.input}
          placeholder="Best tacos in town"
          placeholderTextColor="#888888"
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Description (optional)</Text>

        <TextInput
          style={[styles.input, styles.multilineInput]}
          placeholder="What's this list about?"
          placeholderTextColor="#888888"
          multiline
          value={description}
          onChangeText={setDescription}
        />

        <Text style={styles.label}>Type</Text>

        <View style={styles.toggle}>
          {(['dish', 'restaurant'] as const).map((type) => {
            const disabled = lockedType !== null && lockedType !== type;

            return (
              <TouchableOpacity
                key={type}
                style={[
                  styles.toggleButton,
                  listType === type && styles.toggleButtonActive,
                  disabled && styles.toggleButtonDisabled,
                ]}
                onPress={() => setListType(type)}
                disabled={disabled}
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
            );
          })}
        </View>

        <Text style={styles.hint}>
          The type can&apos;t be changed after the list is created.
        </Text>

        <View style={styles.switchRow}>
          <View style={styles.switchInfo}>
            <Text style={styles.switchLabel}>Public</Text>

            <Text style={styles.hint}>
              {isPublic
                ? 'Anyone can see this list on your profile.'
                : 'Only you can see this list.'}
            </Text>
          </View>

          <Switch value={isPublic} onValueChange={setIsPublic} />
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, saving && styles.disabledButton]}
          onPress={createList}
          disabled={saving}
        >
          <Text style={styles.primaryButtonText}>
            {saving ? 'Creating...' : 'Create List'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    padding: 24,
    paddingBottom: 50,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222222',
    marginBottom: 7,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111111',
    marginBottom: 18,
  },
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#f2f2f2',
    borderRadius: 10,
    padding: 3,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#ffffff',
  },
  toggleButtonDisabled: {
    opacity: 0.4,
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#777777',
  },
  toggleTextActive: {
    color: '#111111',
  },
  hint: {
    fontSize: 13,
    color: '#777777',
    marginTop: 6,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 30,
  },
  switchInfo: {
    flex: 1,
    paddingRight: 16,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 10,
    backgroundColor: '#111111',
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
