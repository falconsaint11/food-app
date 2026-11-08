import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { StarRatingInput } from "@/components/star-rating-input";
import { Palette } from "@/constants/theme";
import { guessDishTags, Tag } from "@/lib/tags";

export type DishResult = {
  id: string;

  name: string;

  restaurant_id: string;

  name_key?: string;

  // Set on variants: the name_key of the dish it's a version of.
  variant_of?: string | null;

  variant_label?: string | null;

  // The dish has variants or add-on options, so ask "Which one?".
  has_choices?: boolean;
};

// One dish in a visit being logged.
export type DishEntry = {
  key: string;

  name: string;

  // The existing dish picked from suggestions (possibly at another location
  // of the brand), or null to match/create by name when saving.
  matchedDish: DishResult | null;

  // The picked dish when it has variants, so the "Which one?" row stays up
  // after choosing one.
  variantParent: DishResult | null;

  // A flavor or type typed in with "+ New" ("Steak" of Quesadilla), created
  // on save. For a dish not on the menu yet, `of` is null and parentName is
  // the dish, which is added first.
  newVariant: { of: string | null; label: string; parentName?: string } | null;

  rating: number;

  notes: string;

  photoUri: string | null;

  tags: string[];

  // Once the user taps a tag, stop replacing their choice with name guesses.
  tagsTouched: boolean;
};

export function createDishEntry(name = ""): DishEntry {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    matchedDish: null,
    variantParent: null,
    newVariant: null,
    rating: 0,
    notes: "",
    photoUri: null,
    tags: [],
    tagsTouched: false,
  };
}

type LogDishCardProps = {
  entry: DishEntry;

  allTags: Tag[];

  // Brand-wide fuzzy menu search; empty until a restaurant is picked.
  onSearch: (text: string) => Promise<DishResult[]>;

  // The dish's variants on this restaurant's menu.
  onLoadVariants: (parent: DishResult) => Promise<DishResult[]>;

  onChange: (patch: Partial<DishEntry>) => void;

  // Omitted for the only card, which can't be removed.
  onRemove?: () => void;

  disabled: boolean;
};

