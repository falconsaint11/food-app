import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';

export default function LogScreen() {
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantResults, setRestaurantResults] = useState<
  { id: string; name: string; city: string | null }[]
>([]);

const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [dishName, setDishName] = useState('');
  const [dishResults, setDishResults] = useState<
  { id: string; name: string }[]
>([]);

const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [loading, setLoading] = useState(false);
  async function searchRestaurants(text: string) {
  setRestaurantName(text);
  setSelectedRestaurantId(null);

  if (text.trim().length < 2) {
    setRestaurantResults([]);
    return;
  }

  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, city')
    .ilike('name', `%${text.trim()}%`)
    .limit(5);

  if (error) {
    console.log('Restaurant search error:', error.message);
    return;
  }

  setRestaurantResults(data ?? []);
}

async function searchDishes(text: string) {
  setDishName(text);
  setSelectedDishId(null);

  if (text.trim().length < 2) {
  setDishResults([]);
  return;
}

if (!selectedRestaurantId) {
  setDishResults([]);
  return;
}

  const { data, error } = await supabase
    .from('dishes')
    .select('id, name')
    .eq('restaurant_id', selectedRestaurantId)
    .ilike('name', `%${text.trim()}%`)
    .limit(5);

  if (error) {
    console.log('Dish search error:', error.message);
    return;
  }

  setDishResults(data ?? []);
}

  async function logDish() {
    if (!restaurantName.trim()) {
      Alert.alert('Missing restaurant', 'Enter a restaurant name.');
      return;
    }

    if (!dishName.trim()) {
      Alert.alert('Missing dish', 'Enter a dish name.');
      return;
    }

    if (rating < 0.5 || rating > 5) {
  Alert.alert('Missing rating', 'Choose a rating before logging the dish.');
  return;
}

    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);
      Alert.alert('Error', 'You must be signed in to log a dish.');
      return;
    }

    let restaurantId: string;

if (selectedRestaurantId) {
  restaurantId = selectedRestaurantId;
} else {
      const { data: newRestaurant, error: restaurantInsertError } =
        await supabase
          .from('restaurants')
          .insert({
            name: restaurantName.trim(),
            city: city.trim() || null,
          })
          .select('id')
          .single();

      if (restaurantInsertError || !newRestaurant) {
        setLoading(false);
        Alert.alert(
          'Restaurant error',
          restaurantInsertError?.message || 'Could not create restaurant.'
        );
        return;
      }

      restaurantId = newRestaurant.id;
    }

    let dishId: string;

if (selectedDishId) {
  dishId = selectedDishId;
} else {

      const { data: newDish, error: dishInsertError } = await supabase
        .from('dishes')
        .insert({
          restaurant_id: restaurantId,
          name: dishName.trim(),
        })
        .select('id')
        .single();

      if (dishInsertError || !newDish) {
        setLoading(false);
        Alert.alert(
          'Dish error',
          dishInsertError?.message || 'Could not create dish.'
        );
        return;
      }

      dishId = newDish.id;
    }

    // Save the user's review.
    const { error: reviewError } = await supabase.from('reviews').insert({
      user_id: user.id,
      dish_id: dishId,
      rating,
      review_text: reviewText.trim() || null,
    });

    setLoading(false);

    if (reviewError) {
      Alert.alert('Review error', reviewError.message);
      return;
    }

    Alert.alert('Logged!', `${dishName.trim()} was added to your diary.`);

    setRestaurantName('');
    setSelectedRestaurantId(null);
