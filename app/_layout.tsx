import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { Stack, useRouter, useSegments } from "expo-router";
import { DarkTheme, ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import "react-native-reanimated";

const wotriTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#FF5722",
    background: "#121212",
    card: "#1D1D1D",
    text: "#FFFFFF",
    border: "#343434",
    notification: "#FF5722",
  },
};

function checkProfile(userId: string) {
  return supabase
    .from("profiles")
    .select("id, onboarding_completed")
    .eq("id", userId)
    .maybeSingle();
}

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bumped by "Try again" to rerun the profile check.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!active) return;
      if (error) setErrorMessage(error.message);
      setSession(session);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setErrorMessage(null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    async function redirect() {
      const location = segments[0];
      if (!session) {
        setErrorMessage(null);
        if (location !== "auth") router.replace("/auth");
        return;
      }
      let { data, error } = await checkProfile(session.user.id);
      // "JWT issued at future": a just-refreshed login can look a second
      // early to the database when the servers' clocks differ slightly. It
      // clears up on its own, so wait and retry before showing anything.
      for (
        let retry = 0;
        retry < 5 && error && /future/i.test(error.message);
        retry++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (cancelled) return;
        ({ data, error } = await checkProfile(session.user.id));
      }
      if (cancelled) return;
      if (error) {
        // Still failing after the retries: the phone's clock really is off.
        setErrorMessage(
          /future/i.test(error.message)
            ? "Your phone’s date and time look wrong. Turn on Set Automatically in Settings › General › Date & Time, then try again."
            : "We couldn’t load your profile. Check your connection and try again.",
        );
        return;
      }
      setErrorMessage(null);
      const needsOnboarding = !data || data.onboarding_completed === false;
      if (needsOnboarding && location !== "onboarding")
        router.replace("/onboarding");
      if (
        !needsOnboarding &&
        (location === "auth" || location === "onboarding")
      )
        router.replace("/(tabs)");
    }
    redirect();
    return () => {
      cancelled = true;
    };
  }, [loading, session, segments, router, attempt]);

  if (loading || errorMessage) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#121212",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        {errorMessage ? (
          <>
            <Text
              style={{ color: "#FFFFFF", fontSize: 16, textAlign: "center" }}
            >
              {errorMessage}
            </Text>
            {session ? (
              <TouchableOpacity
                style={{
                  marginTop: 20,
                  backgroundColor: "#FF5722",
                  borderRadius: 12,
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                }}
                onPress={() => {
                  setErrorMessage(null);
                  setAttempt((value) => value + 1);
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>
                  Try again
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          <ActivityIndicator color="#FF5722" size="large" />
        )}
      </View>
    );
  }

  return (
    <ThemeProvider value={wotriTheme}>
      <Stack
        screenOptions={{
          // Just the back arrow, never the previous screen's route name.
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: "#1D1D1D" },
          headerTintColor: "#FFFFFF",
          contentStyle: { backgroundColor: "#121212" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="compare" options={{ title: "Which Was Better?" }} />
        <Stack.Screen name="rank-dishes" options={{ title: "Top Dishes" }} />
        <Stack.Screen
          name="rank-restaurants"
          options={{ title: "Top Restaurants" }}
        />
        <Stack.Screen name="dish-edit" options={{ title: "Edit Dish" }} />
        <Stack.Screen name="restaurant/[id]" options={{ title: "" }} />
        <Stack.Screen
          name="restaurant-photo/[id]"
          options={{ title: "Photo" }}
        />
        <Stack.Screen name="dish/[id]" options={{ title: "" }} />
        <Stack.Screen name="review/[id]" options={{ title: "Review" }} />
        <Stack.Screen
          name="review/edit/[id]"
          options={{ title: "Edit Review" }}
        />
        <Stack.Screen name="user/[id]" options={{ title: "" }} />
        <Stack.Screen name="profile" options={{ title: "Profile" }} />
        <Stack.Screen name="edit-profile" options={{ title: "Edit Profile" }} />
        <Stack.Screen
          name="create-profile"
          options={{ title: "Create Profile" }}
        />
        <Stack.Screen name="diary" options={{ title: "Diary" }} />
        <Stack.Screen name="followers" options={{ title: "Followers" }} />
        <Stack.Screen name="following" options={{ title: "Following" }} />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
