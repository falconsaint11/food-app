import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import { getBrandLocationIds } from '@/lib/brands';
import { supabase } from '@/lib/supabase';
import { fetchTags, Tag } from '@/lib/tags';

type ScannedDish = {
  name: string;
  price: string;
  section: string;
  description: string;
  options: string[];
  // Flavors or proteins the menu names, each saved as its own dish
  // ("Mango" -> "Mango Slushie Margarita").
  variants: string[];
  tags: string[];
};

type ReviewItem = ScannedDish & {
  key: string;
  selected: boolean;
};

// Menu import is for getting a restaurant started; import_menu_dishes()
// refuses restaurants with this many dishes or more.
const MAX_EXISTING_DISHES = 10;

// Admin tool: photograph a restaurant's menu, let Claude read the dishes (the
// menu-scan edge function), review them, then add them to this location with
// import_menu_dishes(). Dishes already on the menu are skipped by the
// database, but still get any new tags.
export default function MenuImportScreen() {
  const { restaurantId, restaurantName } = useLocalSearchParams<{
    restaurantId: string;
    restaurantName: string;
  }>();
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [hasFullMenu, setHasFullMenu] = useState(false);

  useEffect(() => {
    fetchTags()
      .then(setAllTags)
      .catch((error) => console.log('Tags error:', error));
  }, []);

  // Checked up front so a scan isn't paid for and then refused on save.
  // Counted like the restaurant page: same-named dishes across the brand
  // count once.
  useEffect(() => {
    if (!restaurantId) return;

    (async () => {
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('brand_id')
        .eq('id', restaurantId)
        .maybeSingle();

      const locationIds = await getBrandLocationIds(
        restaurantId,
        (restaurant?.brand_id as string | null) ?? null
      );

      const { data: dishes } = await supabase
        .from('dishes')
        .select('name_key')
        .in('restaurant_id', locationIds);

      const names = new Set((dishes ?? []).map((dish) => dish.name_key as string));
      setHasFullMenu(names.size >= MAX_EXISTING_DISHES);
    })().catch((error) => console.log('Menu size check error:', error));
  }, [restaurantId]);

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access to scan a menu.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
    });

    if (!result.canceled) await scan(result.assets);
  }

  async function choosePhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Photo permission needed', 'Allow photo access to scan a menu.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.6,
      base64: true,
    });

    if (!result.canceled) await scan(result.assets);
  }

  // Sends each photo to the menu reader one at a time and merges the
  // results, so a dish on two photos appears once.
  async function scan(assets: ImagePicker.ImagePickerAsset[]) {
    setProgress({ done: 0, total: assets.length });
    const failures: string[] = [];
    const found: ScannedDish[] = [];

    for (const [index, asset] of assets.entries()) {
      if (!asset.base64) {
        failures.push(`Photo ${index + 1}: couldn't be read from the device.`);
        continue;
      }

      const { data, error } = await supabase.functions.invoke('menu-scan', {
        body: { image: asset.base64, mediaType: asset.mimeType ?? 'image/jpeg' },
      });

      if (error) {
        let message = error.message;

        try {
          const context = (error as { context?: Response }).context;
          const body = await context?.json();
          if (body?.error) message = body.error;
        } catch {
          // Keep the generic message.
        }

        failures.push(`Photo ${index + 1}: ${message}`);
      } else {
        found.push(...((data?.dishes ?? []) as ScannedDish[]));
      }

      setProgress({ done: index + 1, total: assets.length });
    }

    setItems((current) => mergeDishes(current, found));
    setProgress(null);

    if (failures.length > 0) {
      Alert.alert('Some photos failed', failures.join('\n'));
    }
  }

  function mergeDishes(current: ReviewItem[], found: ScannedDish[]) {
    const merged = [...current];

    for (const dish of found) {
      const name = dish.name.trim();
      if (!name) continue;

      const key = name.toLowerCase();
      const index = merged.findIndex((item) => item.key === key);

      if (index !== -1) {
        const existing = merged[index];
        merged[index] = {
          ...existing,
          tags: [...new Set([...existing.tags, ...dish.tags])],
          price: existing.price || dish.price,
          section: existing.section || dish.section,
          description: existing.description || dish.description,
          options: [...new Set([...existing.options, ...(dish.options ?? [])])],
          variants: [...new Set([...existing.variants, ...(dish.variants ?? [])])],
        };
      } else {
        merged.push({
          ...dish,
          name,
          key,
          description: dish.description ?? '',
          options: dish.options ?? [],
          variants: dish.variants ?? [],
          selected: true,
        });
      }
    }

    return merged;
  }

  function updateItem(key: string, changes: Partial<ReviewItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...changes } : item))
    );
  }

  function toggleTag(item: ReviewItem, slug: string) {
    updateItem(item.key, {
      tags: item.tags.includes(slug)
        ? item.tags.filter((tag) => tag !== slug)
        : [...item.tags, slug],
    });
  }

  const selectedItems = items.filter((item) => item.selected && item.name.trim());

  async function save() {
    if (!restaurantId || selectedItems.length === 0) return;

    setSaving(true);

    const { data, error } = await supabase.rpc('import_menu_dishes', {
      p_restaurant_id: restaurantId,
      p_items: selectedItems.map((item) => ({
        name: item.name.trim(),
        price: item.price.replace(/[^0-9.]/g, ''),
        section: item.section,
        description: item.description.trim(),
        options: item.options,
        variants: item.variants,
        tags: item.tags,
      })),
    });

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    const result = (data as { added: number; matched: number }[])[0];

    Alert.alert(
      'Menu added',
      `Added ${result.added} new ${result.added === 1 ? 'dish' : 'dishes'}.` +
        (result.matched > 0
          ? ` ${result.matched} ${result.matched === 1 ? 'was' : 'were'} already on the menu and got the new tags.`
          : ''),
      [{ text: 'OK', onPress: () => router.back() }]
    );
  }

  const tagLabels = new Map(allTags.map((tag) => [tag.slug, tag]));

  function renderPhotoButtons() {
    return (
      <View style={styles.photoButtons}>
        <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
          <Text style={styles.photoButtonText}>Take a photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.photoButton} onPress={choosePhotos}>
          <Text style={styles.photoButtonText}>Choose photos</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Add from Menu' }} />

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{restaurantName ?? 'Restaurant'}</Text>

        {hasFullMenu && items.length === 0 ? (
          <Text style={styles.subtitle}>
            This restaurant already has {MAX_EXISTING_DISHES} or more dishes, so
            its menu can&apos;t be imported. Menu import is for getting new
            restaurants started.
          </Text>
        ) : progress ? (
          <View style={styles.progress}>
            <ActivityIndicator color={Palette.accent} />
            <Text style={styles.progressText}>
              Reading page {Math.min(progress.done + 1, progress.total)} of{' '}
              {progress.total}… this takes about 20 seconds a page.
            </Text>
          </View>
        ) : items.length === 0 ? (
          <>
            <Text style={styles.subtitle}>
              Photograph each page of the menu, close enough that the text is
              sharp. You&apos;ll review every dish before anything is added.
            </Text>
            {renderPhotoButtons()}
          </>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.summary}>
                {selectedItems.length} of {items.length} selected
              </Text>
              <TouchableOpacity
                onPress={() =>
                  setItems((current) =>
                    current.map((item) => ({
                      ...item,
                      selected: selectedItems.length !== items.length,
                    }))
                  )
                }
              >
                <Text style={styles.link}>
                  {selectedItems.length === items.length
                    ? 'Select none'
                    : 'Select all'}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.note}>
              Choices like &quot;add protein&quot; are listed under the dish,
              and named flavors or proteins become variants, each rated on its
              own. Tap one to remove it. Outlined tags are dietary. They should only be on dishes the menu
              marks, since people with allergies rely on them.
            </Text>

            {items.map((item) => (
              <View
                key={item.key}
                style={[styles.item, !item.selected && styles.itemUnselected]}
              >
                <View style={styles.itemTop}>
                  <TouchableOpacity
                    style={[styles.checkbox, item.selected && styles.checkboxOn]}
                    onPress={() => updateItem(item.key, { selected: !item.selected })}
                  >
                    {item.selected ? <Text style={styles.checkmark}>✓</Text> : null}
                  </TouchableOpacity>

                  <TextInput
                    style={styles.nameInput}
                    value={item.name}
                    onChangeText={(name) => updateItem(item.key, { name })}
                  />

                  <TextInput
                    style={styles.priceInput}
                    value={item.price}
                    onChangeText={(price) => updateItem(item.key, { price })}
                    placeholder="$"
                    placeholderTextColor={Palette.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>

                {item.section ? (
                  <Text style={styles.section}>{item.section}</Text>
                ) : null}

                <TextInput
                  style={styles.descriptionInput}
                  value={item.description}
                  onChangeText={(description) => updateItem(item.key, { description })}
                  placeholder="Description"
                  placeholderTextColor={Palette.textMuted}
                  multiline
                />

                {item.options.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={styles.optionRow}
                    onPress={() =>
                      updateItem(item.key, {
                        options: item.options.filter((other) => other !== option),
                      })
                    }
                  >
                    <Text style={styles.optionText}>• {option}</Text>
                    <Text style={styles.optionRemove}>✕</Text>
                  </TouchableOpacity>
                ))}

                {item.variants.length > 0 ? (
                  <View style={styles.variantRow}>
                    <Text style={styles.variantLabel}>Variants:</Text>
                    {item.variants.map((variant) => (
                      <TouchableOpacity
                        key={variant}
                        style={styles.tag}
                        onPress={() =>
                          updateItem(item.key, {
                            variants: item.variants.filter((other) => other !== variant),
                          })
                        }
                      >
                        <Text style={styles.tagText}>{variant}  ✕</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                <View style={styles.tagRow}>
                  {(editingTagsFor === item.key
                    ? allTags.map((tag) => tag.slug)
                    : item.tags
                  ).map((slug) => {
                    const tag = tagLabels.get(slug);
                    const on = item.tags.includes(slug);

                    return (
                      <TouchableOpacity
                        key={slug}
                        style={[
                          styles.tag,
                          on && styles.tagOn,
                          tag?.kind === 'dietary' && styles.tagDietary,
                        ]}
                        onPress={() => toggleTag(item, slug)}
                      >
                        <Text style={[styles.tagText, on && styles.tagTextOn]}>
                          {tag?.label ?? slug}
                          {editingTagsFor === item.key ? '' : '  ✕'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TouchableOpacity
                    style={styles.tag}
                    onPress={() =>
                      setEditingTagsFor(editingTagsFor === item.key ? null : item.key)
                    }
                  >
                    <Text style={styles.tagText}>
                      {editingTagsFor === item.key ? 'Done' : '+ Tag'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <Text style={styles.morePages}>Missing a page?</Text>
            {renderPhotoButtons()}
          </>
        )}
      </ScrollView>

      {items.length > 0 && !progress ? (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.saveButton,
              (saving || selectedItems.length === 0) && styles.saveButtonDisabled,
            ]}
            onPress={save}
            disabled={saving || selectedItems.length === 0}
          >
            <Text style={styles.saveButtonText}>
              {saving
                ? 'Adding…'
                : `Add ${selectedItems.length} ${selectedItems.length === 1 ? 'dish' : 'dishes'}`}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  title: {
    color: Palette.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: Palette.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 20,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  photoButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: Palette.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  photoButtonText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '600',
  },
  progress: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 40,
  },
  progressText: {
    color: Palette.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  summary: {
    color: Palette.textSecondary,
    fontSize: 14,
  },
  link: {
    color: Palette.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  note: {
    color: Palette.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  item: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  itemUnselected: {
    opacity: 0.45,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  checkmark: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  nameInput: {
    flex: 1,
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 4,
  },
  priceInput: {
    width: 64,
    color: Palette.text,
    fontSize: 15,
    textAlign: 'right',
    paddingVertical: 4,
  },
  section: {
    color: Palette.textMuted,
    fontSize: 12,
    marginLeft: 34,
    marginTop: 2,
  },
  descriptionInput: {
    color: Palette.textSecondary,
    fontSize: 13,
    marginLeft: 34,
    marginTop: 4,
    paddingVertical: 2,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: 34,
    marginTop: 4,
  },
  optionText: {
    flex: 1,
    color: Palette.textSecondary,
    fontSize: 13,
  },
  optionRemove: {
    color: Palette.textMuted,
    fontSize: 12,
    paddingHorizontal: 8,
  },
  variantRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginLeft: 34,
    marginTop: 8,
  },
  variantLabel: {
    color: Palette.textSecondary,
    fontSize: 13,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginLeft: 34,
    marginTop: 8,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: Palette.elevated,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tagOn: {
    backgroundColor: Palette.borderStrong,
  },
  tagDietary: {
    borderColor: Palette.accent,
  },
  tagText: {
    color: Palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  tagTextOn: {
    color: Palette.text,
  },
  morePages: {
    color: Palette.textSecondary,
    fontSize: 14,
    marginTop: 24,
    marginBottom: 10,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  saveButton: {
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingVertical: 16,
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
