import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
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
} from 'react-native';

import { supabase } from '@/lib/supabase';

export default function EditProfileScreen() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');

  const [originalAvatarPath, setOriginalAvatarPath] = useState<
    string | null
  >(null);

  const [newPhotoUri, setNewPhotoUri] = useState<string | null>(null);

  const [removePhoto, setRemovePhoto] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  function getPhotoUrl(path: string) {
    const { data } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async function loadProfile() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setLoading(false);

      Alert.alert(
        'Error',
        'No signed-in user found.'
      );

      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'username, display_name, bio, avatar_path'
      )
      .eq('id', user.id)
      .single();

    setLoading(false);

    if (error) {
      Alert.alert(
        'Profile error',
        error.message
      );

      return;
    }

    setUsername(data.username ?? '');

    setDisplayName(
      data.display_name ?? ''
    );

    setBio(data.bio ?? '');

    setOriginalAvatarPath(
      data.avatar_path ?? null
    );
  }

  async function choosePhoto() {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        'Please allow photo access to choose a profile picture.'
      );

      return;
    }

    const result =
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

    if (result.canceled) {
      return;
    }

    setNewPhotoUri(
      result.assets[0].uri
    );

    setRemovePhoto(false);
  }

  function handleRemovePhoto() {
    setNewPhotoUri(null);
    setRemovePhoto(true);
  }

  async function uploadProfilePhoto(
    userId: string,
    uri: string
  ) {
    const response = await fetch(uri);
    const arrayBuffer =
      await response.arrayBuffer();

    const extension =
      uri.split('.').pop()?.toLowerCase() ||
      'jpg';

    const safeExtension =
      extension.includes('?')
        ? extension.split('?')[0]
        : extension;

    const filePath =
      `${userId}/${Date.now()}.${safeExtension}`;

    const { error } =
      await supabase.storage
        .from('profile-photos')
        .upload(
          filePath,
          arrayBuffer,
          {
            contentType:
              safeExtension === 'png'
                ? 'image/png'
                : 'image/jpeg',
          }
        );

    if (error) {
      throw error;
    }

    return filePath;
  }

  async function saveProfile() {
    if (!username.trim()) {
      Alert.alert(
        'Username required',
        'Please enter a username.'
      );

      return;
    }

    setSaving(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSaving(false);

      Alert.alert(
        'Error',
        'No signed-in user found.'
      );

      return;
    }

    let uploadedPhotoPath:
      | string
      | null = null;

    let finalAvatarPath =
      originalAvatarPath;

    try {
      if (newPhotoUri) {
        uploadedPhotoPath =
          await uploadProfilePhoto(
            user.id,
            newPhotoUri
          );

        finalAvatarPath =
          uploadedPhotoPath;
      }

      if (removePhoto) {
        finalAvatarPath = null;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          username:
            username.trim(),

          display_name:
            displayName.trim() ||
            null,

          bio:
            bio.trim() ||
            null,

          avatar_path:
            finalAvatarPath,
        })
        .eq('id', user.id);

      if (error) {
        if (uploadedPhotoPath) {
          await supabase.storage
            .from('profile-photos')
            .remove([
              uploadedPhotoPath,
            ]);
        }

        throw error;
      }

      const oldPhotoShouldBeDeleted =
        originalAvatarPath &&
        originalAvatarPath !==
          finalAvatarPath;

      if (oldPhotoShouldBeDeleted) {
        const {
          error: deleteError,
        } = await supabase.storage
          .from('profile-photos')
          .remove([
            originalAvatarPath,
          ]);

        if (deleteError) {
          console.log(
            'Could not delete old profile photo:',
            deleteError
          );
        }
      }

      setOriginalAvatarPath(
        finalAvatarPath
      );

      setNewPhotoUri(null);

      setRemovePhoto(false);

      Alert.alert(
        'Success',
        'Your profile was updated.'
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not update your profile.';

      Alert.alert(
        'Update error',
        message
      );
    } finally {
      setSaving(false);
    }
  }

  const previewUri =
    newPhotoUri ??
    (!removePhoto &&
    originalAvatarPath
      ? getPhotoUrl(
          originalAvatarPath
        )
      : null);

  const initial =
    (
      displayName ||
      username ||
      '?'
    )
      .charAt(0)
      .toUpperCase();

  if (loading) {
    return (
      <View
        style={styles.centered}
      >
        <Text>
          Loading profile...
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : 'height'
      }
    >
      <ScrollView
        contentContainerStyle={
          styles.container
        }
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={styles.title}
        >
          Edit Profile
        </Text>

        <View
          style={
            styles.photoSection
          }
        >
          {previewUri ? (
            <Image
              source={{
                uri: previewUri,
              }}
              style={
                styles.avatarImage
              }
            />
          ) : (
            <View
              style={
                styles.avatarFallback
              }
            >
              <Text
                style={
                  styles.avatarFallbackText
                }
              >
                {initial}
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={choosePhoto}
            disabled={saving}
          >
            <Text
              style={
                styles.changePhoto
              }
            >
              {previewUri
                ? 'Change Photo'
                : 'Add Photo'}
            </Text>
          </TouchableOpacity>

          {previewUri ? (
            <TouchableOpacity
              onPress={
                handleRemovePhoto
              }
              disabled={saving}
            >
              <Text
                style={
                  styles.removePhoto
                }
              >
                Remove Photo
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text
          style={styles.label}
        >
          Username
        </Text>

        <TextInput
          style={styles.input}
          autoCapitalize="none"
          value={username}
          onChangeText={
            setUsername
          }
        />

        <Text
          style={styles.label}
        >
          Display Name
        </Text>

        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={
            setDisplayName
          }
        />

        <Text
          style={styles.label}
        >
          Bio
        </Text>

        <TextInput
          style={[
            styles.input,
            styles.bio,
          ]}
          multiline
          value={bio}
          onChangeText={setBio}
        />

        <TouchableOpacity
          style={styles.button}
          onPress={saveProfile}
          disabled={saving}
        >
          <Text
            style={
              styles.buttonText
            }
          >
            {saving
              ? 'Saving...'
              : 'Save Changes'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles =
  StyleSheet.create({
    keyboardView: {
      flex: 1,
    },

    container: {
      flexGrow: 1,
      justifyContent:
        'center',
      padding: 24,
      backgroundColor:
        '#ffffff',
    },

    centered: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        '#ffffff',
    },

    title: {
      fontSize: 30,
      fontWeight: '700',
      marginBottom: 24,
    },

    photoSection: {
      alignItems:
        'center',
      marginBottom: 28,
    },

    avatarImage: {
      width: 110,
      height: 110,
      borderRadius: 55,
      marginBottom: 12,
    },

    avatarFallback: {
      width: 110,
      height: 110,
      borderRadius: 55,
      backgroundColor:
        '#eeeeee',
      alignItems:
        'center',
      justifyContent:
        'center',
      marginBottom: 12,
    },

    avatarFallbackText: {
      fontSize: 38,
      fontWeight: '700',
    },

    changePhoto: {
      fontSize: 15,
      fontWeight: '700',
      marginTop: 2,
    },

    removePhoto: {
      fontSize: 13,
      color: '#cc3333',
      marginTop: 8,
    },

    label: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 6,
    },

    input: {
      borderWidth: 1,
      borderColor:
        '#cccccc',
      borderRadius: 10,
      padding: 14,
      fontSize: 16,
      marginBottom: 14,
    },

    bio: {
      minHeight: 100,
      textAlignVertical:
        'top',
    },

    button: {
      backgroundColor:
        '#111111',
      borderRadius: 10,
      padding: 16,
      alignItems:
        'center',
      marginTop: 8,
    },

    buttonText: {
      color: '#ffffff',
      fontWeight: '600',
      fontSize: 16,
    },
  });