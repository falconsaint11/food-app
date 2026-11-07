import type * as ImageManipulatorModule from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import {
  router,
  Stack,
  useLocalSearchParams,
  usePreventRemove,
} from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { useIsCurator } from '@/lib/admin';
import { uploadPhoto } from '@/lib/photos';
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

// A menu page ready to send: shrunk to a JPEG the menu reader accepts.
type MenuPage = { uri: string; base64: string };

// Longest side of a page sent to the menu reader. Big enough for small menu
// text, small enough to stay well under the reader's 5 MB limit even for
// full-resolution screenshots.
const PAGE_MAX_SIDE = 2000;

async function preparePage(asset: ImagePicker.ImagePickerAsset): Promise<MenuPage> {
  // Loaded here rather than at the top, so its native module starts only
  // when a menu is scanned, not when the app opens.
  const { ImageManipulator, SaveFormat } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-image-manipulator') as typeof ImageManipulatorModule;
  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);

  if (longest > PAGE_MAX_SIDE) {
    context.resize(
      asset.width >= asset.height
        ? { width: PAGE_MAX_SIDE, height: null }
        : { width: null, height: PAGE_MAX_SIDE }
    );
  }

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.7,
    base64: true,
  });

  return { uri: result.uri, base64: result.base64 ?? '' };
}

// Most menu pages read in one go.
const MAX_PAGES = 10;

type ReviewItem = ScannedDish & {
  key: string;
  selected: boolean;
  // For dishes already on the menu: overwrite their price, description and
  // options with the scanned ones.
  update: boolean;
};

// The dish already on this location's menu under a scanned name.
type ExistingDish = {
  price: number | null;
  description: string | null;
  options: string[];
};

// What a scan would change on a dish that's already on the menu. Blank
// scanned fields never clear anything.
function scanChanges(item: ReviewItem, existing: ExistingDish) {
  const changes: string[] = [];
  const price = item.price.replace(/[^0-9.]/g, '');
  const description = item.description.trim();

  if (price && Number(price) !== Number(existing.price ?? NaN)) {
    changes.push(
      `Price ${existing.price !== null ? `$${existing.price}` : 'none'} → $${price}`
    );
  }

  if (description && description !== (existing.description ?? '')) {
    changes.push(existing.description ? 'New description' : 'Adds a description');
  }

  if (
    item.options.length > 0 &&
    item.options.join('\n') !== existing.options.join('\n')
  ) {
    changes.push(existing.options.length > 0 ? 'New options' : 'Adds options');
  }

  return changes;
}

