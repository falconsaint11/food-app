import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { supabase } from '@/lib/supabase';
import { router, useFocusEffect } from 'expo-router';

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
};

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
        loadProfile();
  }, [])
);

  async function loadProfile() {
    setLoading(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);
      Alert.alert('Error', 'No signed-in user found.');
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    setLoading(false);

    if (error) {
      Alert.alert('Profile error', error.message);
      return;
    }

    setProfile(data);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text>No profile found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatarPlaceholder}>
        <Text style={styles.avatarText}>
          {(profile.display_name || profile.username)
            .charAt(0)
            .toUpperCase()}
        </Text>
      </View>

      <Text style={styles.displayName}>
        {profile.display_name || profile.username}
      </Text>

      <Text style={styles.username}>@{profile.username}</Text>
      <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.push('/edit-profile')}
        >
            <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>

      {profile.bio ? (
        <Text style={styles.bio}>{profile.bio}</Text>
      ) : null}

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>0</Text>
          <Text style={styles.statLabel}>Dishes</Text>
        </View>

        <View style={styles.stat}>
          <Text style={styles.statNumber}>0</Text>
          <Text style={styles.statLabel}>Restaurants</Text>
        </View>

        <View style={styles.stat}>
          <Text style={styles.statNumber}>0</Text>
          <Text style={styles.statLabel}>Followers</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Dishes</Text>
        <Text style={styles.emptyText}>Nothing ranked yet.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Restaurants</Text>
        <Text style={styles.emptyText}>Nothing ranked yet.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Diary</Text>
        <Text style={styles.emptyText}>Nothing logged yet.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#eeeeee',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 30,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: '700',
  },
  displayName: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 16,
  },
  username: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 4,
    color: '#666666',
  },
  editButton: {
  alignSelf: 'center',
  marginTop: 14,
  paddingHorizontal: 18,
  paddingVertical: 10,
  borderWidth: 1,
  borderColor: '#cccccc',
  borderRadius: 8,
},
editButtonText: {
  fontSize: 15,
  fontWeight: '600',
},
  bio: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 22,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 28,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eeeeee',
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 13,
    marginTop: 4,
    color: '#666666',
  },
  section: {
    marginTop: 28,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#777777',
  },
});