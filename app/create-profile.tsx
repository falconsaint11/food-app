import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity
} from 'react-native';

import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

export default function CreateProfileScreen() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);

  async function createProfile() {
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

    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      username: username.trim(),
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
    });

    setLoading(false);

    if (error) {
      Alert.alert('Profile error', error.message);
      return;
    }

    Alert.alert('Success', 'Your profile was created.');
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
      <Text style={styles.title}>Create your profile</Text>
      <Text style={styles.label}>Username</Text>

      <TextInput
        style={styles.input}
        placeholder="Username"
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      <Text style={styles.label}>Display Name</Text>

      <TextInput
        style={styles.input}
        placeholder="Display name"
        value={displayName}
        onChangeText={setDisplayName}
      />
      <Text style={styles.label}>Bio</Text>

      <TextInput
        style={[styles.input, styles.bio]}
        placeholder="Bio"
        multiline
        value={bio}
        onChangeText={setBio}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={createProfile}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? 'Creating...' : 'Create Profile'}
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
    justifyContent: 'center',
    padding: 24,
    backgroundColor: Palette.background,
  },
  title: {
    color: Palette.text,
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 24,
  },
  label: {
  color: Palette.text,
  fontSize: 14,
  fontWeight: '600',
  marginBottom: 6,
},
  input: {
    color: Palette.text,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 14,
  },
  bio: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: Palette.accent,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: Palette.text,
    fontWeight: '600',
    fontSize: 16,
  },
});