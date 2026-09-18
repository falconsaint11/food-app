import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { supabase } from '@/lib/supabase';

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
};

export default function FollowingScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFollowing();
  }, [userId]);

  async function loadFollowing() {
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data: followData, error: followError } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (followError) {
      setLoading(false);
      Alert.alert('Following error', followError.message);
      return;
    }

    const followingIds = (followData ?? []).map(
      (row) => row.following_id
    );

    if (followingIds.length === 0) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', followingIds);

    setLoading(false);

    if (profileError) {
      Alert.alert('Profile error', profileError.message);
      return;
    }

    setProfiles(profileData ?? []);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Following</Text>

      {profiles.length === 0 ? (
        <Text style={styles.emptyText}>
          Not following anyone yet.
        </Text>
      ) : (
        profiles.map((profile) => (
          <TouchableOpacity
            key={profile.id}
            style={styles.userRow}
            onPress={() => router.push(`/user/${profile.id}`)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(profile.display_name || profile.username)
                  .charAt(0)
                  .toUpperCase()}
              </Text>
            </View>

            <View style={styles.userInfo}>
              <Text style={styles.displayName}>
                {profile.display_name || profile.username}
              </Text>

              <Text style={styles.username}>
                @{profile.username}
              </Text>
            </View>
          </TouchableOpacity>
        ))
      )}
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 15,
    color: '#777777',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#eeeeee',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
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
});