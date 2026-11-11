import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  type TextInputInstance,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ContentMenu } from '@/components/content-menu';
import { Palette } from '@/constants/theme';
import { withoutHiddenUsers } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';

// Where a post's comments live: dish reviews and restaurant ratings each have
// their own tables, with the same shape.
export type CommentSource = {
  table: 'review_comments' | 'restaurant_rating_comments';
  likeTable: 'review_comment_likes' | 'restaurant_rating_comment_likes';
  postColumn: 'review_id' | 'restaurant_rating_id';
  reportType: 'comment' | 'restaurant_comment';
};

export const REVIEW_COMMENTS: CommentSource = {
  table: 'review_comments',
  likeTable: 'review_comment_likes',
  postColumn: 'review_id',
  reportType: 'comment',
};

export const RESTAURANT_RATING_COMMENTS: CommentSource = {
  table: 'restaurant_rating_comments',
  likeTable: 'restaurant_rating_comment_likes',
  postColumn: 'restaurant_rating_id',
  reportType: 'restaurant_comment',
};

export type CommentAuthor = {
  username: string;
  display_name: string | null;
  avatar_path: string | null;
};

export type PostComment = {
  id: string;
  user_id: string;
  // The top-level comment this replies to; replies are one level deep.
  parent_id: string | null;
  comment_text: string;
  created_at: string;
  profiles: CommentAuthor | null;
};

type CommentLike = {
  comment_id: string;
  user_id: string;
};

const COMMENT_COLUMNS = 'id, user_id, parent_id, comment_text, created_at';

async function withAuthors(
  rows: Omit<PostComment, 'profiles'>[]
): Promise<PostComment[]> {
  const ids = [...new Set(rows.map((row) => row.user_id))];

  const { data, error } = ids.length
    ? await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_path')
        .in('id', ids)
    : { data: [], error: null };

  if (error) console.log('Comment authors error:', error.message);

  const byId = new Map(
    ((data ?? []) as (CommentAuthor & { id: string })[]).map((profile) => [
      profile.id,
      profile,
    ])
  );

  return rows.map((row) => ({ ...row, profiles: byId.get(row.user_id) ?? null }));
}

// Comments on one post, with likes and replies.
export function useComments(
  source: CommentSource,
  postId: string | undefined,
  currentUserId: string | null
) {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [likes, setLikes] = useState<CommentLike[]>([]);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // The comment being replied to, if any.
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);

  // Returns an error message, or null.
  async function load(): Promise<string | null> {
    if (!postId) return null;

    const { data, error } = await supabase
      .from(source.table)
      .select(COMMENT_COLUMNS)
      .eq(source.postColumn, postId)
      .order('created_at', { ascending: true });

    if (error) return error.message;

    const visible = await withoutHiddenUsers(
      await withAuthors((data ?? []) as Omit<PostComment, 'profiles'>[]),
      (comment) => comment.user_id
    );

    setComments(visible);

    const commentIds = visible.map((comment) => comment.id);

    const { data: likeData, error: likeError } = commentIds.length
      ? await supabase
          .from(source.likeTable)
          .select('comment_id, user_id')
          .in('comment_id', commentIds)
      : { data: [], error: null };

    if (likeError) console.log('Comment likes error:', likeError.message);

    setLikes((likeData ?? []) as CommentLike[]);

    return null;
  }

  async function toggleLike(comment: PostComment) {
    if (!currentUserId) return;

    const liked = likes.some(
      (like) => like.comment_id === comment.id && like.user_id === currentUserId
    );

    const { error } = liked
      ? await supabase
          .from(source.likeTable)
          .delete()
          .eq('comment_id', comment.id)
          .eq('user_id', currentUserId)
      : await supabase
          .from(source.likeTable)
          .insert({ comment_id: comment.id, user_id: currentUserId });

    if (error) {
      Alert.alert('Like error', error.message);
      return;
    }

    setLikes((current) =>
      liked
        ? current.filter(
            (like) =>
              !(like.comment_id === comment.id && like.user_id === currentUserId)
          )
        : [...current, { comment_id: comment.id, user_id: currentUserId }]
    );
  }

  // The comment bar focuses its input when a reply starts.
  function startReply(comment: PostComment) {
    setReplyTo(comment);
  }

  async function post() {
    const trimmed = text.trim();

    if (!trimmed) return;

    if (!postId || !currentUserId) {
      Alert.alert('Error', 'You must be signed in.');
      return;
    }

    setSaving(true);

    const { data, error } = await supabase
      .from(source.table)
      .insert({
        [source.postColumn]: postId,
        user_id: currentUserId,
        comment_text: trimmed,
        // Replies to a reply go under the same top-level comment.
        parent_id: replyTo ? (replyTo.parent_id ?? replyTo.id) : null,
      })
      .select(COMMENT_COLUMNS)
      .single();

    setSaving(false);

    if (error) {
      Alert.alert('Comment error', error.message);
      return;
    }

    const [saved] = await withAuthors([
      data as unknown as Omit<PostComment, 'profiles'>,
    ]);

    setComments((current) => [...current, saved]);
    setText('');
    setReplyTo(null);
  }

  async function remove(commentId: string) {
    const { error } = await supabase
      .from(source.table)
      .delete()
      .eq('id', commentId);

    if (error) {
      Alert.alert('Delete error', error.message);
      return;
    }

    // Its replies are deleted with it.
    setComments((current) =>
      current.filter(
        (comment) => comment.id !== commentId && comment.parent_id !== commentId
      )
    );
  }

  function confirmRemove(commentId: string) {
    Alert.alert(
      'Delete comment?',
      'This comment and any replies to it will be permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => remove(commentId),
        },
      ]
    );
  }

  function hideUser(userId: string) {
    setComments((current) =>
      current.filter((comment) => comment.user_id !== userId)
    );
  }

  return {
    source,
    currentUserId,
    comments,
    likes,
    text,
    setText,
    saving,
    replyTo,
    setReplyTo,
    load,
    toggleLike,
    startReply,
    post,
    confirmRemove,
    hideUser,
  };
}

