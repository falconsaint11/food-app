import {
  Tabs,
  useSegments,
} from 'expo-router';
import {
  useEffect,
  useState,
} from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getUnreadNotificationCount } from '@/lib/notifications';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  const themeColors =
    colorScheme === 'dark'
      ? Colors.dark
      : Colors.light;

  const segments = useSegments();

  const [unreadCount, setUnreadCount] =
    useState(0);

  useEffect(() => {
    loadUnreadCount();
  }, [segments]);

  async function loadUnreadCount() {
    try {
      const count =
        await getUnreadNotificationCount();

      setUnreadCount(count);
    } catch (error) {
      console.log(
        'Unread notification error:',
        error
      );
    }
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: themeColors.tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <IconSymbol
              size={28}
              name="house.fill"
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color }) => (
            <IconSymbol
              size={28}
              name="magnifyingglass"
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="log"
        options={{
          title: 'Log',
          tabBarIcon: ({ color }) => (
            <IconSymbol
              size={30}
              name="plus.circle.fill"
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',

          tabBarBadge:
            unreadCount > 0
              ? unreadCount > 99
                ? '99+'
                : unreadCount
              : undefined,

          tabBarIcon: ({ color }) => (
            <IconSymbol
              size={28}
              name="heart.fill"
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <IconSymbol
              size={28}
              name="person.fill"
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}