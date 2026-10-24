import { supabase } from '@/lib/supabase';

export type Tag = {
  slug: string;
  label: string;
};

// The tag list rarely changes, so load it once per app session.
let tagsPromise: Promise<Tag[]> | null = null;

export function fetchTags() {
  if (!tagsPromise) {
    tagsPromise = (async () => {
      const { data, error } = await supabase
        .from('tags')
        .select('slug, label')
        .order('sort_order');

      if (error) {
        tagsPromise = null;
        throw new Error(error.message);
      }

      return (data ?? []) as Tag[];
    })();
  }

  return tagsPromise;
}

// Tags suggested by a dish's name ("Bacon Cheeseburger" -> burger).
export async function guessDishTags(dishName: string) {
  const { data, error } = await supabase.rpc('guess_dish_tags', {
    p_name: dishName,
  });

  if (error) {
    console.log('Tag guess error:', error.message);
    return [];
  }

  return (data ?? []) as string[];
}

// Tags enough people agreed on, across all rows of a dish (see the
// dish_tag_vote_threshold() SQL function).
export async function fetchDishPublicTags(dishIds: string[]) {
  if (dishIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase.rpc('dish_public_tags', {
    p_dish_ids: dishIds,
  });

  if (error) {
    console.log('Dish tags error:', error.message);
    return [];
  }

  return (data ?? []) as Tag[];
}
