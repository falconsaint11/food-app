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
// Autocomplete gives at most 5 places per search, so a chain with many
// locations nearby can leave out the one you're at (a Panda Express in a
// mall food court). With nearby (the Log tab's "Show more locations near
// you"), it runs a Text Search instead: up to 20 places, nearest first, in
// the same shape. It costs more than autocomplete, so it only runs on tap.
//
// Request:  { input, latitude?, longitude?, sessionToken?, foodOnly?, nearby? }
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

// Meters between two points.
function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

type TextSearchPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  types?: string[];
  location?: { latitude: number; longitude: number };
};

async function nearbySearch(
  apiKey: string,
  input: string,
  latitude: number,
  longitude: number,
) {
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.types",
          "places.location",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery: input,
        pageSize: 20,
        rankPreference: "DISTANCE",
        locationBias: {
          circle: { center: { latitude, longitude }, radius: 20000 },
        },
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Google Text Search error:", data);
    throw new Error("Google Places request failed.");
  }

  const origin = { latitude, longitude };

  return ((data.places ?? []) as TextSearchPlace[])
    .filter((place) => place.id)
    .map((place) => {
      const name = place.displayName?.text ?? "Restaurant";
      const address = place.formattedAddress ?? "";
      return {
        placePrediction: {
          placeId: place.id,
          text: { text: address ? `${name}, ${address}` : name },
          structuredFormat: {
            mainText: { text: name },
            secondaryText: { text: address },
          },
          types: place.types ?? [],
          distanceMeters: place.location
            ? distanceMeters(origin, place.location)
            : undefined,
        },
      };
    })
    .sort(
      (a, b) =>
        (a.placePrediction.distanceMeters ?? Infinity) -
        (b.placePrediction.distanceMeters ?? Infinity),
    );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { input, latitude, longitude, sessionToken, foodOnly, nearby } =
      await req.json();

    if (typeof input !== "string" || input.trim().length < 3) {
      return json({ suggestions: [] });
    }

    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");

    if (!apiKey) {
      throw new Error("Google Places API key is missing.");
    }

    if (
      nearby &&
      typeof latitude === "number" &&
      typeof longitude === "number"
    ) {
      return json({
        suggestions: await nearbySearch(apiKey, input.trim(), latitude, longitude),
      });
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
    const close = suggestions
      .filter((suggestion) => distance(suggestion) <= NEARBY_METERS)
      .sort((a, b) => distance(a) - distance(b));
    const farther = suggestions.filter(
      (suggestion) => distance(suggestion) > NEARBY_METERS,
    );

    return json({ suggestions: [...close, ...farther] });
  } catch (error) {
    console.error(error);

    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
