import { supabase } from '@/lib/supabase';

export type ReportTargetType =
  | 'review'
  | 'comment'
  | 'restaurant_note'
  | 'user';

export type ReportReason =
  | 'spam'
  | 'offensive'
  | 'harassment'
  | 'not_food'
  | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'offensive', label: 'Offensive or inappropriate' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'not_food', label: 'Not about food' },
  { value: 'other', label: 'Something else' },
];

// People whose content the current user shouldn't see: anyone they blocked
// and anyone who blocked them. Cached until a block or unblock.
let hiddenUserIdsPromise: Promise<Set<string>> | null = null;

export function fetchHiddenUserIds() {
  if (!hiddenUserIdsPromise) {
    hiddenUserIdsPromise = (async () => {
      const { data, error } = await supabase.rpc('my_hidden_user_ids');

      if (error) {
        hiddenUserIdsPromise = null;
        console.log('Hidden users error:', error.message);
        return new Set<string>();
      }

      return new Set((data ?? []) as string[]);
    })();
  }

  return hiddenUserIdsPromise;
}

// Drops items written by hidden users.
export async function withoutHiddenUsers<T>(
  items: T[],
  getUserId: (item: T) => string | null | undefined
) {
  const hidden = await fetchHiddenUserIds();

  if (hidden.size === 0) {
    return items;
  }

  return items.filter((item) => {
    const userId = getUserId(item);
    return !userId || !hidden.has(userId);
  });
}

export async function blockUser(userId: string) {
  const { error } = await supabase.rpc('block_user', { p_user_id: userId });

  if (error) {
    throw new Error(error.message);
  }

  hiddenUserIdsPromise = null;
}

export async function unblockUser(userId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in.');
  }

  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', userId);

  if (error) {
    throw new Error(error.message);
  }

  hiddenUserIdsPromise = null;
}

// Returns false if this user already reported this item.
export async function reportContent(report: {
  targetType: ReportTargetType;
  targetId: string;
  reportedUserId: string | null;
  reason: ReportReason;
}) {
  const { error } = await supabase.from('reports').insert({
    target_type: report.targetType,
    target_id: report.targetId,
    reported_user_id: report.reportedUserId,
    reason: report.reason,
  });

  // 23505 = unique violation: already reported by this user.
  if (error?.code === '23505') {
    return false;
  }

  if (error) {
    throw new Error(error.message);
  }

  return true;
}
