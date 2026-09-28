import { Stack, useRouter, useSegments } from "expo-router";

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";

import { StatusBar } from "expo-status-bar";

import { useEffect, useState } from "react";

import { ActivityIndicator, View } from "react-native";

import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { supabase } from "@/lib/supabase";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const router = useRouter();
  const segments = useSegments();

  const [session, setSession] = useState<any>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setSession(session);
      setLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }

    const onAuthScreen = segments[0] === "auth";

    if (!session && !onAuthScreen) {
      router.replace("/auth");
      return;
    }

    if (session && onAuthScreen) {
      router.replace("/(tabs)");
    }
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#ffffff",
        }}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
          }}
        />

        <Stack.Screen
          name="auth"
          options={{
            headerShown: false,
          }}
        />

        <Stack.Screen
          name="modal"
          options={{
            presentation: "modal",
            title: "Modal",
          }}
        />

        <Stack.Screen
          name="rank-restaurants"
          options={{
            title: "Rank Restaurants",
          }}
        />
      </Stack>

      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
