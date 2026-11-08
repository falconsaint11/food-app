import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import { useIsAdmin } from '@/lib/admin';
import { getBrandLocationIds } from '@/lib/brands';
import { supabase } from '@/lib/supabase';
import { fetchDishPublicTags, fetchTags, Tag } from '@/lib/tags';

type MenuDish = {
  name: string;
  nameKey: string;
};

// Curator tool: fix a dish's name, price, description, options and tags, add
// flavors or types of it, or make it a flavor or type of another dish. Admins can also mark it discontinued.
// Everything but price applies at every location of the brand (see
// admin_update_dish() and set_dish_tag()).
export default function DishEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isAdmin = useIsAdmin();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nameKey, setNameKey] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [optionDraft, setOptionDraft] = useState('');
  const [variantOf, setVariantOf] = useState<string | null>(null);
  const [variantLabel, setVariantLabel] = useState('');
  const [parentSearch, setParentSearch] = useState('');
  const [discontinued, setDiscontinued] = useState(false);
  const [menu, setMenu] = useState<MenuDish[]>([]);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  // Flavors and types of this dish ("Pistachio" of Gelato).
  const [types, setTypes] = useState<MenuDish[]>([]);
  const [typeDraft, setTypeDraft] = useState('');
  const [addingType, setAddingType] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagSlugs, setTagSlugs] = useState<string[]>([]);
  const [savingTag, setSavingTag] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    (async () => {
      const { data: dish, error } = await supabase
        .from('dishes')
        .select(
          'name, name_key, price, description, options, variant_of, variant_label, discontinued_at, restaurants (id, brand_id)',
        )
        .eq('id', id)
        .maybeSingle();

      if (error || !dish) {
        Alert.alert('Error', error?.message ?? 'Dish not found.');
        router.back();
        return;
      }

      const restaurant = dish.restaurants as unknown as {
        id: string;
        brand_id: string | null;
      } | null;

      setNameKey(dish.name_key);
      setName(dish.name);
      setPrice(dish.price === null ? '' : String(dish.price));
      setDescription(dish.description ?? '');
      setOptions(dish.options ?? []);
      setVariantOf(dish.variant_of);
      setVariantLabel(dish.variant_label ?? '');
      setDiscontinued(dish.discontinued_at !== null);

      if (restaurant) {
        setRestaurantId(restaurant.id);

        const locationIds = await getBrandLocationIds(
          restaurant.id,
          restaurant.brand_id,
        );

        const { data: menuData } = await supabase
          .from('dishes')
          .select('id, name, name_key, variant_of, variant_label')
          .in('restaurant_id', locationIds)
          .is('discontinued_at', null);

        // Tags count across every location's row of this dish.
        const sameDishIds = (menuData ?? [])
          .filter((row) => row.name_key === dish.name_key)
          .map((row) => row.id as string);
        const [tags, dishTags] = await Promise.all([
          fetchTags(),
          fetchDishPublicTags(sameDishIds.length > 0 ? sameDishIds : [id]),
        ]);
        setAllTags(tags);
        setTagSlugs(dishTags.map((tag) => tag.slug));

        // Dishes this one could be a version of: not itself, and not
        // variants (variants don't nest).
        const byKey = new Map<string, MenuDish>();
        for (const row of menuData ?? []) {
          if (row.name_key === dish.name_key || row.variant_of) continue;
          byKey.set(row.name_key, { name: row.name, nameKey: row.name_key });
        }

        setMenu(
          [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
        );

        const typesByKey = new Map<string, MenuDish>();
        for (const row of menuData ?? []) {
          if (row.variant_of !== dish.name_key) continue;
          typesByKey.set(row.name_key, {
            name: row.variant_label ?? row.name,
            nameKey: row.name_key,
          });
        }

        setTypes(
          [...typesByKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }

      setLoading(false);
    })().catch((loadError) => {
      Alert.alert('Error', String(loadError));
      router.back();
    });
  }, [id]);

  const parent = menu.find((dish) => dish.nameKey === variantOf) ?? null;
  const parentMatches = parentSearch.trim()
    ? menu
        .filter((dish) =>
          dish.name.toLowerCase().includes(parentSearch.trim().toLowerCase()),
        )
        .slice(0, 6)
    : [];

  function chooseParent(dish: MenuDish) {
    setVariantOf(dish.nameKey);
    setParentSearch('');

    // "Steak Quesadilla" under "Quesadilla" -> "Steak".
    if (!variantLabel.trim()) {
      const guess = name
        .replace(
          new RegExp(dish.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          '',
        )
        .trim();
      setVariantLabel(guess || name);
    }
  }

  function addOption() {
    const option = optionDraft.trim();
    if (!option || options.includes(option)) return;

    setOptions([...options, option]);
    setOptionDraft('');
  }

  // A new flavor or type is its own dish ("Pistachio Gelato"), listed under
  // this one on the menu. Saved right away, like tags.
  async function addType() {
    const label = typeDraft.trim();
    if (!label || !restaurantId || !nameKey) return;

    setAddingType(true);

    const { data, error } = await supabase
      .from('dishes')
      .insert({
        restaurant_id: restaurantId,
        name: `${label} ${name.trim()}`,
        variant_of: nameKey,
        variant_label: label,
      })
      .select('name_key')
      .single();

    setAddingType(false);

    if (error || !data) {
      Alert.alert(
        'Error',
        error?.code === '23505'
          ? 'That one is already on the menu.'
          : (error?.message ?? 'Could not add it.'),
      );
      return;
    }

    setTypes((current) =>
      [...current, { name: label, nameKey: data.name_key as string }].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    );
    setTypeDraft('');
  }

  // Tag changes save right away, separately from the form.
  async function toggleTag(slug: string) {
    const on = !tagSlugs.includes(slug);
    setSavingTag(slug);

    const { error } = await supabase.rpc('set_dish_tag', {
      p_dish_id: id,
      p_tag: slug,
      p_on: on,
    });

    setSavingTag(null);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setTagSlugs((current) =>
      on ? [...current, slug] : current.filter((other) => other !== slug),
    );
  }

  async function save() {
    const cleanPrice = price.replace(/[^0-9.]/g, '');

    if (cleanPrice && !/^\d{1,5}(\.\d{1,2})?$/.test(cleanPrice)) {
      Alert.alert('Check the price', 'Use a number like 8 or 8.50.');
      return;
    }

    if (variantOf && !variantLabel.trim()) {
      Alert.alert('Name the flavor or type', 'Like Pistachio or Steak.');
      return;
    }

    setSaving(true);

    const { error } = await supabase.rpc('admin_update_dish', {
      p_dish_id: id,
      p_name: name,
      p_price: cleanPrice ? Number(cleanPrice) : null,
      p_description: description,
      p_options: options,
      p_variant_of: variantOf,
      p_variant_label: variantLabel,
      p_discontinued: discontinued,
    });

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    router.back();
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.note}>
          Changes apply at every location of this restaurant, except price.
        </Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={120}
        />

        <Text style={styles.label}>Price at this location</Text>
        <TextInput
          style={styles.input}
          value={price}
          onChangeText={setPrice}
          placeholder="$"
          placeholderTextColor={Palette.textMuted}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Ingredients, as printed on the menu"
          placeholderTextColor={Palette.textMuted}
          maxLength={300}
          multiline
        />

        <Text style={styles.label}>Options</Text>
        {options.map((option) => (
          <TouchableOpacity
            key={option}
            style={styles.optionRow}
            onPress={() =>
              setOptions(options.filter((other) => other !== option))
            }
          >
            <Text style={styles.optionText}>• {option}</Text>
            <Text style={styles.remove}>✕</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.addInput]}
            value={optionDraft}
            onChangeText={setOptionDraft}
            onSubmitEditing={addOption}
            placeholder="Like Add protein +$3"
            placeholderTextColor={Palette.textMuted}
            maxLength={80}
          />
          <TouchableOpacity onPress={addOption}>
            <Text style={styles.link}>Add</Text>
          </TouchableOpacity>
        </View>

        {!variantOf ? (
          <>
            <Text style={styles.label}>Flavors and types</Text>
            <Text style={styles.hint}>
              Each is rated on its own and listed under this dish on the menu.
              Saved as soon as you add it.
            </Text>
            {types.map((type) => (
              <Text
                key={type.nameKey}
                style={[styles.optionText, styles.typeRow]}
              >
                • {type.name}
              </Text>
            ))}
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, styles.addInput]}
                value={typeDraft}
                onChangeText={setTypeDraft}
                onSubmitEditing={addType}
                placeholder="Like Pistachio or Steak"
                placeholderTextColor={Palette.textMuted}
                maxLength={40}
                editable={!addingType}
              />
              <TouchableOpacity
                onPress={addType}
                disabled={addingType || !typeDraft.trim()}
              >
                <Text style={styles.link}>
                  {addingType ? 'Adding…' : 'Add'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {types.length === 0 ? (
          <Text style={styles.label}>Flavor or type of another dish</Text>
        ) : null}
        {types.length > 0 ? null : variantOf ? (
          <>
            <View style={styles.optionRow}>
              <Text style={styles.optionText}>
                A flavor or type of {parent?.name ?? variantOf}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setVariantOf(null);
                  setVariantLabel('');
                }}
              >
                <Text style={styles.link}>Remove</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={variantLabel}
              onChangeText={setVariantLabel}
              placeholder="Shown under it, like Pistachio"
              placeholderTextColor={Palette.textMuted}
              maxLength={40}
            />
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={parentSearch}
              onChangeText={setParentSearch}
              placeholder="Search the menu"
              placeholderTextColor={Palette.textMuted}
            />
            {parentMatches.map((dish) => (
              <TouchableOpacity
                key={dish.nameKey}
                style={styles.match}
                onPress={() => chooseParent(dish)}
              >
                <Text style={styles.optionText}>{dish.name}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        <Text style={styles.label}>Tags</Text>
        <Text style={styles.hint}>
          Saved as soon as you tap. Removing a tag also clears people’s votes
          for it.
        </Text>
        {(['food', 'dietary', 'availability'] as const).map((kind) => (
          <View key={kind} style={styles.tagGroup}>
            {allTags
              .filter((tag) => tag.kind === kind)
              .map((tag) => {
                const on = tagSlugs.includes(tag.slug);

                return (
                  <TouchableOpacity
                    key={tag.slug}
                    style={[styles.tagChip, on && styles.tagChipOn]}
                    onPress={() => toggleTag(tag.slug)}
                    disabled={savingTag !== null}
                  >
                    <Text style={[styles.tagText, on && styles.tagTextOn]}>
                      {savingTag === tag.slug ? '…' : tag.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </View>
        ))}

        {isAdmin ? (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>Discontinued</Text>
              <Text style={styles.switchHint}>
                Hidden from the menu and Log suggestions. Reviews stay, labeled
                Discontinued. Its flavors and types follow.
              </Text>
            </View>
            <Switch
              value={discontinued}
              onValueChange={setDiscontinued}
              trackColor={{ true: Palette.accent }}
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.saveButton,
            (saving || !name.trim()) && styles.disabled,
          ]}
          onPress={save}
          disabled={saving || !name.trim() || !nameKey}
        >
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.background,
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  note: {
    color: Palette.textMuted,
    fontSize: 13,
    marginBottom: 8,
  },
  label: {
    color: Palette.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 18,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: Palette.text,
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  optionText: {
    flex: 1,
    color: Palette.text,
    fontSize: 15,
  },
  remove: {
    color: Palette.textMuted,
    fontSize: 14,
    paddingHorizontal: 8,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addInput: {
    flex: 1,
  },
  typeRow: {
    paddingVertical: 6,
  },
  link: {
    color: Palette.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  match: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  hint: {
    color: Palette.textMuted,
    fontSize: 13,
    marginBottom: 4,
  },
  tagGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
  },
  tagChipOn: {
    backgroundColor: Palette.accent,
    borderColor: Palette.accent,
  },
  tagText: {
    color: Palette.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  tagTextOn: {
    color: Palette.text,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 28,
  },
  switchText: {
    flex: 1,
  },
  switchLabel: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  switchHint: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 3,
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
  disabled: {
    opacity: 0.5,
  },
  saveText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
