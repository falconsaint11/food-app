import { supabase } from '@/lib/supabase';

export type ListType = 'dish' | 'restaurant';

export type ListSummary = {
  id: string;
  name: string;
  description: string | null;
  list_type: ListType;
  is_public: boolean;
  itemCount: number;
};

export type RatingSummary = {
  average: number;
  count: number;
};

export async function fetchUserLists(
  userId: string,
  listType?: ListType
): Promise<ListSummary[]> {
  let query = supabase
    .from('lists')
    .select(
      'id, name, description, list_type, is_public, created_at, list_items(count)'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (listType) {
    query = query.eq('list_type', listType);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((list: any) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    list_type: list.list_type,
    is_public: list.is_public,
    itemCount: list.list_items?.[0]?.count ?? 0,
  }));
}

function addRating(
  ratings: Map<string, RatingSummary>,
  key: string,
  rating: number
) {
  const current = ratings.get(key) ?? { average: 0, count: 0 };
  const count = current.count + 1;

  ratings.set(key, {
    average: (current.average * current.count + rating) / count,
    count,
  });
}

export async function fetchDishRatings(dishIds: string[]) {
  const ratings = new Map<string, RatingSummary>();

  if (dishIds.length === 0) {
    return ratings;
  }

  const { data, error } = await supabase
    .from('reviews')
    .select('dish_id, rating')
    .in('dish_id', dishIds);

  if (error) {
    throw new Error(error.message);
  }

  for (const review of data ?? []) {
    addRating(ratings, review.dish_id, Number(review.rating));
  }

  return ratings;
}

export async function fetchRestaurantRatings(restaurantIds: string[]) {
  const ratings = new Map<string, RatingSummary>();

  if (restaurantIds.length === 0) {
    return ratings;
  }

  const { data: dishData, error: dishError } = await supabase
    .from('dishes')
    .select('id, restaurant_id')
    .in('restaurant_id', restaurantIds);

  if (dishError) {
    throw new Error(dishError.message);
  }

  const restaurantByDish = new Map<string, string>(
    (dishData ?? []).map((dish) => [dish.id, dish.restaurant_id])
  );

  if (restaurantByDish.size === 0) {
    return ratings;
  }

  const { data: reviewData, error: reviewError } = await supabase
    .from('reviews')
    .select('dish_id, rating')
    .in('dish_id', [...restaurantByDish.keys()]);

  if (reviewError) {
    throw new Error(reviewError.message);
  }

  for (const review of reviewData ?? []) {
    const restaurantId = restaurantByDish.get(review.dish_id);

    if (restaurantId) {
      addRating(ratings, restaurantId, Number(review.rating));
    }
  }

  return ratings;
}

export function formatRating(rating: RatingSummary | undefined) {
  return rating && rating.count > 0 ? `${rating.average.toFixed(1)} ★` : '—';
}
