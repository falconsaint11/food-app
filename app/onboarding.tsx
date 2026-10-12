import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
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

import { supabase } from "@/lib/supabase";

const ORANGE = "#FF5722";
const TOTAL_STEPS = 6;

type FoundUser = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
};

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [existingAvatarPath, setExistingAvatarPath] = useState<string | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<FoundUser[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let active = true;

    async function restoreProgress() {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError || !user) throw authError ?? new Error("Please sign in.");
        if (!active) return;
        setMyId(user.id);

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select(
            "username, display_name, bio, city, avatar_path, onboarding_completed",
          )
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!active) return;

        if (profile?.onboarding_completed) {
          router.replace("/(tabs)");
          return;
        }
        if (profile) {
          setUsername(profile.username ?? "");
          setDisplayName(profile.display_name ?? "");
          setBio(profile.bio ?? "");
          setCity(profile.city ?? "");
          setExistingAvatarPath(profile.avatar_path ?? null);
          // Profile basics are already saved; continue with optional setup.
          setStep(2);
        }
      } catch (error) {
        if (active) Alert.alert("Setup error", readableError(error));
      } finally {
        if (active) setInitializing(false);
      }
    }

    restoreProgress();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (step !== 4 || !myId) return;
    let active = true;
    async function loadFollowing() {
      const { data, error } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", myId);
      if (error) {
        if (active) Alert.alert("Follow error", error.message);
        return;
      }
      if (active) setFollowingIds((data ?? []).map((row) => row.following_id));
    }
    loadFollowing();
    return () => {
      active = false;
    };
  }, [step, myId]);

  useEffect(() => {
    if (step !== 4 || !myId) return;
    const query = search.trim().replace(/[^a-zA-Z0-9_]/g, "");
    if (query.length < 2) {
      setPeople([]);
      setSearching(false);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_path")
        .ilike("username", `%${query}%`)
        .neq("id", myId)
        .limit(15);
      if (!active) return;
      setSearching(false);
      if (error) {
        Alert.alert("Search error", error.message);
        return;
      }
      setPeople((data ?? []) as FoundUser[]);
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, step, myId]);

  function readableError(error: unknown) {
    return error instanceof Error ? error.message : "Something went wrong.";
  }

  async function saveBasics() {
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) {
      Alert.alert(
        "Invalid username",
        "Use 3–24 letters, numbers, or underscores.",
      );
      setStep(0);
      return;
    }
    setBusy(true);
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user)
        throw authError ?? new Error("Please sign in first.");
      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          username: cleanUsername,
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
          onboarding_completed: false,
        },
        { onConflict: "id" },
      );
      if (error) throw error;
      setMyId(user.id);
      setStep(2);
    } catch (error) {
      Alert.alert("Profile error", readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Photo permission needed",
        "Allow photo library access to choose a profile picture.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  async function savePhotoAndContinue() {
    if (!photoUri) {
      setStep(3);
      return;
    }
    if (!myId) {
      Alert.alert("Error", "Please sign in again.");
      return;
    }
    setBusy(true);
    let newPath: string | null = null;
    try {
      const rawExtension = photoUri
        .split(".")
        .pop()
        ?.toLowerCase()
        .split("?")[0];
      const extension =
        rawExtension === "png"
          ? "png"
          : rawExtension === "webp"
            ? "webp"
            : "jpg";
      const contentType =
        extension === "png"
          ? "image/png"
          : extension === "webp"
            ? "image/webp"
            : "image/jpeg";
      newPath = `${myId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const response = await fetch(photoUri);
      const buffer = await response.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from("profile-photos")
        .upload(newPath, buffer, { contentType, upsert: false });
      if (uploadError) throw uploadError;
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_path: newPath })
        .eq("id", myId);
      if (updateError) {
        await supabase.storage.from("profile-photos").remove([newPath]);
        throw updateError;
      }
      setExistingAvatarPath(newPath);
      setPhotoUri(null);
      setStep(3);
    } catch (error) {
      Alert.alert("Photo upload error", readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveCityAndContinue() {
    if (!myId) {
      Alert.alert("Error", "Please sign in again.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ city: city.trim() || null })
        .eq("id", myId);
      if (error) throw error;
      setStep(4);
    } catch (error) {
      Alert.alert("City error", readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleFollow(targetId: string) {
    if (!myId || busy) return;
    setBusy(true);
    try {
      if (followingIds.includes(targetId)) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", myId)
          .eq("following_id", targetId);
        if (error) throw error;
        setFollowingIds((ids) => ids.filter((id) => id !== targetId));
      } else {
        const { error } = await supabase.from("follows").insert({
          follower_id: myId,
          following_id: targetId,
        });
        if (error) throw error;
        setFollowingIds((ids) => [...ids, targetId]);
      }
    } catch (error) {
      Alert.alert("Follow error", readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!myId) {
      Alert.alert("Error", "Please sign in again.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ onboarding_completed: true })
        .eq("id", myId);
      if (error) throw error;
      router.replace("/(tabs)");
    } catch (error) {
      Alert.alert("Could not finish setup", readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Sign out error", error.message);
  }

  const avatarUrl = existingAvatarPath
    ? supabase.storage.from("profile-photos").getPublicUrl(existingAvatarPath)
        .data.publicUrl
    : null;
  const shownAvatar = photoUri ?? avatarUrl;

  if (initializing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={ORANGE} />
      </View>
    );
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
              { width: `${((step + 1) / TOTAL_STEPS) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.stepLabel}>
          STEP {step + 1} OF {TOTAL_STEPS}
        </Text>

        {step === 0 && (
          <>
            <Text style={styles.title}>Claim your username</Text>
            <Text style={styles.subtitle}>
              This is how your friends will find you on Wotri.
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
              disabled={busy}
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
        )}

        {step === 1 && (
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
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={60}
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
              onPress={saveBasics}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Save & continue</Text>
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

        {step === 2 && (
          <>
            <Text style={styles.title}>Add a profile photo</Text>
            <Text style={styles.subtitle}>
              Help friends recognize you. You can always add one later.
            </Text>
            <TouchableOpacity
              onPress={pickPhoto}
              disabled={busy}
              style={styles.photoSelector}
            >
              {shownAvatar ? (
                <Image source={{ uri: shownAvatar }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarPlaceholderText}>+</Text>
                </View>
              )}
              <Text style={styles.photoLabel}>
                {shownAvatar ? "Change photo" : "Choose a photo"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, busy && styles.disabled]}
              onPress={savePhotoAndContinue}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => setStep(3)}
              disabled={busy}
            >
              <Text style={styles.linkText}>Skip for now</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 3 && (
          <>
            <Text style={styles.title}>What's your home city?</Text>
            <Text style={styles.subtitle}>
              Tell people where you're eating. This is optional and can be
              changed later.
            </Text>
            <Text style={styles.label}>City</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Tucson, AZ"
              placeholderTextColor="#777"
              value={city}
              onChangeText={setCity}
              maxLength={100}
              editable={!busy}
            />
            <TouchableOpacity
              style={[styles.button, busy && styles.disabled]}
              onPress={saveCityAndContinue}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => setStep(2)}
              disabled={busy}
            >
              <Text style={styles.linkText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 4 && (
          <>
            <Text style={styles.title}>Find your friends</Text>
            <Text style={styles.subtitle}>
              Follow people to see what they're eating. You can skip this for
              now.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Search usernames..."
              placeholderTextColor="#777"
              autoCapitalize="none"
              autoCorrect={false}
              value={search}
              onChangeText={setSearch}
            />
            {searching && <ActivityIndicator color={ORANGE} />}
            {people.map((person) => {
              const isFollowing = followingIds.includes(person.id);
              return (
                <View key={person.id} style={styles.personRow}>
                  <View style={styles.personText}>
                    <Text style={styles.personName}>
                      {person.display_name || person.username}
                    </Text>
                    <Text style={styles.personHandle}>@{person.username}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.followButton,
                      isFollowing && styles.followingButton,
                    ]}
                    disabled={busy}
                    onPress={() => toggleFollow(person.id)}
                  >
                    <Text
                      style={[
                        styles.followText,
                        isFollowing && styles.followingText,
                      ]}
                    >
                      {isFollowing ? "Following" : "Follow"}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            {!searching && search.trim().length >= 2 && people.length === 0 && (
              <Text style={styles.hint}>No matching usernames found.</Text>
            )}
            <TouchableOpacity
              style={styles.button}
              onPress={() => setStep(5)}
              disabled={busy}
            >
              <Text style={styles.buttonText}>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => setStep(3)}
              disabled={busy}
            >
              <Text style={styles.linkText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 5 && (
          <>
            <View style={styles.doneIcon}>
              <Text style={styles.doneIconText}>✓</Text>
            </View>
            <Text style={styles.title}>You're all set!</Text>
            <Text style={styles.subtitle}>
              Your Wotri profile is ready. Discover your next favorite dish and
              start your food diary.
            </Text>
            <TouchableOpacity
              style={[styles.button, busy && styles.disabled]}
              onPress={finish}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Explore Wotri</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => setStep(4)}
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
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#121212",
  },
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
    marginBottom: 15,
  },
  progressFill: { height: 5, backgroundColor: ORANGE },
  stepLabel: {
    color: "#999",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 24,
    letterSpacing: 1.3,
  },
  title: { color: "#FFF", fontSize: 30, fontWeight: "800", marginBottom: 12 },
  subtitle: {
    color: "#B2B2B2",
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 32,
  },
  label: { color: "#EAEAEA", fontSize: 14, fontWeight: "600", marginBottom: 8 },
  input: {
    color: "#FFF",
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
  hint: { color: "#999", fontSize: 12, marginTop: -9, marginBottom: 25 },
  button: {
    minHeight: 54,
    backgroundColor: ORANGE,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  linkButton: { alignItems: "center", padding: 20 },
  linkText: { color: "#E7E7E7", fontWeight: "600" },
  signOutButton: { alignItems: "center", marginTop: 28, padding: 10 },
  signOutText: { color: "#9A9A9A", fontSize: 13 },
  photoSelector: { alignItems: "center", marginBottom: 20 },
  avatar: { width: 120, height: 120, borderRadius: 60, marginBottom: 15 },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderColor: ORANGE,
    borderWidth: 2,
    backgroundColor: "#242424",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
  },
  avatarPlaceholderText: { color: ORANGE, fontSize: 46 },
  photoLabel: { color: ORANGE, fontWeight: "700" },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#343434",
    paddingVertical: 12,
  },
  personText: { flex: 1 },
  personName: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  personHandle: { color: "#AAA", fontSize: 13, marginTop: 3 },
  followButton: {
    backgroundColor: ORANGE,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 9,
  },
  followingButton: {
    backgroundColor: "#2B2B2B",
    borderColor: "#555",
    borderWidth: 1,
  },
  followText: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  followingText: { color: "#DDD" },
  doneIcon: {
    backgroundColor: "#242424",
    borderRadius: 40,
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 25,
  },
  doneIconText: { color: ORANGE, fontSize: 44, fontWeight: "700" },
});
