// "Carrot Cake · Discontinued" for dishes the restaurant no longer serves.
// Their reviews and rankings stay; the label says why they're off the menu.
export function dishLabel(dish: {
  name: string;
  discontinued_at?: string | null;
}) {
  return dish.discontinued_at ? `${dish.name} · Discontinued` : dish.name;
}
