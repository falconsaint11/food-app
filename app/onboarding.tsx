import { supabase } from "@/lib/supabase";
import { router } from "expo-router";
import { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

const ORANGE = "#FF5722";

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);

  async function complete() {
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) {
      Alert.alert(
        "Choose a username",
        "Use 3–24 letters, numbers, or underscores.",
      );
      setStep(0);
      return;
    }
    setBusy(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user)
        throw userError || new Error("Please sign in first.");
      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          username: cleanUsername,
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
          onboarding_completed: true,
        },
        { onConflict: "id" },
      );
      if (error) throw error;
      router.replace("/(tabs)");
    } catch (error) {
      Alert.alert(
        "Could not finish setup",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Sign out error", error.message);
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
        <Text style={styles.brand}>wotri.</Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: step === 0 ? "50%" : "100%" },
            ]}
          />
        </View>
        {step === 0 ? (
          <>
            <Text style={styles.title}>Claim your username</Text>
            <Text style={styles.subtitle}>
              This is how friends will find you on Wotri.
            </Text>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              placeholder="your_username"
              placeholderTextColor="#777"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
              value={username}
              onChangeText={setUsername}
              editable={!busy}
            />
            <Text style={styles.hint}>
              3–24 characters. Letters, numbers, and underscores.
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                if (!/^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase())) {
                  Alert.alert(
                    "Invalid username",
                    "Use 3–24 letters, numbers, or underscores.",
                  );
                  return;
                }
                setStep(1);
              }}
            >
              <Text style={styles.buttonText}>Continue</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Make it yours</Text>
            <Text style={styles.subtitle}>
              Add a display name and bio. Both are optional.
            </Text>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              placeholder="What should we call you?"
              placeholderTextColor="#777"
              maxLength={60}
              value={displayName}
              onChangeText={setDisplayName}
              editable={!busy}
            />
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.bio]}
              placeholder="A little about your food taste..."
              placeholderTextColor="#777"
              multiline
              maxLength={240}
              value={bio}
              onChangeText={setBio}
              editable={!busy}
            />
            <TouchableOpacity
              style={[styles.button, busy && styles.disabled]}
              onPress={complete}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Finish & explore Wotri</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => setStep(0)}
              disabled={busy}
            >
              <Text style={styles.linkText}>Back</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={signOut}
          disabled={busy}
        >
          <Text style={styles.signOutText}>Use a different account</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#121212" },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 28,
    paddingBottom: 50,
  },
  brand: { color: ORANGE, fontWeight: "800", fontSize: 27, marginBottom: 25 },
  progressTrack: {
    height: 5,
    backgroundColor: "#343434",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 36,
  },
  progressFill: { height: 5, backgroundColor: ORANGE },
  title: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 12,
  },
  subtitle: {
    color: "#B2B2B2",
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 32,
  },
  label: { color: "#EAEAEA", fontSize: 14, fontWeight: "600", marginBottom: 8 },
  input: {
    color: "#FFFFFF",
    backgroundColor: "#242424",
    borderColor: "#393939",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 15,
    fontSize: 16,
    marginBottom: 18,
  },
  bio: { minHeight: 110, textAlignVertical: "top" },
  hint: { color: "#999999", fontSize: 12, marginTop: -9, marginBottom: 25 },
  button: {
    minHeight: 54,
    backgroundColor: ORANGE,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  linkButton: { alignItems: "center", padding: 20 },
  linkText: { color: "#E7E7E7", fontWeight: "600" },
  signOutButton: { alignItems: "center", marginTop: 28, padding: 10 },
  signOutText: { color: "#9A9A9A", fontSize: 13 },
  disabled: { opacity: 0.6 },
});