export type CommentsState = ReturnType<typeof useComments>;

function openProfile(userId: string, currentUserId: string | null) {
  if (userId === currentUserId) {
    router.push('/profile');
  } else {
    router.push(`/user/${userId}`);
  }
}

function formatCommentDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

// The comments under a post, replies under their comment. The post's author
// can delete any comment on it.
export function CommentThreads({
  state,
  postAuthorId,
}: {
  state: CommentsState;
  postAuthorId: string;
}) {
  const { comments, likes, currentUserId } = state;

  // Replies show under their comment, so a reply whose comment is hidden
  // (e.g. its author is blocked) isn't shown.
  const topLevel = comments.filter((comment) => !comment.parent_id);

  function renderComment(comment: PostComment, isReply: boolean) {
    const isOwn = comment.user_id === currentUserId;
    const canDelete = isOwn || postAuthorId === currentUserId;
    const commentLikes = likes.filter((like) => like.comment_id === comment.id);
    const liked = commentLikes.some((like) => like.user_id === currentUserId);
    const name =
      comment.profiles?.display_name || comment.profiles?.username || 'User';

    return (
      <View key={comment.id} style={[styles.comment, isReply && styles.reply]}>
        <TouchableOpacity
          onPress={() => openProfile(comment.user_id, currentUserId)}
        >
          <Avatar
            path={comment.profiles?.avatar_path}
            name={name}
            size={34}
            marginRight={10}
          />
        </TouchableOpacity>

        <View style={styles.commentBody}>
          <Text style={styles.commentText}>
            <Text
              style={styles.commentName}
              onPress={() => openProfile(comment.user_id, currentUserId)}
            >
              {comment.profiles?.username ?? 'user'}
            </Text>{' '}
            {comment.comment_text}
          </Text>

          <View style={styles.commentFooter}>
            <Text style={styles.commentDate}>
              {formatCommentDate(comment.created_at)}
            </Text>

            <TouchableOpacity onPress={() => state.startReply(comment)}>
              <Text style={styles.commentAction}>Reply</Text>
            </TouchableOpacity>

            <ContentMenu
              targetType={state.source.reportType}
              targetId={String(comment.id)}
              authorId={comment.user_id}
              authorName={name}
              onBlocked={() => state.hideUser(comment.user_id)}
              actions={
                canDelete
                  ? [
                      {
                        label: 'Delete comment',
                        destructive: true,
                        onPress: () => state.confirmRemove(comment.id),
                      },
                    ]
                  : []
              }
            />
          </View>
        </View>

        <TouchableOpacity
          style={styles.commentLike}
          onPress={() => state.toggleLike(comment)}
          accessibilityLabel={liked ? 'Unlike comment' : 'Like comment'}
        >
          <Text style={[styles.commentHeart, liked && styles.heartOn]}>
            {liked ? '♥' : '♡'}
          </Text>
          {commentLikes.length > 0 ? (
            <Text style={styles.commentLikeCount}>{commentLikes.length}</Text>
          ) : null}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.commentsSection}>
      {comments.length === 0 ? (
        <Text style={styles.noComments}>No comments yet. Be the first.</Text>
      ) : (
        topLevel.map((comment) => (
          <View key={comment.id} style={styles.commentThread}>
            {renderComment(comment, false)}

            {comments
              .filter((reply) => reply.parent_id === comment.id)
              .map((reply) => renderComment(reply, true))}
          </View>
        ))
      )}
    </View>
  );
}

