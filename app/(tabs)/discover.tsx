import { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';

type UserResult = {
  id: string;
  username: string;
  display_name: string | null;
};

export default function DiscoverScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  useEffect(() => {
  loadFollowing();
}, []);

  async function searchUsers(text: string) {
    setQuery(text);

    if (text.trim().length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .or(
        `username.ilike.%${text.trim()}%,display_name.ilike.%${text.trim()}%`
      )
      .limit(10);

    setLoading(false);

    if (error) {
      Alert.alert('Search error', error.message);
      return;
    }

    setResults(data ?? []);
  }

  async function loadFollowing() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return;
  }

  const { data, error } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', user.id);

  if (error) {
    console.log('Following load error:', error.message);
    return;
  }

  setFollowingIds((data ?? []).map((row) => row.following_id));
}

  async function toggleFollow(profileId: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    Alert.alert('Error', 'You must be signed in.');
    return;
  }

  if (user.id === profileId) {
    Alert.alert('Not allowed', 'You cannot follow yourself.');
    return;
  }

  const isFollowing = followingIds.includes(profileId);

  if (isFollowing) {
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', profileId);

    if (error) {
      Alert.alert('Unfollow error', error.message);
      return;
    }

    setFollowingIds((current) =>
      current.filter((id) => id !== profileId)
    );
  } else {
    const { error } = await supabase.from('follows').insert({
      follower_id: user.id,
      following_id: profileId,
    });

    if (error) {
      Alert.alert('Follow error', error.message);
      return;
    }

    setFollowingIds((current) => [...current, profileId]);
  }
}

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Discover</Text>
      <Text style={styles.subtitle}>
        Search for people to follow.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Search username or name"
        placeholderTextColor="#888888"
        autoCapitalize="none"
        value={query}
        onChangeText={searchUsers}
      />

      {loading ? (
        <Text style={styles.statusText}>Searching...</Text>
      ) : null}

      {results.map((user) => (
        <View key={user.id} style={styles.userRow}>
         <View style={styles.userInfo}>
  <Text style={styles.displayName}>
    {user.display_name || user.username}
  </Text>
  <Text style={styles.username}>@{user.username}</Text>
</View>

          <TouchableOpacity
  style={[
    styles.followButton,
    followingIds.includes(user.id) && styles.followingButton,
  ]}
  onPress={() => toggleFollow(user.id)}
>
  <Text
    style={[
      styles.followButtonText,
      followingIds.includes(user.id) && styles.followingButtonText,
    ]}
  >
    {followingIds.includes(user.id) ? 'Following' : 'Follow'}
  </Text>
</TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#111111',
    marginBottom: 18,
  },
  statusText: {
    fontSize: 14,
    color: '#777777',
    marginBottom: 10,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  userInfo: {
    flex: 1,
    paddingRight: 14,
  },
  displayName: {
    fontSize: 16,
    fontWeight: '600',
  },
  username: {
    fontSize: 14,
    color: '#666666',
    marginTop: 2,
  },
  followButton: {
    backgroundColor: '#111111',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  followButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  followingButton: {
  backgroundColor: '#ffffff',
  borderWidth: 1,
  borderColor: '#cccccc',
},
followingButtonText: {
  color: '#111111',
},
});