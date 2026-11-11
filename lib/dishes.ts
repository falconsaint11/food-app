// "Carrot Cake · Discontinued" for dishes the restaurant no longer serves.
// Their reviews and rankings stay; the label says why they're off the menu.
export function dishLabel(dish: {
  name: string;
  discontinued_at?: string | null;
}) {
  return dish.discontinued_at ? `${dish.name} · Discontinued` : dish.name;
}

// The flavors picked on a review with several ("Chicken, Shrimp & Steak"),
// as embedded with `review_flavors (dishes (name, variant_label))`.
export type ReviewFlavorRow = {
  dishes: { name: string; variant_label: string | null } | null;
};

export function flavorList(rows: ReviewFlavorRow[] | null | undefined) {
  const labels = (rows ?? []).flatMap((row) =>
    row.dishes ? [row.dishes.variant_label || row.dishes.name] : []
  );

  if (labels.length <= 1) return labels.join('');

  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}

// "Hot Rice Bowl · Chicken, Shrimp & Steak".
export function withFlavors(
  name: string,
  rows: ReviewFlavorRow[] | null | undefined
) {
  const flavors = flavorList(rows);
  return flavors ? `${name} · ${flavors}` : name;
}
