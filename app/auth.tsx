import { supabase } from "@/lib/supabase";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// Save the supplied logo in assets/images/wotri-logo.jpg.
const logo = require("../assets/images/wotri-logo.jpg");
const ORANGE = "#FF5722";
const BG = "#121212";

type Screen = "welcome" | "signup" | "login";

export default function AuthScreen() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@") || password.length < 6) {
      Alert.alert(
        "Check your details",
        "Enter a valid email and a password of at least 6 characters.",
      );
      return;
    }
    setLoading(true);
    try {
      if (screen === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
        if (!data.session) {
          Alert.alert(
            "Check your email",
            "Confirm your email address, then return and sign in.",
            [{ text: "OK", onPress: () => setScreen("login") }],
          );
        }
        // When signup returns a session, RootLayout routes to /onboarding.
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
        // RootLayout routes existing users to Home and new users to onboarding.
      }
    } catch (error) {
      Alert.alert(
        screen === "signup" ? "Signup error" : "Login error",
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoTile}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </View>
        {screen === "welcome" ? (
          <>
            <Text style={styles.brand}>wotri.</Text>
            <Text style={styles.title}>Every bite has a story.</Text>
            <Text style={styles.subtitle}>
              Rate what you eat. Discover favorites. Share the experience.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setScreen("signup")}
            >
              <Text style={styles.primaryText}>Get started</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setScreen("login")}
            >
              <Text style={styles.secondaryText}>
                I already have an account
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.brand}>wotri.</Text>
            <Text style={styles.title}>
              {screen === "signup" ? "Create your account" : "Welcome back"}
            </Text>
            <Text style={styles.subtitle}>
              {screen === "signup"
                ? "Your food diary starts here."
                : "Sign in to keep exploring."}
            </Text>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor="#8B8B8B"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="At least 6 characters"
              placeholderTextColor="#8B8B8B"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={
                screen === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChangeText={setPassword}
              editable={!loading}
            />
            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.disabled]}
              onPress={submit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {screen === "signup" ? "Create account" : "Sign in"}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                setScreen(screen === "signup" ? "login" : "signup")
              }
              disabled={loading}
            >
              <Text style={styles.secondaryText}>
                {screen === "signup"
                  ? "Already have an account? Sign in"
                  : "New here? Create an account"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setScreen("welcome")}
              disabled={loading}
            >
              <Text style={styles.backText}>Back to welcome</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 28,
    paddingBottom: 60,
  },
  logoTile: {
    alignSelf: "center",
    width: 132,
    height: 132,
    backgroundColor: "#FFF9F3",
    borderRadius: 30,
    overflow: "hidden",
    marginBottom: 28,
  },
  logo: { width: "100%", height: "100%" },
  brand: {
    color: ORANGE,
    fontWeight: "800",
    fontSize: 25,
    textAlign: "center",
    marginBottom: 18,
  },
  title: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 32,
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    color: "#B2B2B2",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 23,
    marginBottom: 36,
  },
  label: { color: "#EAEAEA", fontWeight: "600", fontSize: 14, marginBottom: 8 },
  input: {
    backgroundColor: "#242424",
    borderWidth: 1,
    borderColor: "#393939",
    borderRadius: 12,
    color: "#FFFFFF",
    paddingHorizontal: 15,
    paddingVertical: 15,
    fontSize: 16,
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: ORANGE,
    borderRadius: 12,
    minHeight: 54,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  secondaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#454545",
    borderRadius: 12,
  },
  secondaryText: { color: "#F0F0F0", fontSize: 15, fontWeight: "600" },
  backButton: { paddingVertical: 18, alignItems: "center" },
  backText: { color: "#999999" },
  disabled: { opacity: 0.6 },
});
