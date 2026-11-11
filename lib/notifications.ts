import { withoutHiddenUsers } from '@/lib/moderation';
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
  // Set instead of reviewId for likes and comments on a restaurant rating;
  // dishName is then the restaurant's name.
  visitId?: string;
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
    .select(
      `
      id,
      follower_id,
      created_at,
      profiles:follower_id (
        username,
        display_name
      )
    `,
    )
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

  const reviewIds = (ownReviews ?? []).map((review) => review.id);

  let reactionData: ReactionRow[] = [];
  let commentData: CommentRow[] = [];

  if (reviewIds.length > 0) {
    const { data: reactions, error: reactionError } = await supabase
      .from('review_reactions')
      .select(
        `
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
        `,
      )
      .in('review_id', reviewIds)
      .neq('user_id', user.id);

    if (reactionError) {
      throw new Error(reactionError.message);
    }

    reactionData = (reactions ?? []) as unknown as ReactionRow[];

    const { data: comments, error: commentError } = await supabase
      .from('review_comments')
      .select(
        `
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
        `,
      )
      .in('review_id', reviewIds)
      .neq('user_id', user.id);

    if (commentError) {
      throw new Error(commentError.message);
    }

    commentData = (comments ?? []) as unknown as CommentRow[];
  }

  const { data: readData, error: readError } = await supabase
    .from('notification_reads')
    .select('notification_key')
    .eq('user_id', user.id);

  if (readError) {
    throw new Error(readError.message);
  }

  const readKeys = new Set((readData ?? []).map((row) => row.notification_key));

  const followNotifications: NotificationItem[] = (
    (followData ?? []) as unknown as FollowRow[]
  ).map((item) => {
    const id = `follow-${item.id}`;

    return {
      id,
      type: 'follow',
      actorId: item.follower_id,
      actorName:
        item.profiles?.display_name || item.profiles?.username || 'User',
      actorUsername: item.profiles?.username ?? 'unknown',
      createdAt: item.created_at,
      isRead: readKeys.has(id),
    };
  });

  const reactionNotifications: NotificationItem[] = reactionData.map((item) => {
    const id = `reaction-${item.id}`;

    return {
      id,
      type: 'reaction',
      actorId: item.user_id,
      actorName:
        item.profiles?.display_name || item.profiles?.username || 'User',
      actorUsername: item.profiles?.username ?? 'unknown',
      createdAt: item.created_at,
      reaction: item.reaction,
      reviewId: item.review_id,
      dishName: item.reviews?.dishes?.name ?? 'your review',
      isRead: readKeys.has(id),
    };
  });

  const commentNotifications: NotificationItem[] = commentData.map((item) => {
    const id = `comment-${item.id}`;

    return {
      id,
      type: 'comment',
      actorId: item.user_id,
      actorName:
        item.profiles?.display_name || item.profiles?.username || 'User',
      actorUsername: item.profiles?.username ?? 'unknown',
      createdAt: item.created_at,
      commentText: item.comment_text,
      reviewId: item.review_id,
      dishName: item.reviews?.dishes?.name ?? 'your review',
      isRead: readKeys.has(id),
    };
  });

  const visitNotifications = await getVisitNotifications(user.id, readKeys);

  // Nothing from blocked users (either way).
  const visible = await withoutHiddenUsers(
    [
      ...followNotifications,
      ...reactionNotifications,
      ...commentNotifications,
      ...visitNotifications,
    ],
    (notification) => notification.actorId,
  );

  return visible.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function markNotificationRead(notificationKey: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('You must be signed in.');
  }

  const { error } = await supabase.from('notification_reads').upsert(
    {
      user_id: user.id,
      notification_key: notificationKey,
    },
    {
      onConflict: 'user_id,notification_key',
    },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function markAllNotificationsRead(notificationKeys: string[]) {
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

  const { error } = await supabase.from('notification_reads').upsert(rows, {
    onConflict: 'user_id,notification_key',
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getUnreadNotificationCount() {
  const notifications = await getNotifications();

  return notifications.filter((notification) => !notification.isRead).length;
}
// Likes and comments on the user's restaurant ratings.
async function getVisitNotifications(
  userId: string,
  readKeys: Set<string>,
): Promise<NotificationItem[]> {
  const { data: visits, error } = await supabase
    .from('restaurant_ratings')
    .select('id, restaurant_id, brand_id, restaurants (name, brands (name))')
    .eq('user_id', userId);

  if (error) {
    console.log('Visit notifications error:', error.message);
    return [];
  }

  type VisitRow = {
    id: string;
    brand_id: string | null;
    restaurants: { name: string; brands: { name: string } | null } | null;
  };

  const rows = (visits ?? []) as unknown as VisitRow[];

  if (rows.length === 0) return [];

  const visitIds = rows.map((row) => row.id);

  const [{ data: likes }, { data: comments }] = await Promise.all([
    supabase
      .from('restaurant_rating_likes')
      .select('restaurant_rating_id, user_id, created_at')
      .in('restaurant_rating_id', visitIds)
      .neq('user_id', userId),
    supabase
      .from('restaurant_rating_comments')
      .select('id, restaurant_rating_id, user_id, comment_text, created_at')
      .in('restaurant_rating_id', visitIds)
      .neq('user_id', userId),
  ]);

  const likeRows = (likes ?? []) as {
    restaurant_rating_id: string;
    user_id: string;
    created_at: string;
  }[];
  const commentRows = (comments ?? []) as {
    id: string;
    restaurant_rating_id: string;
    user_id: string;
    comment_text: string;
    created_at: string;
  }[];

  const actorIds = [
    ...new Set([...likeRows, ...commentRows].map((row) => row.user_id)),
  ];

  if (actorIds.length === 0) return [];

  // Brand-wide ratings have no location, so their name comes from the brand.
  const brandIds = [
    ...new Set(
      rows
        .filter((row) => !row.restaurants && row.brand_id)
        .map((row) => row.brand_id!),
    ),
  ];

  const [{ data: profiles }, { data: brands }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', actorIds),
    brandIds.length
      ? supabase.from('brands').select('id, name').in('id', brandIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const profileById = new Map(
    ((profiles ?? []) as (ActorProfile & { id: string })[]).map((profile) => [
      profile.id,
      profile,
    ]),
  );
  const brandName = new Map(
    (brands ?? []).map((brand) => [brand.id, brand.name]),
  );
  const visitName = new Map(
    rows.map((row) => [
      row.id,
      row.restaurants?.brands?.name ??
        row.restaurants?.name ??
        brandName.get(row.brand_id ?? '') ??
        'a restaurant',
    ]),
  );

  const actor = (actorId: string) => {
    const profile = profileById.get(actorId);
    return {
      actorId,
      actorName: profile?.display_name || profile?.username || 'User',
      actorUsername: profile?.username ?? 'unknown',
    };
  };

  return [
    ...likeRows.map((like): NotificationItem => {
      const id = `visit-like-${like.restaurant_rating_id}-${like.user_id}`;
      return {
        id,
        type: 'reaction',
        ...actor(like.user_id),
        createdAt: like.created_at,
        reaction: '❤️',
        visitId: like.restaurant_rating_id,
        dishName: visitName.get(like.restaurant_rating_id),
        isRead: readKeys.has(id),
      };
    }),
    ...commentRows.map((comment): NotificationItem => {
      const id = `visit-comment-${comment.id}`;
      return {
        id,
        type: 'comment',
        ...actor(comment.user_id),
        createdAt: comment.created_at,
        commentText: comment.comment_text,
        visitId: comment.restaurant_rating_id,
        dishName: visitName.get(comment.restaurant_rating_id),
        isRead: readKeys.has(id),
      };
    }),
  ];
}
