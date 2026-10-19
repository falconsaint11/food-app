import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
};

export default function FollowingScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFollowing();
  }, [userId]);

  function getProfilePhotoUrl(path: string) {
    const { data } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(path);

    return data.publicUrl;
  }

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

      Alert.alert(
        'Following error',
        followError.message
      );

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

    const {
      data: profileData,
      error: profileError,
    } = await supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_path'
      )
      .in('id', followingIds);

    setLoading(false);

    if (profileError) {
      Alert.alert(
        'Profile error',
        profileError.message
      );

      return;
    }

    const sortedProfiles = [
      ...(profileData ?? []),
    ].sort((a, b) => {
      const aName = (
        a.display_name ||
        a.username
      ).toLowerCase();

      const bName = (
        b.display_name ||
        b.username
      ).toLowerCase();

      return aName.localeCompare(
        bName
      );
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
    <ScrollView
      contentContainerStyle={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.title}>
          Following
        </Text>

        <Text style={styles.subtitle}>
          {profiles.length}{' '}
          {profiles.length === 1
            ? 'person'
            : 'people'}
        </Text>
      </View>

      {profiles.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            Not following anyone yet
          </Text>

          <Text style={styles.emptyText}>
            Profiles followed by this user will
            appear here.
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
            {profile.avatar_path ? (
              <Image
                source={{
                  uri: getProfilePhotoUrl(
                    profile.avatar_path
                  ),
                }}
                style={styles.avatarImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(
                    profile.display_name ||
                    profile.username
                  )
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              </View>
            )}

            <View style={styles.userInfo}>
              <Text style={styles.displayName}>
                {profile.display_name ||
                  profile.username}
              </Text>

              <Text style={styles.username}>
                @{profile.username}
              </Text>
            </View>

            <Text style={styles.chevron}>
              ›
            </Text>
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
    backgroundColor: Palette.background,
  },

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Palette.background,
  },

  header: {
    marginBottom: 18,
  },

  title: {
    color: Palette.text,
    fontSize: 30,
    fontWeight: '700',
  },

  subtitle: {
    fontSize: 14,
    color: Palette.textMuted,
    marginTop: 4,
  },

  emptyCard: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    padding: 18,
  },

  emptyTitle: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },

  emptyText: {
    fontSize: 13,
    color: Palette.textMuted,
    lineHeight: 18,
    marginTop: 4,
  },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },

  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Palette.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },

  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Palette.elevated,
    marginRight: 14,
  },

  avatarText: {
    color: Palette.text,
    fontSize: 18,
    fontWeight: '700',
  },

  userInfo: {
    flex: 1,
  },

  displayName: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },

  username: {
    fontSize: 13,
    color: Palette.accent,
    marginTop: 3,
  },

  chevron: {
    fontSize: 24,
    color: Palette.textMuted,
    marginLeft: 12,
  },
});