// Photograph a restaurant's menu, let Claude read the dishes (the menu-scan
// edge function), review them, then add them to this location with
// import_menu_dishes(). Curators can do this anytime; anyone can while the
// menu has under 10 dishes. Dishes already on the menu get any new tags and
// keep their details, unless a curator chooses to update them from the scan.
export default function MenuImportScreen() {
  const { restaurantId, restaurantName } = useLocalSearchParams<{
    restaurantId: string;
    restaurantName: string;
  }>();
  const isCurator = useIsCurator();
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  // Photos taken or chosen but not read yet; they're scanned together.
  const [pages, setPages] = useState<MenuPage[]>([]);
  // Pages read successfully, added to the restaurant's photos on save.
  const [scannedPages, setScannedPages] = useState<MenuPage[]>([]);
  // True from opening the camera or library until the photos are ready;
  // the library can take a few seconds to hand over several photos.
  const [preparing, setPreparing] = useState(false);
  const [saved, setSaved] = useState(false);
  // Set when the screen closes, so a scan still running stops quietly.
  const closed = useRef(false);

  useEffect(
    () => () => {
      closed.current = true;
    },
    []
  );

  // Leaving mid-scan, or with dishes not saved yet, asks first.
  usePreventRemove(
    progress !== null ||
      saving ||
      (!saved && (items.length > 0 || pages.length > 0)),
    ({ repeat }) => {
      Alert.alert(
        progress !== null ? 'Stop reading the menu?' : 'Leave without saving?',
        progress !== null
          ? 'The scan will stop and nothing will be added.'
          : 'The dishes from this menu won’t be added.',
        [
          { text: 'Stay', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: repeat },
        ]
      );
    }
  );
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [existing, setExisting] = useState<Map<string, ExistingDish>>(
    new Map()
  );

  useEffect(() => {
    fetchTags()
      .then(setAllTags)
      .catch((error) => console.log('Tags error:', error));
  }, []);

  // Which scanned names are already on this location's menu. Rechecked
  // when names change (after a scan or an edit), a moment after typing.
  const itemNames = items.map((item) => item.name.trim()).join('\n');

  useEffect(() => {
    if (!restaurantId || !itemNames) return;

    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('menu_import_matches', {
        p_restaurant_id: restaurantId,
        p_names: itemNames.split('\n'),
      });

      if (error) {
        console.log('Menu match error:', error.message);
        return;
      }

      setExisting(
        new Map(
          (data ?? []).map(
            (row: ExistingDish & { name: string }) =>
              [
                row.name,
                {
                  price: row.price === null ? null : Number(row.price),
                  description: row.description,
                  options: row.options ?? [],
                },
              ] as const
          )
        )
      );
    }, 400);

    return () => clearTimeout(timer);
  }, [restaurantId, itemNames]);

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access to scan a menu.');
      return;
    }

    setPreparing(true);

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (!result.canceled) await addPages(result.assets);
    } finally {
      setPreparing(false);
    }
  }

  async function choosePhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Photo permission needed', 'Allow photo access to scan a menu.');
      return;
    }

    setPreparing(true);

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(MAX_PAGES - pages.length, 1),
        quality: 0.8,
      });

      if (!result.canceled) await addPages(result.assets);
    } finally {
      setPreparing(false);
    }
  }

  async function addPages(assets: ImagePicker.ImagePickerAsset[]) {
    const ready: MenuPage[] = [];
    let failed = 0;

    for (const asset of assets) {
      try {
        ready.push(await preparePage(asset));
      } catch (error) {
        console.log('Menu page error:', error);
        failed++;
      }
    }

    if (closed.current) return;

    setPages((current) => [...current, ...ready].slice(0, MAX_PAGES));

    if (failed > 0) {
      Alert.alert(
        'Some photos couldn’t be used',
        `${failed} ${failed === 1 ? 'photo' : 'photos'} couldn’t be opened. Try taking ${failed === 1 ? 'it' : 'them'} again.`
      );
    }
  }

  // Sends each photo to the menu reader one at a time and merges the
  // results, so a dish on two photos appears once.
  async function scan(assets: MenuPage[]) {
    setPages([]);
    setProgress({ done: 0, total: assets.length });
    const failures: string[] = [];
    const found: ScannedDish[] = [];
    const read: MenuPage[] = [];

    for (const [index, asset] of assets.entries()) {
      if (!asset.base64) {
        failures.push(`Photo ${index + 1}: couldn't be read from the device.`);
        continue;
      }

      const { data, error } = await supabase.functions.invoke('menu-scan', {
        body: {
          image: asset.base64,
          mediaType: 'image/jpeg',
          restaurantId,
        },
      });

      if (closed.current) return;

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
        read.push(asset);
      }

      setProgress({ done: index + 1, total: assets.length });
    }

    setItems((current) => mergeDishes(current, found));
    setScannedPages((current) => [...current, ...read]);
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
          update: false,
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
        update: item.update,
      })),
    });

    if (error) {
      setSaving(false);
      Alert.alert('Error', error.message);
      return;
    }

    await addMenuPhotos();
    setSaving(false);
    setSaved(true);

    const result = (
      data as { added: number; matched: number; updated: number }[]
    )[0];
    const kept = result.matched - result.updated;

    Alert.alert(
      'Menu saved',
      `Added ${result.added} new ${result.added === 1 ? 'dish' : 'dishes'}.` +
        (result.updated > 0
          ? ` Updated ${result.updated} from the scan.`
          : '') +
        (kept > 0
          ? ` ${kept} ${kept === 1 ? 'was' : 'were'} already on the menu and got any new tags.`
          : ''),
      [{ text: 'OK', onPress: () => router.back() }]
    );
  }

  const tagLabels = new Map(allTags.map((tag) => [tag.slug, tag]));

  function renderExisting(item: ReviewItem) {
    const match = existing.get(item.name.trim());
    if (!match) return null;

    const changes = scanChanges(item, match);

    // Only curators can overwrite details on dishes already on the menu.
    if (changes.length === 0 || !isCurator) {
      return (
        <Text style={styles.existingNote}>
          {changes.length === 0
            ? 'Already on the menu. Nothing new from the scan.'
            : 'Already on the menu.'}
        </Text>
      );
    }

    return (
      <TouchableOpacity
        style={[styles.existingBox, item.update && styles.existingBoxOn]}
        onPress={() => updateItem(item.key, { update: !item.update })}
      >
        <View style={[styles.smallCheckbox, item.update && styles.checkboxOn]}>
          {item.update ? <Text style={styles.smallCheckmark}>✓</Text> : null}
        </View>
        <View style={styles.existingText}>
          <Text style={styles.existingTitle}>
            Already on the menu. Update it from the scan?
          </Text>
          <Text style={styles.existingChanges}>{changes.join(' · ')}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // The scanned menu pages go in the restaurant's photos, marked as the
  // menu. Best effort: the dishes are already saved if this fails.
  async function addMenuPhotos() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !restaurantId) return;

      for (const page of scannedPages) {
        const photoPath = await uploadPhoto(page.uri, user.id);
        const { error } = await supabase.from('restaurant_photos').insert({
          restaurant_id: restaurantId,
          photo_path: photoPath,
          kind: 'menu',
        });

        if (error) {
          await supabase.storage.from('review-photos').remove([photoPath]);
          throw new Error(error.message);
        }
      }
    } catch (error) {
      console.log('Menu photos error:', error);
    }
  }

  // Pages waiting to be read, then buttons to add more and to scan them.
  function renderPhotoButtons() {
    return (
      <View>
        {pages.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pageRow}
          >
            {pages.map((page, index) => (
              <View key={page.uri}>
                <Image source={{ uri: page.uri }} style={styles.pageThumb} />
                <TouchableOpacity
                  style={styles.pageRemove}
                  onPress={() =>
                    setPages((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <Text style={styles.pageRemoveText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {preparing ? (
          <View style={styles.progress}>
            <ActivityIndicator color={Palette.accent} />
            <Text style={styles.progressText}>Preparing photos…</Text>
          </View>
        ) : null}

        <View style={[styles.photoButtons, preparing && styles.buttonsBusy]}>
          <TouchableOpacity
            style={styles.photoButton}
            onPress={takePhoto}
            disabled={preparing || pages.length >= MAX_PAGES}
          >
            <Text style={styles.photoButtonText}>
              {pages.length > 0 ? 'Take another' : 'Take a photo'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.photoButton}
            onPress={choosePhotos}
            disabled={preparing || pages.length >= MAX_PAGES}
          >
            <Text style={styles.photoButtonText}>Choose photos</Text>
          </TouchableOpacity>
        </View>

        {pages.length > 0 && !preparing ? (
          <TouchableOpacity style={styles.scanButton} onPress={() => scan(pages)}>
            <Text style={styles.scanButtonText}>
              Scan {pages.length} {pages.length === 1 ? 'page' : 'pages'}
            </Text>
          </TouchableOpacity>
        ) : null}
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

        {progress ? (
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
              Photograph every page of the menu, close enough that the text is
              sharp, then tap Scan. You&apos;ll review every dish before anything is saved
              {isCurator
                ? ', and choose whether dishes already on the menu get updated.'
                : '.'}
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

                {renderExisting(item)}

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
                ? 'Saving…'
                : `Save ${selectedItems.length} ${selectedItems.length === 1 ? 'dish' : 'dishes'}`}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  existingNote: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 6,
  },
  existingBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
  },
  existingBoxOn: {
    borderColor: Palette.accent,
  },
  smallCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  smallCheckmark: {
    color: Palette.text,
    fontSize: 12,
    fontWeight: '800',
  },
  existingText: {
    flex: 1,
  },
  existingTitle: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '600',
  },
  existingChanges: {
    color: Palette.textSecondary,
    fontSize: 13,
    marginTop: 3,
  },
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
  pageRow: {
    gap: 10,
    paddingTop: 6,
    paddingBottom: 14,
  },
  pageThumb: {
    width: 84,
    height: 112,
    borderRadius: 10,
    backgroundColor: Palette.surface,
  },
  pageRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Palette.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageRemoveText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  scanButton: {
    marginTop: 12,
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  scanButtonText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  buttonsBusy: {
    opacity: 0.4,
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
