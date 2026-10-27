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
import { getBrandLocationIds } from '@/lib/brands';
import { supabase } from '@/lib/supabase';

type MenuDish = {
  name: string;
  nameKey: string;
};

// Admin tool: fix a dish's name, price, description and options, make it a
// variant of another dish, or mark it discontinued. Everything but price
// applies at every location of the brand (see admin_update_dish()).
export default function DishEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

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

  useEffect(() => {
    if (!id) return;

    (async () => {
      const { data: dish, error } = await supabase
        .from('dishes')
        .select(
          'name, name_key, price, description, options, variant_of, variant_label, discontinued_at, restaurants (id, brand_id)'
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
        const locationIds = await getBrandLocationIds(
          restaurant.id,
          restaurant.brand_id
        );

        const { data: menuData } = await supabase
          .from('dishes')
          .select('name, name_key, variant_of')
          .in('restaurant_id', locationIds);

        // Dishes this one could be a version of: not itself, and not
        // variants (variants don't nest).
        const byKey = new Map<string, MenuDish>();
        for (const row of menuData ?? []) {
          if (row.name_key === dish.name_key || row.variant_of) continue;
          byKey.set(row.name_key, { name: row.name, nameKey: row.name_key });
        }

        setMenu(
          [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
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
          dish.name.toLowerCase().includes(parentSearch.trim().toLowerCase())
        )
        .slice(0, 6)
    : [];

  function chooseParent(dish: MenuDish) {
    setVariantOf(dish.nameKey);
    setParentSearch('');

    // "Steak Quesadilla" under "Quesadilla" -> "Steak".
    if (!variantLabel.trim()) {
      const guess = name
        .replace(new RegExp(dish.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '')
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

  async function save() {
    const cleanPrice = price.replace(/[^0-9.]/g, '');

    if (cleanPrice && !/^\d{1,5}(\.\d{1,2})?$/.test(cleanPrice)) {
      Alert.alert('Check the price', 'Use a number like 8 or 8.50.');
      return;
    }

    if (variantOf && !variantLabel.trim()) {
      Alert.alert('Name the variant', 'Like Steak or Mango.');
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
            onPress={() => setOptions(options.filter((other) => other !== option))}
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

        <Text style={styles.label}>Variant</Text>
        {variantOf ? (
          <>
            <View style={styles.optionRow}>
              <Text style={styles.optionText}>
                A version of {parent?.name ?? variantOf}
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
              placeholder="Shown under it, like Steak"
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
              placeholder="Make it a version of… (search the menu)"
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

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>Discontinued</Text>
            <Text style={styles.switchHint}>
              Hidden from the menu and Log suggestions. Reviews stay, labeled
              Discontinued. Its variants follow.
            </Text>
          </View>
          <Switch
            value={discontinued}
            onValueChange={setDiscontinued}
            trackColor={{ true: Palette.accent }}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, (saving || !name.trim()) && styles.disabled]}
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
