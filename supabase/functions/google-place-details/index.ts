// Details for one Google place (name, address, city, state, location), used
// when someone picks a restaurant nobody has added to Wotri yet.
//
// Only signed-in users can call it, and each call counts 2 toward the same
// hourly limit as the search (see claim_places_search()), since it's a paid
// Google call.
//
// Request:  { placeId, sessionToken? }
// Response: { google_place_id, name, address, city, state, latitude, longitude }

import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type AddressComponent = {
  types?: string[];
  longText?: string;
  shortText?: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // Acts as the signed-in user, so auth.uid() works in the limit check.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" },
        },
      },
    );

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return json({ error: "Sign in to add a restaurant." }, 401);
    }

    const { placeId, sessionToken } = await req.json();

    if (typeof placeId !== "string" || !placeId.trim()) {
      return json({ error: "Missing placeId" }, 400);
    }

    const { error: limitError } = await supabase.rpc("claim_places_search", {
      p_cost: 2,
    });

    if (limitError) {
      return json({ error: limitError.message }, 429);
    }

    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");

    if (!apiKey) {
      throw new Error("Google Places API key is missing.");
    }

    let url = `https://places.googleapis.com/v1/places/${
      encodeURIComponent(placeId.trim())
    }`;

    // Ends the autocomplete session, so Google bills the searches and this
    // lookup together.
    if (typeof sessionToken === "string" && sessionToken.trim()) {
      url += `?sessionToken=${encodeURIComponent(sessionToken.trim())}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "id",
          "displayName",
          "formattedAddress",
          "addressComponents",
          "location",
        ].join(","),
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Google Place Details error:", data);
      return json(
        { error: "Google Place Details request failed." },
        response.status,
      );
    }

    const addressComponents: AddressComponent[] = Array.isArray(
        data.addressComponents,
      )
      ? data.addressComponents
      : [];

    const getComponent = (type: string) => {
      const component = addressComponents.find((item) =>
        Array.isArray(item.types) && item.types.includes(type)
      );
      return component?.longText ?? component?.shortText ?? null;
    };

    return json({
      google_place_id: data.id ?? placeId,
      name: data.displayName?.text ?? "",
      address: data.formattedAddress ?? null,
      city: getComponent("locality") ??
        getComponent("postal_town") ??
        getComponent("administrative_area_level_2"),
      state: getComponent("administrative_area_level_1"),
      latitude: data.location?.latitude ?? null,
      longitude: data.location?.longitude ?? null,
    });
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
