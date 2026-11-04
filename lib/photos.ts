import { supabase } from '@/lib/supabase';

// Uploads a photo from the device to the user's folder in the review-photos
// bucket ("<user id>/<file>", so account deletion can remove it) and returns
// its path.
export async function uploadPhoto(uri: string, userId: string) {
  const uriParts = uri.split('.');
  const rawExtension = uriParts[uriParts.length - 1]?.toLowerCase();
  const extension =
    rawExtension === 'png' ? 'png' : rawExtension === 'webp' ? 'webp' : 'jpg';
  const contentType =
    extension === 'png'
      ? 'image/png'
      : extension === 'webp'
        ? 'image/webp'
        : 'image/jpeg';

  const filePath = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;

  const response = await fetch(uri);
  const arrayBuffer = await response.arrayBuffer();

  const { error } = await supabase.storage
    .from('review-photos')
    .upload(filePath, arrayBuffer, { contentType, upsert: false });

  if (error) {
    throw new Error(error.message);
  }

  return filePath;
}