setRestaurantResults([]);
    setCity('');
    setDishName('');
    setRating(0);
    setReviewText('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Log Food</Text>
        <Text style={styles.subtitle}>
          Rate a specific menu item you ate.
        </Text>
<Text style={styles.label}>Restaurant</Text>

<TextInput
  style={styles.input}
  placeholder="Restaurant name"
  placeholderTextColor="#888888"
  value={restaurantName}
  onChangeText={searchRestaurants}
/>

{restaurantResults.length > 0 && !selectedRestaurantId ? (
  <View style={styles.resultsBox}>
    {restaurantResults.map((restaurant) => (
      <TouchableOpacity
        key={restaurant.id}
        style={styles.resultItem}
        onPress={() => {
          setRestaurantName(restaurant.name);
          setCity(restaurant.city ?? '');
          setSelectedRestaurantId(restaurant.id);
          setDishName('');
          setSelectedDishId(null);
        setDishResults([]);
        setSelectedDishId(null);
    setDishResults([]);
          setRestaurantResults([]);
        }}
      >
        <Text style={styles.resultName}>{restaurant.name}</Text>
        {restaurant.city ? (
          <Text style={styles.resultSubtext}>{restaurant.city}</Text>
        ) : null}
      </TouchableOpacity>
    ))}
  </View>
) : null}

        <Text style={styles.label}>City</Text>
        <TextInput
          style={styles.input}
          placeholder="City"
          placeholderTextColor="#888888"
          value={city}
          onChangeText={setCity}
        />

        <Text style={styles.label}>Dish</Text>

<TextInput
  style={styles.input}
  placeholder="Search or add a menu item"
  placeholderTextColor="#888888"
  value={dishName}
  onChangeText={searchDishes}
/>

{dishResults.length > 0 && !selectedDishId ? (
  <View style={styles.resultsBox}>
    {dishResults.map((dish) => (
      <TouchableOpacity
        key={dish.id}
        style={styles.resultItem}
        onPress={() => {
          setDishName(dish.name);
          setSelectedDishId(dish.id);
          setDishResults([]);
        }}
      >
        <Text style={styles.resultName}>{dish.name}</Text>
      </TouchableOpacity>
    ))}
  </View>
) : null}

       <Text style={styles.label}>Rating</Text>

<View style={styles.ratingRow}>
  {[1, 2, 3, 4, 5].map((star) => (
    <TouchableOpacity
      key={star}
      style={styles.starButton}
      onPress={() => setRating(star)}
    >
      <Text style={styles.star}>
        {rating >= star ? '★' : '☆'}
      </Text>
    </TouchableOpacity>
  ))}
</View>

<View style={styles.halfRatingRow}>
  {[0.5, 1.5, 2.5, 3.5, 4.5].map((half) => (
    <TouchableOpacity
      key={half}
      style={[
        styles.halfButton,
        rating === half && styles.halfButtonSelected,
      ]}
      onPress={() => setRating(half)}
    >
      <Text style={styles.halfButtonText}>{half}</Text>
    </TouchableOpacity>
  ))}
</View>

<Text style={styles.ratingHint}>
  {rating > 0 ? `${rating} out of 5` : 'Choose a rating'}
</Text>

        <Text style={styles.label}>Review</Text>
        <TextInput
          style={[styles.input, styles.reviewInput]}
          placeholder="What did you think?"
          placeholderTextColor="#888888"
          multiline
          value={reviewText}
          onChangeText={setReviewText}
        />

        <TouchableOpacity
          style={styles.button}
          onPress={logDish}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Logging...' : 'Log Dish'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginTop: 8,
    marginBottom: 30,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  resultsBox: {
  borderWidth: 1,
  borderColor: '#eeeeee',
  borderRadius: 10,
  marginTop: -8,
  marginBottom: 16,
  overflow: 'hidden',
},
resultItem: {
  padding: 12,
  borderBottomWidth: 1,
  borderBottomColor: '#eeeeee',
},
resultName: {
  fontSize: 16,
  fontWeight: '600',
},
resultSubtext: {
  fontSize: 13,
  color: '#777777',
  marginTop: 2,
},
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#111111',
    marginBottom: 16,
  },
 ratingRow: {
  flexDirection: 'row',
  marginBottom: 10,
},
starButton: {
  marginRight: 8,
},
star: {
  fontSize: 38,
},
halfRatingRow: {
  flexDirection: 'row',
  marginBottom: 10,
},
halfButton: {
  paddingVertical: 7,
  paddingHorizontal: 10,
  borderWidth: 1,
  borderColor: '#dddddd',
  borderRadius: 8,
  marginRight: 8,
},
halfButtonSelected: {
  borderColor: '#111111',
  backgroundColor: '#eeeeee',
},
halfButtonText: {
  fontSize: 14,
  fontWeight: '600',
},
ratingHint: {
  fontSize: 13,
  color: '#777777',
  marginBottom: 18,
},
  reviewInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#111111',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 30,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});