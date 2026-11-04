// Restaurant search for the Log tab, using Google Places Autocomplete.
//
// Runs two searches at once and merges them: one limited to food places
// (restaurants, cafés, bars, bakeries, takeout), and one open to any
// business, so smoothie and nutrition shops, places inside a mall, gym or
// hotel, and food trucks without an address still show up. Food places come
// first; plain addresses and cities are left out.
//
// Deploy:  supabase functions deploy google-places-autocomplete
// Secret:  supabase secrets set GOOGLE_PLACES_API_KEY=...
//
// Request:  { input, latitude?, longitude?, sessionToken? }
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

type Suggestion = {
  placePrediction?: { placeId?: string; types?: string[] };
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
    const { input, latitude, longitude, sessionToken } = await req.json();

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
        circle: { center: { latitude, longitude }, radius: 50000 },
      };
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
      ...anything.filter((other) => !isFood(other) && isPlace(other)),
    ]) {
      const placeId = suggestion.placePrediction!.placeId!;
      if (seen.has(placeId)) continue;
      seen.add(placeId);
      suggestions.push(suggestion);
    }

    return json({ suggestions });
  } catch (error) {
    console.error(error);

    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