export function LogDishCard({
  entry,
  allTags,
  onSearch,
  onLoadVariants,
  onChange,
  onRemove,
  disabled,
}: LogDishCardProps) {
  const [results, setResults] = useState<DishResult[]>([]);

  // Bumped by each search and pick, so a slow, older search can't replace
  // newer suggestions.
  const searchVersion = useRef(0);

  const [variants, setVariants] = useState<DishResult[]>([]);

  // The "+ New" variant being typed, or null when the input is closed.
  const [variantDraft, setVariantDraft] = useState<string | null>(null);

  // A flavor being typed for a dish that isn't on the menu yet.
  const [newDishFlavor, setNewDishFlavor] = useState<string | null>(null);

  const [expanded, setExpanded] = useState(
    Boolean(entry.notes || entry.photoUri),
  );

  // Pre-select tags from the dish name ("Cheeseburger" -> Burger).
  useEffect(() => {
    const trimmed = entry.name.trim();

    if (trimmed.length < 2 || entry.tagsTouched) {
      return;
    }

    let cancelled = false;

    const timeout = setTimeout(async () => {
      const guesses = await guessDishTags(trimmed);

      if (!cancelled) onChange({ tags: guesses });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // onChange is recreated by the parent on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.name, entry.tagsTouched]);

  async function changeName(text: string) {
    onChange({
      name: text,
      matchedDish: null,
      variantParent: null,
      newVariant: null,
      // Clearing the dish starts tagging over.
      ...(text.trim().length < 2 ? { tags: [], tagsTouched: false } : {}),
    });

    setNewDishFlavor(null);

    const version = ++searchVersion.current;

    if (text.trim().length < 2) {
      setResults([]);
      return;
    }

    const found = await onSearch(text.trim());
    if (version === searchVersion.current) setResults(found);
  }

  async function pickSuggestion(dish: DishResult) {
    searchVersion.current++;
    Keyboard.dismiss();
    onChange({
      name: dish.name,
      matchedDish: dish,
      variantParent: dish.has_choices ? dish : null,
      newVariant: null,
    });
    setResults([]);
    setVariants([]);
    setVariantDraft(null);

    if (dish.has_choices) {
      setVariants(await onLoadVariants(dish));
    }
  }

  function pickVariant(variant: DishResult | null) {
    const parent = entry.variantParent;
    if (!parent) return;

    const dish = variant ?? parent;
    onChange({ name: dish.name, matchedDish: dish, newVariant: null });
    setVariantDraft(null);
  }

  function startFirstVariant() {
    if (!entry.matchedDish) return;

    onChange({ variantParent: entry.matchedDish });
    setVariants([]);
    setVariantDraft("");
  }

  function addVariant() {
    const parent = entry.variantParent;
    const label = variantDraft?.trim();
    if (!parent?.name_key || !label) return;

    onChange({
      name: `${label} ${parent.name}`,
      matchedDish: null,
      newVariant: { of: parent.name_key, label },
    });
    setVariantDraft(null);
  }

  function addNewDishFlavor() {
    const dishName = entry.name.trim();
    const label = newDishFlavor?.trim();
    if (!dishName || !label) return;

    onChange({
      name: `${label} ${dishName}`,
      matchedDish: null,
      newVariant: { of: null, label, parentName: dishName },
    });
    setResults([]);
    setNewDishFlavor(null);
  }

  function removeNewDishFlavor() {
    if (!entry.newVariant?.parentName) return;

    onChange({ name: entry.newVariant.parentName, newVariant: null });
  }

  function toggleTag(slug: string) {
    onChange({
      tagsTouched: true,
      tags: entry.tags.includes(slug)
        ? entry.tags.filter((tag) => tag !== slug)
        : [...entry.tags, slug],
    });
  }

  // Camera or library, whichever they want.
  function pickPhoto() {
    Alert.alert("Add a photo", undefined, [
      { text: "Take photo", onPress: () => choosePhoto("camera") },
      { text: "Choose from library", onPress: () => choosePhoto("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function choosePhoto(source: "camera" | "library") {
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        source === "camera"
          ? "Camera permission needed"
          : "Photo permission needed",
        source === "camera"
          ? "Allow camera access to take a photo for your review."
          : "Allow photo access to add a photo to your review.",
      );

      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (!result.canceled) {
      onChange({ photoUri: result.assets[0].uri });
    }
  }

  const detailCount =
    (entry.notes.trim() ? 1 : 0) +
    (entry.photoUri ? 1 : 0) +
    (entry.tags.length > 0 ? 1 : 0);

  return (
    <View style={styles.card}>
      <View style={styles.nameRow}>
        <TextInput
          style={styles.nameInput}
          placeholder="What did you eat?"
          placeholderTextColor={Palette.textMuted}
          value={entry.name}
          onChangeText={changeName}
          editable={!disabled}
        />

        {onRemove ? (
          <TouchableOpacity
            style={styles.removeButton}
            onPress={onRemove}
            disabled={disabled}
            accessibilityLabel="Remove dish"
          >
            <Text style={styles.removeText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {results.length > 0 && !entry.matchedDish ? (
        <View style={styles.results}>
          {results.map((dish) => (
            <TouchableOpacity
              key={dish.id}
              style={styles.resultItem}
              onPress={() => pickSuggestion(dish)}
            >
              <Text style={styles.resultName}>{dish.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* A dish that's new to the menu can get a flavor right away too. */}
      {entry.newVariant?.parentName ? (
        <View style={styles.onMenuRow}>
          <Text style={styles.onMenuText}>
            New: {entry.newVariant.label} {entry.newVariant.parentName}
          </Text>

          <TouchableOpacity onPress={removeNewDishFlavor} disabled={disabled}>
            <Text style={styles.onMenuText}>Remove flavor</Text>
          </TouchableOpacity>
        </View>
      ) : !entry.matchedDish &&
        !entry.variantParent &&
        entry.name.trim().length >= 2 ? (
        newDishFlavor === null ? (
          <TouchableOpacity
            onPress={() => setNewDishFlavor("")}
            disabled={disabled}
          >
            <Text style={styles.onMenuText}>+ Add a flavor or type</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.variantInputRow}>
            <TextInput
              style={styles.variantInput}
              placeholder={`Which ${entry.name.trim()}? Like Pistachio`}
              placeholderTextColor={Palette.textMuted}
              value={newDishFlavor}
              onChangeText={setNewDishFlavor}
              onSubmitEditing={addNewDishFlavor}
              maxLength={40}
              autoFocus
            />

            <TouchableOpacity onPress={addNewDishFlavor}>
              <Text style={styles.variantAddText}>Add</Text>
            </TouchableOpacity>
          </View>
        )
      ) : null}

      {entry.matchedDish && !entry.variantParent ? (
        <View style={styles.onMenuRow}>
          <Text style={styles.onMenuText}>✓ On the menu</Text>

          {/* Any dish can get a flavor or type ("Pistachio" Gelato), not
              just ones that already have some. */}
          {!entry.matchedDish.variant_of && entry.matchedDish.name_key ? (
            <TouchableOpacity onPress={startFirstVariant} disabled={disabled}>
              <Text style={styles.onMenuText}>+ Add a flavor or type</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {entry.variantParent ? (
        <View style={styles.variantBox}>
          <Text style={styles.variantPrompt}>Which flavor or type?</Text>

          <View style={styles.tagChips}>
            {[null, ...variants].map((variant) => {
              const selected =
                !entry.newVariant &&
                entry.matchedDish?.name_key ===
                  (variant ?? entry.variantParent)?.name_key;

              return (
                <TouchableOpacity
                  key={variant?.id ?? "plain"}
                  style={[styles.tagChip, selected && styles.tagChipSelected]}
                  onPress={() => pickVariant(variant)}
                  disabled={disabled}
                >
                  <Text
                    style={[
                      styles.tagChipText,
                      selected && styles.tagChipTextSelected,
                    ]}
                  >
                    {variant ? (variant.variant_label ?? variant.name) : "Plain"}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {entry.newVariant ? (
              <View style={[styles.tagChip, styles.tagChipSelected]}>
                <Text style={[styles.tagChipText, styles.tagChipTextSelected]}>
                  {entry.newVariant.label}
                </Text>
              </View>
            ) : null}

            {variantDraft === null ? (
              <TouchableOpacity
                style={styles.tagChip}
                onPress={() => setVariantDraft("")}
                disabled={disabled}
              >
                <Text style={styles.tagChipText}>+ New</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {variantDraft !== null ? (
            <View style={styles.variantInputRow}>
              <TextInput
                style={styles.variantInput}
                placeholder="Like Pistachio or Steak"
                placeholderTextColor={Palette.textMuted}
                value={variantDraft}
                onChangeText={setVariantDraft}
                onSubmitEditing={addVariant}
                maxLength={40}
                autoFocus
              />

              <TouchableOpacity onPress={addVariant}>
                <Text style={styles.variantAddText}>Add</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      <StarRatingInput
        value={entry.rating}
        onChange={(rating) => onChange({ rating })}
        compact
      />

      <TouchableOpacity onPress={() => setExpanded((open) => !open)}>
        <Text style={styles.detailsToggle}>
          {expanded
            ? "− Hide details"
            : detailCount > 0
              ? `+ Notes, photo, tags (${detailCount} added)`
              : "+ Notes, photo, tags"}
        </Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.details}>
          <TextInput
            style={styles.notesInput}
            placeholder="What did you think?"
            placeholderTextColor={Palette.textMuted}
            multiline
            value={entry.notes}
            onChangeText={(notes) => onChange({ notes })}
            editable={!disabled}
          />

          {entry.photoUri ? (
            <View>
              <Image
                source={{ uri: entry.photoUri }}
                style={styles.photoPreview}
              />

              <View style={styles.photoActions}>
                <TouchableOpacity onPress={pickPhoto}>
                  <Text style={styles.photoActionText}>Change photo</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => onChange({ photoUri: null })}>
                  <Text style={styles.removePhotoText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.addPhotoButton} onPress={pickPhoto}>
              <Text style={styles.addPhotoText}>+ Add photo</Text>
            </TouchableOpacity>
          )}

          {allTags.length > 0 ? (
            <View style={styles.tagChips}>
              {allTags.map((tag) => {
                const selected = entry.tags.includes(tag.slug);

                return (
                  <TouchableOpacity
                    key={tag.slug}
                    style={[styles.tagChip, selected && styles.tagChipSelected]}
                    onPress={() => toggleTag(tag.slug)}
                  >
                    <Text
                      style={[
                        styles.tagChipText,
                        selected && styles.tagChipTextSelected,
                      ]}
                    >
                      {tag.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  variantBox: {
    marginBottom: 10,
  },

  variantPrompt: {
    fontSize: 14,

    fontWeight: "600",

    color: Palette.textSecondary,

    marginBottom: 6,
  },

  variantInputRow: {
    flexDirection: "row",

    alignItems: "center",

    gap: 12,

    marginTop: 8,
  },

  variantInput: {
    flex: 1,

    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    paddingHorizontal: 12,

    paddingVertical: 8,

    fontSize: 15,

    color: Palette.text,
  },

  variantAddText: {
    fontSize: 15,

    fontWeight: "600",

    color: Palette.accent,
  },

  card: {
    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 14,

    padding: 14,

    marginBottom: 12,

    backgroundColor: Palette.surface,
  },

  nameRow: {
    flexDirection: "row",

    alignItems: "center",

    marginBottom: 6,
  },

  nameInput: {
    flex: 1,

    fontSize: 17,

    fontWeight: "600",

    color: Palette.text,

    paddingVertical: 6,
  },

  removeButton: {
    paddingLeft: 12,

    paddingVertical: 6,
  },

  removeText: {
    fontSize: 16,

    color: Palette.textMuted,
  },

  results: {
    borderWidth: 1,

    borderColor: Palette.border,

    borderRadius: 10,

    marginBottom: 8,

    overflow: "hidden",
  },

  resultItem: {
    paddingHorizontal: 12,

    paddingVertical: 10,

    borderBottomWidth: 1,

    borderBottomColor: Palette.border,
  },

  resultName: {
    fontSize: 15,

    color: Palette.text,
  },

  onMenuRow: {
    flexDirection: "row",

    justifyContent: "space-between",

    alignItems: "center",
  },

  onMenuText: {
    fontSize: 12,

    fontWeight: "600",

    color: Palette.accent,

    marginBottom: 4,
  },

  detailsToggle: {
    fontSize: 14,

    fontWeight: "600",

    color: Palette.textSecondary,
  },

  details: {
    marginTop: 12,

    gap: 12,
  },

  notesInput: {
    borderWidth: 1,

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    padding: 12,

    minHeight: 80,

    fontSize: 15,

    color: Palette.text,

    textAlignVertical: "top",
  },

  photoPreview: {
    width: "100%",

    height: 180,

    borderRadius: 10,
  },

  photoActions: {
    flexDirection: "row",

    justifyContent: "space-between",

    marginTop: 8,
  },

  photoActionText: {
    fontSize: 14,

    fontWeight: "600",

    color: Palette.text,
  },

  removePhotoText: {
    fontSize: 14,

    fontWeight: "600",

    color: Palette.danger,
  },

  addPhotoButton: {
    borderWidth: 1,

    borderStyle: "dashed",

    borderColor: Palette.borderStrong,

    borderRadius: 10,

    paddingVertical: 12,

    alignItems: "center",
  },

  addPhotoText: {
    fontSize: 14,

    fontWeight: "600",

    color: Palette.textSecondary,
  },

  tagChips: {
    flexDirection: "row",

    flexWrap: "wrap",

    gap: 8,
  },

  tagChip: {
    paddingHorizontal: 12,

    paddingVertical: 7,

    borderRadius: 16,

    borderWidth: 1,

    borderColor: Palette.borderStrong,
  },

  tagChipSelected: {
    backgroundColor: Palette.accent,

    borderColor: Palette.accent,
  },

  tagChipText: {
    fontSize: 13,

    fontWeight: "600",

    color: Palette.textSecondary,
  },

  tagChipTextSelected: {
    color: Palette.text,
  },
});
