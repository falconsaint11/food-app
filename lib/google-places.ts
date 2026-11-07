import { supabase } from '@/lib/supabase';

// One Google autocomplete suggestion, as the google-places-autocomplete
// edge function returns it.
export type GooglePlaceSuggestion = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
};

type GooglePlaceDetails = {
  google_place_id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  website?: string | null;
};

// Groups autocomplete calls and the final details call into one billed
// Google session.
export function createSessionToken() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

// Food and drink places on Google matching the text, nearest first when a
// location is given.
export async function searchGoogleFoodPlaces(
  input: string,
  sessionToken: string,
  location: { latitude: number; longitude: number } | null
): Promise<GooglePlaceSuggestion[]> {
  const { data, error } = await supabase.functions.invoke(
    'google-places-autocomplete',
    {
      body: {
        input,
        sessionToken,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        foodOnly: true,
      },
    }
  );

  if (error) throw new Error(error.message);

  return Array.isArray(data?.suggestions) ? data.suggestions : [];
}

// The Wotri restaurant for a Google place, adding it if nobody has yet, so
// any restaurant can have a page before anyone logs a dish there.
export async function findOrCreateGoogleRestaurant(
  placeId: string,
  sessionToken: string
): Promise<string> {
  const { data: existing, error: existingError } = await supabase
    .from('restaurants')
    .select('id')
    .eq('google_place_id', placeId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) return existing.id as string;

  const { data, error } = await supabase.functions.invoke('google-place-details', {
    body: { placeId, sessionToken },
  });

  if (error) throw new Error(error.message);

  const details = data as GooglePlaceDetails;

  if (!details?.google_place_id || !details?.name) {
    throw new Error('Google did not return complete place details.');
  }

  // Google can hand back a different id for the same place.
  if (details.google_place_id !== placeId) {
    const { data: match } = await supabase
      .from('restaurants')
      .select('id')
      .eq('google_place_id', details.google_place_id)
      .maybeSingle();

    if (match) return match.id as string;
  }

  const { data: created, error: insertError } = await supabase
    .from('restaurants')
    .insert({
      name: details.name,
      city: details.city ?? '',
      state: details.state ?? '',
      address: details.address ?? null,
      latitude: details.latitude,
      longitude: details.longitude,
      google_place_id: details.google_place_id,
      website: details.website ?? null,
    })
    .select('id')
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message || 'Could not add this restaurant.');
  }

  return created.id as string;
}
