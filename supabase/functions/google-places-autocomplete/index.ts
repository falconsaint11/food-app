// Restaurant search for the Log tab, using Google Places Autocomplete.
//
// Runs two searches at once and merges them: one limited to food places
// (restaurants, cafés, bars, bakeries, takeout), and one open to any
// business, so smoothie and nutrition shops, places inside a mall, gym or
// hotel, and food trucks without an address still show up. Food places come
// first; plain addresses and cities are left out.
//
// Google's location bias is weak (typing "chicha" in Chandler listed the
// Las Vegas and LA locations before the one a minute away), so places within
// NEARBY_METERS come first, nearest first, then everything else.
//
// Deploy:  supabase functions deploy google-places-autocomplete
// Secret:  supabase secrets set GOOGLE_PLACES_API_KEY=...
//
// With foodOnly (Discover's restaurant search, which opens a restaurant
// page), only food and drink places come back: no gyms, stores or other
// businesses.
//
// Request:  { input, latitude?, longitude?, sessionToken?, foodOnly? }
// Response: { suggestions: [{ placePrediction: { placeId, text, structuredFormat, types } }] }

const FOOD_PRIMARY_TYPES = [
  "restaurant",
  "cafe",
  "bar",
  "bakery",
  "meal_takeaway",
];

// Type names that mean food or drink, e.g. "juice_shop", "ice_cream_shop",
// "mexican_restaurant", "health_food_store", "wine_bar".
const FOOD_TYPE =
  /restaurant|food|cafe|coffee|bakery|(^|_)bar(_|$)|meal|juice|smoothie|ice_cream|dessert|(^|_)tea(_|$)|deli|pizza|sandwich|brew|winery|donut|bagel|acai|confection|candy|chocolate/;

// About 25 miles.
const NEARBY_METERS = 40000;

type Suggestion = {
  placePrediction?: {
    placeId?: string;
    types?: string[];
    distanceMeters?: number;
  };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isFood(suggestion: Suggestion) {
  return (suggestion.placePrediction?.types ?? []).some((type) =>
    FOOD_TYPE.test(type)
  );
}

// A business or place rather than a street address, city or region.
function isPlace(suggestion: Suggestion) {
  const types = suggestion.placePrediction?.types;
  if (!types || types.length === 0) return true;
  return (
    types.includes("establishment") ||
    types.includes("point_of_interest") ||
    isFood(suggestion)
  );
}

async function autocomplete(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Suggestion[]> {
  const response = await fetch(
    "https://places.googleapis.com/v1/places:autocomplete",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "suggestions.placePrediction.placeId",
          "suggestions.placePrediction.text.text",
          "suggestions.placePrediction.structuredFormat.mainText.text",
          "suggestions.placePrediction.structuredFormat.secondaryText.text",
          "suggestions.placePrediction.types",
          "suggestions.placePrediction.distanceMeters",
        ].join(","),
      },
      body: JSON.stringify(body),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Google Places error:", data);
    throw new Error("Google Places request failed.");
  }

  return (data.suggestions ?? []).filter(
    (suggestion: Suggestion) => suggestion.placePrediction?.placeId,
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { input, latitude, longitude, sessionToken, foodOnly } =
      await req.json();

    if (typeof input !== "string" || input.trim().length < 3) {
      return json({ suggestions: [] });
    }

    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");

    if (!apiKey) {
      throw new Error("Google Places API key is missing.");
    }

    const base: Record<string, unknown> = {
      input: input.trim(),
      // Businesses with no storefront address, like many food trucks.
      includePureServiceAreaBusinesses: true,
    };

    if (sessionToken) {
      base.sessionToken = sessionToken;
    }

    if (typeof latitude === "number" && typeof longitude === "number") {
      base.locationBias = {
        circle: { center: { latitude, longitude }, radius: 20000 },
      };
      // Makes Google return each place's distance from the user.
      base.origin = { latitude, longitude };
    }

    const [food, anything] = await Promise.all([
      autocomplete(apiKey, { ...base, includedPrimaryTypes: FOOD_PRIMARY_TYPES }),
      autocomplete(apiKey, base),
    ]);

    // Food places first, then other businesses, each place once.
    const seen = new Set<string>();
    const suggestions: Suggestion[] = [];

    for (const suggestion of [
      ...food,
      ...anything.filter(isFood),
      ...(foodOnly
        ? []
        : anything.filter((other) => !isFood(other) && isPlace(other))),
    ]) {
      const placeId = suggestion.placePrediction!.placeId!;
      if (seen.has(placeId)) continue;
      seen.add(placeId);
      suggestions.push(suggestion);
    }

    // Nearby places first, nearest first; the rest keep their order.
    const distance = (suggestion: Suggestion) =>
      suggestion.placePrediction?.distanceMeters ?? Infinity;
    const nearby = suggestions
      .filter((suggestion) => distance(suggestion) <= NEARBY_METERS)
      .sort((a, b) => distance(a) - distance(b));
    const farther = suggestions.filter(
      (suggestion) => distance(suggestion) > NEARBY_METERS,
    );

    return json({ suggestions: [...nearby, ...farther] });
  } catch (error) {
    console.error(error);

    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
