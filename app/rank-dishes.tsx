import { PickOption, TopPicksEditor } from '@/components/top-picks-editor';
import { supabase } from '@/lib/supabase';

type DishRow = {
  id: string;
  name: string;
  restaurants: { name: string } | null;
};

function toOption(dish: DishRow): PickOption {
  return {
    key: dish.id,
    saveId: dish.id,
    name: dish.name,
    subtitle: dish.restaurants?.name ?? null,
  };
}

// Every dish the user reviewed, plus their saved top 4 (which could include
// a dish whose review was since deleted).
async function loadDishOptions(userId: string) {
  const [reviewsResult, rankingsResult] = await Promise.all([
    supabase
      .from('reviews')
      .select(`
        dishes (
          id,
          name,
          restaurants (
            name
          )
        )
      `)
      .eq('user_id', userId),
    supabase
      .from('dish_rankings')
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

  if (reviewsResult.error) throw new Error(reviewsResult.error.message);
  if (rankingsResult.error) throw new Error(rankingsResult.error.message);

  const options = new Map<string, PickOption>();
  const selectedKeys: string[] = [];

  for (const row of reviewsResult.data ?? []) {
    const dish = row.dishes as unknown as DishRow | null;
    if (dish) options.set(dish.id, toOption(dish));
  }

  for (const row of rankingsResult.data ?? []) {
    const dish = row.dishes as unknown as DishRow | null;
    if (!dish) continue;

    options.set(dish.id, toOption(dish));
    selectedKeys.push(dish.id);
  }

  return { options: Array.from(options.values()), selectedKeys };
}

export default function RankDishesScreen() {
  return (
    <TopPicksEditor
      noun="dishes"
      rankingTable="dish_rankings"
      idColumn="dish_id"
      loadOptions={loadDishOptions}
    />
  );
}
