import { useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signUp() {
  setLoading(true);

  const { error } = await supabase.auth.signUp({
    email,
    password,
  });

  setLoading(false);

  if (error) {
    Alert.alert('Signup error', error.message);
    return;
  }

  Alert.alert('Success', 'Your account was created.');
}

 async function signIn() {
  setLoading(true);

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  setLoading(false);

  if (error) {
    Alert.alert('Login error', error.message);
    return;
  }

  Alert.alert('Success', 'You are signed in.');
}

async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    Alert.alert('Logout error', error.message);
    return;
  }

  Alert.alert('Success', 'You are signed out.');
}

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Food App</Text>
      <Text style={styles.subtitle}>Rate what you eat.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        autoCapitalize="none"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={signIn}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>
          {loading ? 'Loading...' : 'Sign In'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={signUp}
        disabled={loading}
      >
        <Text style={styles.secondaryButtonText}>Create Account</Text>
      </TouchableOpacity>
      <TouchableOpacity
  style={styles.secondaryButton}
  onPress={signOut}
  disabled={loading}
>
  <Text style={styles.secondaryButtonText}>Sign Out</Text>
</TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 18,
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 14,
  },
  primaryButton: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#111111',
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    padding: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});