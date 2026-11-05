import { TopPicksEditor } from '@/components/top-picks-editor';
import { loadDishPickOptions } from '@/lib/dish-picks';

export default function RankDrinksScreen() {
  return (
    <TopPicksEditor
      noun="drinks"
      rankingTable="drink_rankings"
      idColumn="dish_id"
      loadOptions={(userId) => loadDishPickOptions(userId, 'drinks')}
    />
  );
}
