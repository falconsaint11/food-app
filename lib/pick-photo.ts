import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

async function choosePhoto(source: 'camera' | 'library') {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    Alert.alert(
      source === 'camera'
        ? 'Camera permission needed'
        : 'Photo permission needed',
      source === 'camera'
        ? 'Allow camera access to take a photo.'
        : 'Allow photo access to add a photo.'
    );

    return null;
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.8,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  return result.canceled ? null : result.assets[0].uri;
}

// Asks camera or library, then returns the photo's local uri, or null if the
// user cancels.
export function pickPhoto(title = 'Add a photo'): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      undefined,
      [
        {
          text: 'Take photo',
          onPress: () => choosePhoto('camera').then(resolve),
        },
        {
          text: 'Choose from library',
          onPress: () => choosePhoto('library').then(resolve),
        },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}
