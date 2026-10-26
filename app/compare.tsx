import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
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
import {
  fetchIsPremium,
  fetchLatestDishScores,
  fetchLatestRestaurantScores,
  formatRating,
  ScoredItem,
  toStarLevel,
} from '@/lib/ratings';
import { supabase } from '@/lib/supabase';

type Kind = 'dish' | 'restaurant';

type Result = 'way_better' | 'little_better' | 'similar';

type Item = ScoredItem;

type LastResult = {
  winner: Item;
  loser: Item;
  winnerAfter: number;
  loserAfter: number;
  result: Result;
};

// Only items in the same star level and this close get compared.
const MAX_GAP = 0.1;

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// The closest pair the user hasn't compared yet, picked at random among
// equally close pairs and shown in random order.
function findPair(items: Item[], done: Set<string>): [Item, Item] | null {
  const sorted = [...items].sort((a, b) => a.rating - b.rating);
  let closest: [Item, Item][] = [];
  let closestGap = Infinity;

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const gap = Math.round((sorted[j].rating - sorted[i].rating) * 100);

      if (gap > MAX_GAP * 100) break;

      if (toStarLevel(sorted[i].rating) !== toStarLevel(sorted[j].rating)) {
        continue;
      }

      if (done.has(pairKey(sorted[i].id, sorted[j].id))) continue;

      if (gap < closestGap) {
        closest = [[sorted[i], sorted[j]]];
        closestGap = gap;
      } else if (gap === closestGap) {
        closest.push([sorted[i], sorted[j]]);
      }
    }
  }

  if (closest.length === 0) return null;

  const [a, b] = closest[Math.floor(Math.random() * closest.length)];
  return Math.random() < 0.5 ? [a, b] : [b, a];
}

