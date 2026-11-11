import { Image, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type AvatarProps = {
  // "<user id>/<file>" in the profile-photos bucket, or null for none.
  path: string | null | undefined;
  // Display name or username; its first letter shows when there's no photo.
  name: string | null | undefined;
  size: number;
  marginRight?: number;
};

export function profilePhotoUrl(path: string) {
  return supabase.storage.from('profile-photos').getPublicUrl(path).data
    .publicUrl;
}

// A profile photo, or the first letter of the name in a circle.
export function Avatar({ path, name, size, marginRight = 0 }: AvatarProps) {
  const circle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    marginRight,
  };

  if (path) {
    return (
      <Image
        source={{ uri: profilePhotoUrl(path) }}
        style={[styles.base, circle]}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={[styles.base, styles.fallback, circle]}>
      <Text style={[styles.letter, { fontSize: Math.round(size * 0.4) }]}>
        {(name?.trim() || 'U').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Palette.elevated,
  },
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  letter: {
    color: Palette.text,
    fontWeight: '700',
  },
});
