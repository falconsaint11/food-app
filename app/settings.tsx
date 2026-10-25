import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import { unblockUser } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';

// The word users type to confirm deleting their account.
const DELETE_CONFIRMATION = 'DELETE';

const MIN_PASSWORD_LENGTH = 8;

type OpenForm = 'email' | 'password' | null;

type BlockedUser = {
  id: string;
  name: string;
  username: string;
};

// Removes every file in the user's folder of a storage bucket. Photos are
// stored as `<user id>/<file>` in both review-photos and profile-photos.
async function removeUserFolder(bucket: string, userId: string) {
  const { data: files, error } = await supabase.storage
    .from(bucket)
    .list(userId, { limit: 1000 });

  if (error) {
    throw new Error(error.message);
  }

  if (!files || files.length === 0) {
    return;
  }

  const { data: removed, error: removeError } = await supabase.storage
    .from(bucket)
    .remove(files.map((file) => `${userId}/${file.name}`));

  if (removeError) {
    throw new Error(removeError.message);
  }

  // Storage skips files the user isn't allowed to delete without an error,
  // so check nothing was left behind.
  if ((removed ?? []).length < files.length) {
    throw new Error('Some of your photos could not be deleted.');
  }
}

// People the current user blocked, newest first. Only the user's own blocks
// are visible to them.
async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const { data: blocks, error } = await supabase
    .from('blocks')
    .select('blocked_id')
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Blocked users error:', error.message);
    return [];
  }

  const ids = (blocks ?? []).map((row) => row.blocked_id as string);

  if (ids.length === 0) {
    return [];
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', ids);

  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return ids.map((id) => {
    const profile = byId.get(id);

    return {
      id,
      name: profile?.display_name || profile?.username || 'Deleted user',
      username: profile?.username ?? '',
    };
  });
}

