import { supabase } from '@/lib/supabase';

export type NotificationItem = {
  id: string;
  type: 'follow' | 'reaction' | 'comment';
  actorId: string;
  actorName: string;
  actorUsername: string;
  createdAt: string;
  reaction?: string;
  commentText?: string;
  reviewId?: string;
  dishName?: string;
  isRead: boolean;
};

type ActorProfile = {
  username: string;
  display_name: string | null;
};

type FollowRow = {
  id: string;
  follower_id: string;
  created_at: string;
  profiles: ActorProfile | null;
};

type ReactionRow = {
  id: string;
  user_id: string;
  review_id: string;
  reaction: string;
  created_at: string;
  profiles: ActorProfile | null;
  reviews: {
    id: string;
    dishes: {
      name: string;
    } | null;
  } | null;
};

type CommentRow = {
  id: string;
  user_id: string;
  review_id: string;
  comment_text: string;
  created_at: string;
  profiles: ActorProfile | null;
  reviews: {
    id: string;
    dishes: {
      name: string;
    } | null;
  } | null;
};

export async function getNotifications() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('You must be signed in.');
  }

  const { data: followData, error: followError } = await supabase
    .from('follows')
    .select(`
      id,
      follower_id,
      created_at,
      profiles:follower_id (
        username,
        display_name
      )
    `)
    .eq('following_id', user.id);

  if (followError) {
    throw new Error(followError.message);
  }

  const { data: ownReviews, error: reviewError } = await supabase
    .from('reviews')
    .select('id')
    .eq('user_id', user.id);

  if (reviewError) {
    throw new Error(reviewError.message);
  }

  const reviewIds = (ownReviews ?? []).map(
    (review) => review.id
  );

  let reactionData: ReactionRow[] = [];
  let commentData: CommentRow[] = [];

  if (reviewIds.length > 0) {
    const { data: reactions, error: reactionError } =
      await supabase
        .from('review_reactions')
        .select(`
          id,
          user_id,
          review_id,
          reaction,
          created_at,
          profiles:user_id (
            username,
            display_name
          ),
          reviews:review_id (
            id,
            dishes (
              name
            )
          )
        `)
        .in('review_id', reviewIds)
        .neq('user_id', user.id);

    if (reactionError) {
      throw new Error(reactionError.message);
    }

    reactionData =
      (reactions ?? []) as unknown as ReactionRow[];

    const { data: comments, error: commentError } =
      await supabase
        .from('review_comments')
        .select(`
          id,
          user_id,
          review_id,
          comment_text,
          created_at,
          profiles:user_id (
            username,
            display_name
          ),
          reviews:review_id (
            id,
            dishes (
              name
            )
          )
        `)
        .in('review_id', reviewIds)
        .neq('user_id', user.id);

    if (commentError) {
      throw new Error(commentError.message);
    }

    commentData =
      (comments ?? []) as unknown as CommentRow[];
  }

  const { data: readData, error: readError } = await supabase
    .from('notification_reads')
    .select('notification_key')
    .eq('user_id', user.id);

  if (readError) {
    throw new Error(readError.message);
  }

  const readKeys = new Set(
    (readData ?? []).map(
      (row) => row.notification_key
    )
  );

  const followNotifications: NotificationItem[] = (
    (followData ?? []) as unknown as FollowRow[]
  ).map((item) => {
    const id = `follow-${item.id}`;

    return {
      id,
      type: 'follow',
      actorId: item.follower_id,
      actorName:
        item.profiles?.display_name ||
        item.profiles?.username ||
        'User',
      actorUsername:
        item.profiles?.username ?? 'unknown',
      createdAt: item.created_at,
      isRead: readKeys.has(id),
    };
  });

  const reactionNotifications: NotificationItem[] =
    reactionData.map((item) => {
      const id = `reaction-${item.id}`;

      return {
        id,
        type: 'reaction',
        actorId: item.user_id,
        actorName:
          item.profiles?.display_name ||
          item.profiles?.username ||
          'User',
        actorUsername:
          item.profiles?.username ?? 'unknown',
        createdAt: item.created_at,
        reaction: item.reaction,
        reviewId: item.review_id,
        dishName:
          item.reviews?.dishes?.name ??
          'your review',
        isRead: readKeys.has(id),
      };
    });

  const commentNotifications: NotificationItem[] =
    commentData.map((item) => {
      const id = `comment-${item.id}`;

      return {
        id,
        type: 'comment',
        actorId: item.user_id,
        actorName:
          item.profiles?.display_name ||
          item.profiles?.username ||
          'User',
        actorUsername:
          item.profiles?.username ?? 'unknown',
        createdAt: item.created_at,
        commentText: item.comment_text,
        reviewId: item.review_id,
        dishName:
          item.reviews?.dishes?.name ??
          'your review',
        isRead: readKeys.has(id),
      };
    });

  return [
    ...followNotifications,
    ...reactionNotifications,
    ...commentNotifications,
  ].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() -
      new Date(a.createdAt).getTime()
  );
}

export async function markNotificationRead(
  notificationKey: string
) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('You must be signed in.');
  }

  const { error } = await supabase
    .from('notification_reads')
    .upsert(
      {
        user_id: user.id,
        notification_key: notificationKey,
      },
      {
        onConflict: 'user_id,notification_key',
      }
    );

  if (error) {
    throw new Error(error.message);
  }
}

export async function markAllNotificationsRead(
  notificationKeys: string[]
) {
  if (notificationKeys.length === 0) {
    return;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('You must be signed in.');
  }

  const rows = notificationKeys.map((key) => ({
    user_id: user.id,
    notification_key: key,
  }));

  const { error } = await supabase
    .from('notification_reads')
    .upsert(rows, {
      onConflict: 'user_id,notification_key',
    });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getUnreadNotificationCount() {
  const notifications = await getNotifications();

  return notifications.filter(
    (notification) => !notification.isRead
  ).length;
}