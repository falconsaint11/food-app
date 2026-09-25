import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
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

export default function FollowersScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFollowers();
  }, [userId]);

  async function loadFollowers() {
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data: followData, error: followError } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId);

    if (followError) {
      setLoading(false);
      Alert.alert('Followers error', followError.message);
      return;
    }

    const followerIds = (followData ?? []).map(
      (row) => row.follower_id
    );

    if (followerIds.length === 0) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', followerIds);

    setLoading(false);

    if (profileError) {
      Alert.alert('Profile error', profileError.message);
      return;
    }

    const sortedProfiles = [...(profileData ?? [])].sort((a, b) => {
      const aName = (
        a.display_name ||
        a.username
      ).toLowerCase();

      const bName = (
        b.display_name ||
        b.username
      ).toLowerCase();

      return aName.localeCompare(bName);
    });

    setProfiles(sortedProfiles);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Followers</Text>

        <Text style={styles.subtitle}>
          {profiles.length}{' '}
          {profiles.length === 1 ? 'person' : 'people'}
        </Text>
      </View>

      {profiles.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No followers yet</Text>

          <Text style={styles.emptyText}>
            People who follow this profile will appear here.
          </Text>
        </View>
      ) : (
        profiles.map((profile) => (
          <TouchableOpacity
            key={profile.id}
            style={styles.userRow}
            activeOpacity={0.7}
            onPress={() =>
              router.push({
                pathname: '/user/[id]',
                params: {
                  id: profile.id,
                },
              })
            }
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

            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 50,
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 18,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    color: '#777777',
    marginTop: 4,
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 14,
    padding: 18,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 13,
    color: '#777777',
    lineHeight: 18,
    marginTop: 4,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    fontWeight: '700',
  },
  username: {
    fontSize: 13,
    color: '#777777',
    marginTop: 3,
  },
  chevron: {
    fontSize: 24,
    color: '#aaaaaa',
    marginLeft: 12,
  },
});