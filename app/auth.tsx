import { openLegalPage } from "@/lib/legal";
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

// forgot: enter your email to get a reset code.
// reset: enter that code and a new password.
type Screen = "welcome" | "signup" | "login" | "forgot" | "reset";

export default function AuthScreen() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  // Emails a password-reset code (the "Reset password" template shows
  // {{ .Token }}). Supabase doesn't say whether the email has an account, so
  // neither do we.
  async function sendResetCode() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@")) {
      Alert.alert("Check your email", "Enter the email you signed up with.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
      if (error) throw error;
      setCode("");
      setPassword("");
      setScreen("reset");
    } catch (error) {
      Alert.alert(
        "Couldn't send the code",
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Checks the code, which signs the user in, then sets the new password.
  // Signing in sends RootLayout on to Home, so the password is checked first.
  async function resetPassword() {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(cleanCode)) {
      Alert.alert("Check the code", "Enter the code from the email.");
      return;
    }
    if (password.length < 6) {
      Alert.alert(
        "Choose a new password",
        "Your new password needs at least 6 characters.",
      );
      return;
    }
    setLoading(true);
    try {
      const { error: codeError } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: "recovery",
      });
      if (codeError) {
        Alert.alert(
          "That code didn't work",
          "It may have expired or been mistyped. Check the email or send a new code.",
        );
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      Alert.alert("Password changed", "You're signed in with your new password.");
    } catch (error) {
      Alert.alert(
        "Couldn't change your password",
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

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
        ) : screen === "forgot" || screen === "reset" ? (
          <>
            <Text style={styles.brand}>wotri.</Text>
            <Text style={styles.title}>
              {screen === "forgot" ? "Reset your password" : "Check your email"}
            </Text>
            <Text style={styles.subtitle}>
              {screen === "forgot"
                ? "Enter the email you signed up with and we'll send you a code."
                : `If ${email.trim().toLowerCase()} has a Wotri account, we sent it a code. Enter it below with a new password.`}
            </Text>
            {screen === "forgot" ? (
              <>
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
              </>
            ) : (
              <>
                <Text style={styles.label}>Code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="123456"
                  placeholderTextColor="#8B8B8B"
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  onChangeText={setCode}
                  editable={!loading}
                />
                <Text style={styles.label}>New password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="At least 6 characters"
                  placeholderTextColor="#8B8B8B"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  value={password}
                  onChangeText={setPassword}
                  editable={!loading}
                />
              </>
            )}
            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.disabled]}
              onPress={screen === "forgot" ? sendResetCode : resetPassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {screen === "forgot" ? "Send code" : "Change password"}
                </Text>
              )}
            </TouchableOpacity>
            {screen === "reset" ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={sendResetCode}
                disabled={loading}
              >
                <Text style={styles.secondaryText}>Send a new code</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setScreen("login")}
              disabled={loading}
            >
              <Text style={styles.backText}>Back to sign in</Text>
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
            {screen === "login" ? (
              <TouchableOpacity
                style={styles.forgotButton}
                onPress={() => setScreen("forgot")}
                disabled={loading}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            ) : null}
            {screen === "signup" ? (
              <Text style={styles.agreeText}>
                By creating an account, you agree to our{" "}
                <Text
                  style={styles.agreeLink}
                  onPress={() => openLegalPage("terms")}
                >
                  Terms of Use
                </Text>{" "}
                and{" "}
                <Text
                  style={styles.agreeLink}
                  onPress={() => openLegalPage("privacy")}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            ) : null}
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
  agreeText: {
    color: "#8B8B8B",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 14,
  },
  agreeLink: { color: "#DADADA", textDecorationLine: "underline" },
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
  forgotButton: { paddingVertical: 14, alignItems: "center" },
  forgotText: { color: "#DADADA", fontSize: 14, fontWeight: "600" },
  backButton: { paddingVertical: 18, alignItems: "center" },
  backText: { color: "#999999" },
  disabled: { opacity: 0.6 },
});
