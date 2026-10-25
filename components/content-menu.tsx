import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import { Palette } from '@/constants/theme';
import {
  blockUser,
  REPORT_REASONS,
  ReportReason,
  reportContent,
  ReportTargetType,
} from '@/lib/moderation';
import { supabase } from '@/lib/supabase';

type ContentMenuProps = {
  targetType: ReportTargetType;
  targetId: string;
  // Who posted it (or the profile's user). The menu hides on your own content.
  authorId: string | null;
  authorName: string;
  // Called after blocking, so the screen can hide the content or leave.
  onBlocked?: () => void;
  style?: StyleProp<ViewStyle>;
};

type Step = 'menu' | 'report' | 'block' | 'reported';

const TARGET_LABELS: Record<ReportTargetType, string> = {
  review: 'review',
  comment: 'comment',
  restaurant_note: 'note',
  user: 'profile',
};

// "⋯" button with Report and Block, for anything another user posted.
export function ContentMenu({
  targetType,
  targetId,
  authorId,
  authorName,
  onBlocked,
  style,
}: ContentMenuProps) {
  const [myId, setMyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setMyId(session?.user.id ?? null);
    });
  }, []);

  if (!authorId || authorId === myId) {
    return null;
  }

  function openMenu() {
    setStep('menu');
    setOpen(true);
  }

  async function submitReport(reason: ReportReason) {
    setBusy(true);

    try {
      await reportContent({
        targetType,
        targetId,
        reportedUserId: authorId,
        reason,
      });

      // Already-reported items get the same thanks; no need to say so.
      setStep('reported');
    } catch (error) {
      Alert.alert(
        'Could not send report',
        error instanceof Error ? error.message : 'Something went wrong.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmBlock() {
    if (!authorId) return;

    setBusy(true);

    try {
      await blockUser(authorId);
      setOpen(false);
      onBlocked?.();
    } catch (error) {
      Alert.alert(
        'Could not block',
        error instanceof Error ? error.message : 'Something went wrong.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, style]}
        onPress={openMenu}
        hitSlop={10}
        accessibilityLabel="More options"
      >
        <Text style={styles.triggerText}>⋯</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (!busy) setOpen(false);
          }}
        />

        <View style={styles.sheet}>
          {step === 'menu' ? (
            <>
              <TouchableOpacity
                style={styles.option}
                onPress={() => setStep('report')}
              >
                <Text style={styles.optionText}>
                  Report {TARGET_LABELS[targetType]}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.option}
                onPress={() => setStep('block')}
              >
                <Text style={[styles.optionText, styles.danger]}>
                  Block {authorName}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}

          {step === 'report' ? (
            <>
              <Text style={styles.title}>Why are you reporting this?</Text>

              {busy ? (
                <ActivityIndicator style={styles.busy} />
              ) : (
                REPORT_REASONS.map((reason) => (
                  <TouchableOpacity
                    key={reason.value}
                    style={styles.option}
                    onPress={() => submitReport(reason.value)}
                  >
                    <Text style={styles.optionText}>{reason.label}</Text>
                  </TouchableOpacity>
                ))
              )}
            </>
          ) : null}

          {step === 'reported' ? (
            <>
              <Text style={styles.title}>Thanks for letting us know</Text>

              <Text style={styles.body}>
                We’ll review this. You can also block {authorName} so you
                don’t see their posts.
              </Text>

              <TouchableOpacity
                style={styles.option}
                onPress={() => setStep('block')}
              >
                <Text style={[styles.optionText, styles.danger]}>
                  Block {authorName}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}

          {step === 'block' ? (
            <>
              <Text style={styles.title}>Block {authorName}?</Text>

              <Text style={styles.body}>
                You won’t see each other’s posts, comments or profiles, and
                you’ll unfollow each other. They won’t be told. You can unblock
                them in Settings.
              </Text>

              <TouchableOpacity
                style={[styles.blockButton, busy && styles.disabled]}
                onPress={confirmBlock}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color={Palette.text} />
                ) : (
                  <Text style={styles.blockButtonText}>Block</Text>
                )}
              </TouchableOpacity>
            </>
          ) : null}

          <TouchableOpacity
            style={styles.cancel}
            onPress={() => setOpen(false)}
            disabled={busy}
          >
            <Text style={styles.cancelText}>
              {step === 'reported' ? 'Done' : 'Cancel'}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    paddingHorizontal: 6,
  },
  triggerText: {
    color: Palette.textMuted,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
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
  title: {
    color: Palette.text,
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 10,
  },
  body: {
    color: Palette.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 12,
  },
  option: {
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  optionText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  danger: {
    color: Palette.danger,
  },
  busy: {
    marginVertical: 24,
  },
  blockButton: {
    backgroundColor: Palette.danger,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  blockButtonText: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  cancel: {
    paddingTop: 16,
    alignItems: 'center',
  },
  cancelText: {
    color: Palette.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