// The comment box, pinned under the post and above the keyboard. Put it
// after the ScrollView, inside a KeyboardAvoidingView.
export function CommentBar({ state }: { state: CommentsState }) {
  const insets = useSafeAreaInsets();
  const [keyboardShown, setKeyboardShown] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);
  const { replyTo, text, saving } = state;

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // The bar sits on the keyboard, so it drops the home-bar padding while
  // typing.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () =>
      setKeyboardShown(true)
    );
    const hide = Keyboard.addListener('keyboardWillHide', () =>
      setKeyboardShown(false)
    );

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View
      style={[
        styles.commentBar,
        { paddingBottom: keyboardShown ? 10 : Math.max(insets.bottom, 10) },
      ]}
    >
      {replyTo ? (
        <View style={styles.replyingRow}>
          <Text style={styles.replyingText}>
            Replying to @{replyTo.profiles?.username ?? 'user'}
          </Text>
          <TouchableOpacity onPress={() => state.setReplyTo(null)}>
            <Text style={styles.replyingCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.commentInputRow}>
        <TextInput
          ref={inputRef}
          style={styles.commentInput}
          placeholder={replyTo ? 'Write a reply...' : 'Add a comment...'}
          placeholderTextColor={Palette.textMuted}
          value={text}
          onChangeText={state.setText}
          multiline
          maxLength={500}
        />

        <TouchableOpacity
          style={[
            styles.postButton,
            (!text.trim() || saving) && styles.postButtonDisabled,
          ]}
          onPress={state.post}
          disabled={!text.trim() || saving}
        >
          <Text style={styles.postButtonText}>{saving ? '...' : 'Post'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// "♡ 3 likes · 2 comments" between a post and its comments.
export function LikeBar({
  liked,
  likeCount,
  commentCount,
  onToggle,
  disabled,
}: {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.likeBar}>
      <TouchableOpacity
        style={styles.likeButton}
        onPress={onToggle}
        disabled={disabled}
        accessibilityLabel={liked ? 'Unlike' : 'Like'}
      >
        <Text style={[styles.heart, liked && styles.heartOn]}>
          {liked ? '♥' : '♡'}
        </Text>
        <Text style={styles.likeCount}>
          {likeCount === 0
            ? 'Like'
            : `${likeCount} ${likeCount === 1 ? 'like' : 'likes'}`}
        </Text>
      </TouchableOpacity>

      <Text style={styles.likeCount}>
        {commentCount === 1 ? '1 comment' : `${commentCount} comments`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  likeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Palette.border,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heart: {
    fontSize: 24,
    color: Palette.text,
  },
  heartOn: {
    color: Palette.danger,
  },
  likeCount: {
    fontSize: 14,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  commentBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    backgroundColor: Palette.background,
  },
  commentsSection: {
    marginTop: 8,
  },
  commentThread: {
    paddingVertical: 6,
  },
  comment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  reply: {
    marginLeft: 44,
  },
  commentBody: {
    flex: 1,
  },
  commentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  commentAction: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.textMuted,
  },
  commentLike: {
    alignItems: 'center',
    paddingLeft: 12,
    minWidth: 32,
  },
  commentHeart: {
    fontSize: 16,
    color: Palette.textMuted,
  },
  commentLikeCount: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  replyingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  replyingText: {
    fontSize: 13,
    color: Palette.textSecondary,
  },
  replyingCancel: {
    fontSize: 13,
    fontWeight: '700',
    color: Palette.textMuted,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  commentInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Palette.text,
    backgroundColor: Palette.background,
  },
  postButton: {
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  postButtonDisabled: {
    opacity: 0.4,
  },
  postButtonText: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  noComments: {
    fontSize: 14,
    color: Palette.textMuted,
    marginTop: 20,
  },
  commentName: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  commentText: {
    color: Palette.text,
    fontSize: 15,
    lineHeight: 21,
  },
  commentDate: {
    fontSize: 12,
    color: Palette.textMuted,
  },
});