export default function SettingsScreen() {
  const [email, setEmail] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  async function unblock(userId: string) {
    setUnblockingId(userId);

    try {
      await unblockUser(userId);
      setBlockedUsers((current) => current.filter((user) => user.id !== userId));
    } catch (error) {
      Alert.alert(
        'Could not unblock',
        error instanceof Error ? error.message : 'Something went wrong.'
      );
    } finally {
      setUnblockingId(null);
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });

    let cancelled = false;

    fetchBlockedUsers().then((users) => {
      if (!cancelled) setBlockedUsers(users);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleForm(form: Exclude<OpenForm, null>) {
    setOpenForm((current) => (current === form ? null : form));
    setNewEmail('');
    setNewPassword('');
    setConfirmPassword('');
  }

  async function saveEmail() {
    const trimmed = newEmail.trim();

    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      Alert.alert('Check your email', 'Enter a valid email address.');
      return;
    }

    setSaving(true);

    const { error } = await supabase.auth.updateUser({ email: trimmed });

    setSaving(false);

    if (error) {
      Alert.alert('Could not change email', error.message);
      return;
    }

    setOpenForm(null);

    // Supabase emails a confirmation link; the change applies once it's opened.
    Alert.alert(
      'Confirm your new email',
      `We sent a link to ${trimmed}. Your email changes once you open it.`
    );
  }

  async function savePassword() {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      Alert.alert(
        'Password too short',
        `Use at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords don’t match', 'Type the same password twice.');
      return;
    }

    setSaving(true);

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    setSaving(false);

    if (error) {
      Alert.alert('Could not change password', error.message);
      return;
    }

    setOpenForm(null);
    Alert.alert('Password changed', 'Use your new password next time.');
  }

  function confirmLogOut() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.auth.signOut();

          if (error) {
            Alert.alert('Log out error', error.message);
          }
        },
      },
    ]);
  }

  async function deleteAccount() {
    if (deleteText.trim().toUpperCase() !== DELETE_CONFIRMATION) {
      return;
    }

    setDeleting(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('You must be signed in.');

      // Files first: once the account is gone, the user can no longer
      // remove their own uploads.
      await removeUserFolder('review-photos', user.id);
      await removeUserFolder('profile-photos', user.id);

      // Deletes the user's data and their login (see the
      // delete_my_account SQL function).
      const { error } = await supabase.rpc('delete_my_account');

      if (error) throw new Error(error.message);

      setDeleteOpen(false);

      // The session belongs to a deleted user; clear it locally. The root
      // layout sends signed-out users to the sign-in screen.
      await supabase.auth.signOut({ scope: 'local' });

      Alert.alert('Account deleted', 'Your account and data have been removed.');
    } catch (error) {
      Alert.alert(
        'Could not delete account',
        error instanceof Error ? error.message : 'Something went wrong.'
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: 'Settings' }} />

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>Account</Text>

        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => toggleForm('email')}
          >
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowHint} numberOfLines={1}>
              {email ?? ''} {openForm === 'email' ? '⌃' : '›'}
            </Text>
          </TouchableOpacity>

          {openForm === 'email' ? (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="New email"
                placeholderTextColor={Palette.textMuted}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={newEmail}
                onChangeText={setNewEmail}
              />

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.disabled]}
                onPress={saveEmail}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : 'Change email'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.row, styles.lastRow]}
            onPress={() => toggleForm('password')}
          >
            <Text style={styles.rowLabel}>Password</Text>
            <Text style={styles.rowHint}>
              Change {openForm === 'password' ? '⌃' : '›'}
            </Text>
          </TouchableOpacity>

          {openForm === 'password' ? (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor={Palette.textMuted}
                secureTextEntry
                autoComplete="new-password"
                value={newPassword}
                onChangeText={setNewPassword}
              />

              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={Palette.textMuted}
                secureTextEntry
                autoComplete="new-password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.disabled]}
                onPress={savePassword}
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : 'Change password'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <Text style={[styles.sectionTitle, styles.privacyTitle]}>Privacy</Text>

        <View style={styles.group}>
          <TouchableOpacity
            style={[styles.row, styles.lastRow]}
            onPress={() => setShowBlocked((open) => !open)}
          >
            <Text style={styles.rowLabel}>Blocked users</Text>
            <Text style={styles.rowHint}>
              {blockedUsers.length} {showBlocked ? '⌃' : '›'}
            </Text>
          </TouchableOpacity>

          {showBlocked ? (
            <View style={styles.form}>
              {blockedUsers.length === 0 ? (
                <Text style={styles.emptyText}>
                  You haven’t blocked anyone. Block someone from the ⋯ menu on
                  their profile or posts.
                </Text>
              ) : (
                blockedUsers.map((user) => (
                  <View key={user.id} style={styles.blockedRow}>
                    <View style={styles.blockedInfo}>
                      <Text style={styles.rowLabel}>{user.name}</Text>
                      {user.username ? (
                        <Text style={styles.blockedHandle}>@{user.username}</Text>
                      ) : null}
                    </View>

                    <TouchableOpacity
                      onPress={() => unblock(user.id)}
                      disabled={unblockingId === user.id}
                    >
                      <Text style={styles.unblockText}>
                        {unblockingId === user.id ? 'Unblocking...' : 'Unblock'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>

        <TouchableOpacity style={styles.logOutButton} onPress={confirmLogOut}>
          <Text style={styles.logOutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, styles.dangerTitle]}>
          Danger zone
        </Text>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => {
            setDeleteText('');
            setDeleteOpen(true);
          }}
        >
          <Text style={styles.deleteButtonText}>Delete account</Text>
        </TouchableOpacity>

        <Text style={styles.deleteHint}>
          Permanently deletes your profile, reviews, photos, lists, ratings and
          follows. This can’t be undone.
        </Text>
      </ScrollView>

      <Modal
        visible={deleteOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (!deleting) setDeleteOpen(false);
          }}
        />

        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Delete your account?</Text>

          <Text style={styles.sheetText}>
            Your profile, reviews, photos, lists, rankings, restaurant ratings
            and follows will be permanently deleted. Type {DELETE_CONFIRMATION}{' '}
            to confirm.
          </Text>

          <TextInput
            style={styles.input}
            placeholder={DELETE_CONFIRMATION}
            placeholderTextColor={Palette.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            value={deleteText}
            onChangeText={setDeleteText}
            editable={!deleting}
          />

          <TouchableOpacity
            style={[
              styles.confirmDeleteButton,
              (deleteText.trim().toUpperCase() !== DELETE_CONFIRMATION ||
                deleting) &&
                styles.disabled,
            ]}
            onPress={deleteAccount}
            disabled={
              deleteText.trim().toUpperCase() !== DELETE_CONFIRMATION ||
              deleting
            }
          >
            {deleting ? (
              <ActivityIndicator color={Palette.text} />
            ) : (
              <Text style={styles.confirmDeleteText}>
                Permanently delete account
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setDeleteOpen(false)}
            disabled={deleting}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  container: {
    padding: 24,
    paddingBottom: 60,
  },
  sectionTitle: {
    color: Palette.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  group: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowLabel: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rowHint: {
    flexShrink: 1,
    color: Palette.textMuted,
    fontSize: 14,
    marginLeft: 16,
  },
  form: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  input: {
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: Palette.text,
    marginBottom: 10,
  },
  saveButton: {
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveButtonText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  privacyTitle: {
    marginTop: 28,
  },
  emptyText: {
    color: Palette.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  blockedInfo: {
    flex: 1,
    paddingRight: 12,
  },
  blockedHandle: {
    color: Palette.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  unblockText: {
    color: Palette.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  logOutButton: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  logOutText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  dangerTitle: {
    marginTop: 40,
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: Palette.danger,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: Palette.danger,
    fontSize: 16,
    fontWeight: '600',
  },
  deleteHint: {
    color: Palette.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    backgroundColor: Palette.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 24,
    paddingBottom: 40,
  },
  sheetTitle: {
    color: Palette.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
  },
  sheetText: {
    color: Palette.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 16,
  },
  confirmDeleteButton: {
    backgroundColor: Palette.danger,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  confirmDeleteText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    color: Palette.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
