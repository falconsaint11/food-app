import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Food App</Text>

        <Text style={styles.subtitle}>
          Rate what you eat.
        </Text>

        <Text style={styles.label}>Email</Text>

        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#888888"
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
        />

        <Text style={styles.label}>Password</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter your password"
          placeholderTextColor="#888888"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity
          style={[
            styles.primaryButton,
            loading && styles.disabledButton,
          ]}
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
          <Text style={styles.secondaryButtonText}>
            Create Account
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={signOut}
          disabled={loading}
        >
          <Text style={styles.signOutButtonText}>
            Sign Out
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f7f7',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 24,
    borderWidth: 1,
    borderColor: '#eeeeee',
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#111111',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: '#666666',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 30,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222222',
    marginBottom: 7,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111111',
    backgroundColor: '#ffffff',
    marginBottom: 18,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 10,
    backgroundColor: '#111111',
    alignItems: 'center',
    marginTop: 4,
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '600',
  },
  signOutButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  signOutButtonText: {
    color: '#777777',
    fontSize: 14,
    fontWeight: '500',
  },
});