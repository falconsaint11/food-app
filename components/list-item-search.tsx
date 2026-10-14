import { useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import { ListType } from '@/lib/lists';
import { supabase } from '@/lib/supabase';

type SearchResult = {
  key: string;
  title: string;
  subtitle: string;
  // Existing row id, or a Google place id for restaurants not in the database yet
  id?: string;
  googlePlaceId?: string;
};

type GooglePlaceSuggestion = {
  placePrediction?: {
    placeId?: string;
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
};

type ListItemSearchProps = {
  listType: ListType;
  onSelect: (id: string) => Promise<void>;
};

function createSessionToken() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;

    return value.toString(16);
  });
}

export function ListItemSearch({ listType, onSelect }: ListItemSearchProps) {
  const [query, setQuery] = useState('');
  const [localResults, setLocalResults] = useState<SearchResult[]>([]);
  const [googleResults, setGoogleResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  const googleSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const googleSessionToken = useRef(createSessionToken());

  function clearSearch() {
    if (googleSearchTimeout.current) {
      clearTimeout(googleSearchTimeout.current);
    }

    setQuery('');
    setLocalResults([]);
    setGoogleResults([]);
  }

  async function search(text: string) {
    setQuery(text);

    const trimmed = text.trim();

    if (googleSearchTimeout.current) {
      clearTimeout(googleSearchTimeout.current);
    }

    if (trimmed.length < 2) {
      setLocalResults([]);
      setGoogleResults([]);
      return;
    }

    if (listType === 'dish') {
      const { data, error } = await supabase
        .from('dishes')
        .select('id, name, restaurants(name, city)')
        .ilike('name', `%${trimmed}%`)
        .limit(10);

      if (error) {
        console.log('Dish search error:', error.message);
        return;
      }

      setLocalResults(
        (data ?? []).map((dish: any) => ({
          key: dish.id,
          id: dish.id,
          title: dish.name,
          subtitle: [dish.restaurants?.name, dish.restaurants?.city]
            .filter(Boolean)
            .join(' · '),
        }))
      );
      return;
    }

    const { data, error } = await supabase
      .from('restaurants')
      .select('id, name, city, state')
      .ilike('name', `%${trimmed}%`)
      .limit(8);

    if (error) {
      console.log('Restaurant search error:', error.message);
    } else {
      setLocalResults(
        (data ?? []).map((restaurant) => ({
          key: restaurant.id,
          id: restaurant.id,
          title: restaurant.name,
          subtitle: [restaurant.city, restaurant.state]
            .filter(Boolean)
            .join(', '),
        }))
      );
    }

    if (trimmed.length >= 3) {
      googleSearchTimeout.current = setTimeout(() => {
        searchGooglePlaces(trimmed);
      }, 350);
    } else {
      setGoogleResults([]);
    }
  }

  async function searchGooglePlaces(text: string) {
    try {
      const { data, error } = await supabase.functions.invoke(
        'google-places-autocomplete',
        {
          body: {
            input: text,
            sessionToken: googleSessionToken.current,
            latitude: null,
            longitude: null,
          },
        }
      );

      if (error) {
        console.log('Google autocomplete function error:', error.message);
        setGoogleResults([]);
        return;
      }

      const suggestions: GooglePlaceSuggestion[] = Array.isArray(
        data?.suggestions
      )
        ? data.suggestions
        : [];

      setGoogleResults(
        suggestions
          .filter((suggestion) => suggestion.placePrediction?.placeId)
          .map((suggestion) => {
            const prediction = suggestion.placePrediction!;

            return {
              key: `google-${prediction.placeId}`,
              googlePlaceId: prediction.placeId,
              title: prediction.structuredFormat?.mainText?.text ?? 'Restaurant',
              subtitle: prediction.structuredFormat?.secondaryText?.text ?? '',
            };
          })
      );
    } catch (error) {
      console.log('Google autocomplete error:', error);
      setGoogleResults([]);
    }
  }

  // Looks up a Google place, reusing the restaurant row if one already exists
  async function findOrCreateGoogleRestaurant(placeId: string) {
    const { data, error } = await supabase.functions.invoke(
      'google-place-details',
      {
        body: {
          placeId,
          sessionToken: googleSessionToken.current,
        },
      }
    );

    googleSessionToken.current = createSessionToken();

    if (error) {
      throw new Error(error.message);
    }

    const details = data as GooglePlaceDetails;

    if (!details?.google_place_id || !details?.name) {
      throw new Error('Google did not return complete place details.');
    }

    const { data: existing, error: existingError } = await supabase
      .from('restaurants')
      .select('id')
      .eq('google_place_id', details.google_place_id)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      return existing.id as string;
    }

    const { data: newRestaurant, error: insertError } = await supabase
      .from('restaurants')
      .insert({
        name: details.name,
        city: details.city ?? '',
        state: details.state ?? '',
        address: details.address,
        latitude: details.latitude,
        longitude: details.longitude,
        google_place_id: details.google_place_id,
      })
      .select('id')
      .single();

    if (insertError || !newRestaurant) {
      throw new Error(insertError?.message || 'Could not create restaurant.');
    }

    return newRestaurant.id as string;
  }

  async function selectResult(result: SearchResult) {
    setBusy(true);

    try {
      const id = result.id
        ? result.id
        : await findOrCreateGoogleRestaurant(result.googlePlaceId!);

      await onSelect(id);
      clearSearch();
    } catch (error) {
      Alert.alert(
        'Could not add',
        error instanceof Error ? error.message : 'Something went wrong.'
      );
    } finally {
      setBusy(false);
    }
  }

  const results = [...localResults, ...googleResults];

  return (
    <View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={
            listType === 'dish' ? 'Add a dish...' : 'Add a restaurant...'
          }
          placeholderTextColor="#888888"
          autoCorrect={false}
          value={query}
          onChangeText={search}
          editable={!busy}
        />

        {busy ? <ActivityIndicator style={styles.spinner} /> : null}
      </View>

      {results.length > 0 ? (
        <View style={styles.results}>
          {results.map((result) => (
            <TouchableOpacity
              key={result.key}
              style={styles.resultRow}
              onPress={() => selectResult(result)}
              disabled={busy}
            >
              <Text style={styles.resultTitle} numberOfLines={1}>
                {result.title}
              </Text>

              {result.subtitle ? (
                <Text style={styles.resultSubtitle} numberOfLines={1}>
                  {result.subtitle}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {listType === 'dish' && query.trim().length >= 2 && results.length === 0 ? (
        <Text style={styles.noResults}>
          No dishes found. Dishes show up here once someone logs them.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111111',
  },
  spinner: {
    marginLeft: 10,
  },
  results: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 10,
  },
  resultRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  resultSubtitle: {
    fontSize: 13,
    color: '#777777',
    marginTop: 2,
  },
  noResults: {
    fontSize: 13,
    color: '#777777',
    marginTop: 8,
  },
});