export default function CompareScreen() {
  const [kind, setKind] = useState<Kind>('dish');
  const [items, setItems] = useState<Item[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pair, setPair] = useState<[Item, Item] | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftScore, setDraftScore] = useState('');

  async function loadItems(nextKind: Kind) {
    setLoading(true);
    setLastResult(null);
    setEditingId(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('No signed-in user found.');

      const [loadedItems, comparisonsResult, premium] = await Promise.all([
        nextKind === 'dish'
          ? fetchLatestDishScores(user.id)
          : fetchLatestRestaurantScores(user.id),
        supabase
          .from('rating_comparisons')
          .select('winner_id, loser_id')
          .eq('user_id', user.id)
          .eq('kind', nextKind),
        fetchIsPremium(),
      ]);

      if (comparisonsResult.error) {
        throw new Error(comparisonsResult.error.message);
      }

      const compared = new Set(
        (comparisonsResult.data ?? []).map((row) =>
          pairKey(row.winner_id, row.loser_id)
        )
      );

      setItems(loadedItems);
      setDone(compared);
      setPair(findPair(loadedItems, compared));
      setIsPremium(premium);
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Could not load your ratings.'
      );
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      loadItems(kind);
    }, [kind])
  );

  function showNextPair(nextItems: Item[], nextDone: Set<string>) {
    setItems(nextItems);
    setDone(nextDone);
    setPair(findPair(nextItems, nextDone));
    setEditingId(null);
  }

  async function choose(winner: Item, loser: Item, result: Result) {
    setSaving(true);

    const { data, error } = await supabase.rpc('compare_ratings', {
      p_kind: kind,
      p_winner_id: winner.id,
      p_loser_id: loser.id,
      p_result: result,
    });

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    const row = (data as { winner_after: number; loser_after: number }[])[0];
    const winnerAfter = Number(row.winner_after);
    const loserAfter = Number(row.loser_after);

    const nextItems = items.map((item) => {
      if (item.id === winner.id) return { ...item, rating: winnerAfter };
      if (item.id === loser.id) return { ...item, rating: loserAfter };
      return item;
    });

    setLastResult({ winner, loser, winnerAfter, loserAfter, result });
    showNextPair(nextItems, new Set(done).add(pairKey(winner.id, loser.id)));
  }

  function skip() {
    if (!pair) return;

    setLastResult(null);
    // Skipped pairs come back next time the screen opens.
    showNextPair(items, new Set(done).add(pairKey(pair[0].id, pair[1].id)));
  }

  function startEditing(item: Item) {
    setEditingId(item.id);
    setDraftScore(item.rating.toFixed(2));
  }

  async function saveScore(item: Item) {
    const score = Math.round(Number(draftScore) * 100) / 100;

    if (!Number.isFinite(score) || score < 0.5 || score > 5) {
      Alert.alert('Invalid score', 'Enter a score from 0.50 to 5.00.');
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from(kind === 'dish' ? 'reviews' : 'restaurant_ratings')
      .update({ rating: score })
      .eq('id', item.entryId);

    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, rating: score } : entry
      )
    );
    setPair((current) =>
      current
        ? (current.map((entry) =>
            entry.id === item.id ? { ...entry, rating: score } : entry
          ) as [Item, Item])
        : current
    );
    setEditingId(null);
  }

  function openItem(item: Item) {
    if (kind === 'dish') {
      router.push({ pathname: '/dish/[id]', params: { id: item.linkId } });
    } else {
      router.push({ pathname: '/restaurant/[id]', params: { id: item.linkId } });
    }
  }

  function renderScore(item: Item) {
    if (editingId === item.id) {
      return (
        <View style={styles.editRow}>
          <TextInput
            style={styles.scoreInput}
            value={draftScore}
            onChangeText={setDraftScore}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
            maxLength={4}
          />
          <TouchableOpacity onPress={() => saveScore(item)} disabled={saving}>
            <Text style={styles.editLink}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setEditingId(null)}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.scoreRow}>
        <Text style={styles.score}>
          {isPremium ? item.rating.toFixed(2) : formatRating(item.rating, false)}★
        </Text>
        {isPremium ? (
          <TouchableOpacity onPress={() => startEditing(item)}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  function renderLastResult() {
    if (!lastResult) return null;

    if (lastResult.result === 'similar') {
      return <Text style={styles.resultText}>Noted, too close to call.</Text>;
    }

    if (!isPremium) {
      return (
        <Text style={styles.resultText}>
          {lastResult.winner.name} moved ahead of {lastResult.loser.name}.
          {'\n'}
          <Text style={styles.premiumHint}>
            Premium shows your exact scores.
          </Text>
        </Text>
      );
    }

    return (
      <Text style={styles.resultText}>
        {lastResult.winner.name} {lastResult.winner.rating.toFixed(2)} →{' '}
        {lastResult.winnerAfter.toFixed(2)}
        {'\n'}
        {lastResult.loser.name} {lastResult.loser.rating.toFixed(2)} →{' '}
        {lastResult.loserAfter.toFixed(2)}
      </Text>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.toggle}>
        {(['dish', 'restaurant'] as Kind[]).map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.toggleButton, kind === option && styles.toggleSelected]}
            onPress={() => setKind(option)}
            disabled={loading || saving}
          >
            <Text
              style={[
                styles.toggleText,
                kind === option && styles.toggleTextSelected,
              ]}
            >
              {option === 'dish' ? 'Dishes' : 'Restaurants'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Palette.accent} />
        </View>
      ) : (
        <>
          {renderLastResult()}

          {pair ? (
            <>
              <Text style={styles.title}>Which was better?</Text>
              <Text style={styles.subtitle}>
                You rated these about the same.
              </Text>

              <View style={styles.pairRow}>
                {pair.map((item, index) => {
                  const other = pair[1 - index];

                  return (
                    <View key={item.id} style={styles.column}>
                      <View style={styles.card}>
                        <TouchableOpacity onPress={() => openItem(item)}>
                          <Text style={styles.itemName} numberOfLines={3}>
                            {item.name}
                          </Text>
                          {item.subtitle ? (
                            <Text style={styles.itemSubtitle} numberOfLines={2}>
                              {item.subtitle}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                        {renderScore(item)}
                      </View>

                      <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={() => choose(item, other, 'way_better')}
                        disabled={saving}
                      >
                        <Text style={styles.primaryButtonText}>Way better</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => choose(item, other, 'little_better')}
                        disabled={saving}
                      >
                        <Text style={styles.secondaryButtonText}>
                          A little better
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => choose(pair[0], pair[1], 'similar')}
                disabled={saving}
              >
                <Text style={styles.secondaryButtonText}>About the same</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.skipButton}
                onPress={skip}
                disabled={saving}
              >
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No close calls right now</Text>
              <Text style={styles.emptyText}>
                When you rate two {kind === 'dish' ? 'dishes' : 'restaurants'}{' '}
                about the same, they&apos;ll show up here.
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 40,
    backgroundColor: Palette.background,
  },
  centered: {
    paddingTop: 60,
    alignItems: 'center',
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: Palette.surface,
    borderRadius: 10,
    padding: 4,
    marginBottom: 24,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleSelected: {
    backgroundColor: Palette.elevated,
  },
  toggleText: {
    color: Palette.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  toggleTextSelected: {
    color: Palette.text,
  },
  resultText: {
    color: Palette.textBody,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  premiumHint: {
    color: Palette.textMuted,
    fontSize: 13,
  },
  title: {
    color: Palette.text,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: Palette.textSecondary,
    marginTop: 6,
    marginBottom: 24,
    textAlign: 'center',
  },
  pairRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  column: {
    flex: 1,
  },
  card: {
    minHeight: 150,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    backgroundColor: Palette.surface,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  itemName: {
    color: Palette.text,
    fontSize: 18,
    fontWeight: '700',
  },
  itemSubtitle: {
    color: Palette.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  score: {
    color: Palette.accent,
    fontSize: 22,
    fontWeight: '700',
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  scoreInput: {
    color: Palette.text,
    fontSize: 18,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 56,
  },
  editLink: {
    color: Palette.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  cancelLink: {
    color: Palette.textMuted,
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryButtonText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  secondaryButtonText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '600',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    color: Palette.textMuted,
    fontSize: 15,
  },
  emptyCard: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: Palette.surface,
  },
  emptyTitle: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: {
    color: Palette.textSecondary,
    fontSize: 15,
    lineHeight: 21,
  },
});
