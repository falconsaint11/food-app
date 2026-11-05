import type { PickOption } from '@/components/top-picks-editor';
import { fetchLatestDishScores } from '@/lib/ratings';
import { supabase } from '@/lib/supabase';

type DishRow = {
  id: string;
  name: string;
  restaurants: { name: string } | null;
};

// Every dish (or drink) the user reviewed with their latest rating, plus
// their saved top 4 from that ranking table (which could include one whose
// review was since deleted). Drinks are dishes tagged as one.
export async function loadDishPickOptions(
  userId: string,
  kind: 'dishes' | 'drinks'
) {
  const rankingTable = kind === 'drinks' ? 'drink_rankings' : 'dish_rankings';

  const [scores, rankingsResult] = await Promise.all([
    fetchLatestDishScores(userId),
    supabase
      .from(rankingTable)
      .select(`
        rank,
        dishes (
          id,
          name,
          restaurants (
            name
          )
        )
      `)
      .eq('user_id', userId)
      .order('rank', { ascending: true }),
  ]);

  if (rankingsResult.error) throw new Error(rankingsResult.error.message);

  const { data: drinkIds, error: drinkError } = await supabase.rpc(
    'drink_dish_ids',
    { p_dish_ids: scores.map((score) => score.id) }
  );

  if (drinkError) throw new Error(drinkError.message);

  const drinks = new Set((drinkIds ?? []) as string[]);
  const options = new Map<string, PickOption>();
  const selectedKeys: string[] = [];

  for (const score of scores) {
    if (drinks.has(score.id) !== (kind === 'drinks')) continue;

    options.set(score.id, {
      key: score.id,
      saveId: score.id,
      name: score.name,
      subtitle: score.subtitle,
      rating: score.rating,
    });
  }

  const ratingById = new Map(scores.map((score) => [score.id, score.rating]));

  for (const row of rankingsResult.data ?? []) {
    const dish = row.dishes as unknown as DishRow | null;
    if (!dish) continue;

    options.set(dish.id, {
      key: dish.id,
      saveId: dish.id,
      name: dish.name,
      subtitle: dish.restaurants?.name ?? null,
      rating: ratingById.get(dish.id) ?? null,
    });
    selectedKeys.push(dish.id);
  }

  return { options: Array.from(options.values()), selectedKeys };
}
