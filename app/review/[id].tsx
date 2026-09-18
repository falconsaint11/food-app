import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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

type Review = {
  id: string;
  user_id: string;
  rating: number;
  review_text: string | null;
  photo_path: string | null;
  date_eaten: string;
  created_at: string;
  profiles: {
    username: string;
    display_name: string | null;
  } | null;
  dishes: {
    id: string;
    name: string;
    restaurants: {
      id: string;
      name: string;
      city: string | null;
    } | null;
  } | null;
};

type ReactionType =
  | '😂'
  | '🔥'
  | '🤤'
  | '❤️';

type ReactionRow = {
  user_id: string;
  reaction: ReactionType;
};

type Comment = {
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  profiles: {
    username: string;
    display_name: string | null;
  } | null;
};

const reactions: ReactionType[] = [
  '😂',
  '🔥',
  '🤤',
  '❤️',
];

export default function ReviewDetailScreen() {
  const { id } =
    useLocalSearchParams<{ id: string }>();

  const [review, setReview] =
    useState<Review | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);

  const [deletingReview, setDeletingReview] =
    useState(false);

  const [reactionRows, setReactionRows] =
    useState<ReactionRow[]>([]);

  const [myReaction, setMyReaction] =
    useState<ReactionType | null>(null);

  const [reactionSaving, setReactionSaving] =
    useState(false);

  const [comments, setComments] =
    useState<Comment[]>([]);

  const [commentText, setCommentText] =
    useState('');

  const [commentSaving, setCommentSaving] =
    useState(false);

  useFocusEffect(
    useCallback(() => {
      loadReview();
    }, [id])
  );

  async function loadReview() {
    if (!id) {
      return;
    }

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    setCurrentUserId(
      user?.id ?? null
    );

    const { data, error } =
      await supabase
        .from('reviews')
        .select(`
          id,
          user_id,
          rating,
          review_text,
          photo_path,
          date_eaten,
          created_at,
          profiles:user_id (
            username,
            display_name
          ),
          dishes (
            id,
            name,
            restaurants (
              id,
              name,
              city
            )
          )
        `)
        .eq('id', id)
        .maybeSingle();

    if (error) {
      setLoading(false);

      Alert.alert(
        'Review error',
        error.message
      );

      return;
    }

    setReview(
      (data ?? null) as unknown as
        Review | null
    );

    const {
      data: reactionData,
      error: reactionError,
    } = await supabase
      .from('review_reactions')
      .select('user_id, reaction')
      .eq('review_id', id);

    if (reactionError) {
      setLoading(false);

      Alert.alert(
        'Reaction error',
        reactionError.message
      );

      return;
    }

    const rows =
      (reactionData ?? []) as ReactionRow[];

    setReactionRows(rows);

    if (user) {
      const ownReaction = rows.find(
        (row) =>
          row.user_id === user.id
      );

      setMyReaction(
        ownReaction?.reaction ?? null
      );
    } else {
      setMyReaction(null);
    }

    const {
      data: commentData,
      error: commentError,
    } = await supabase
      .from('review_comments')
      .select(`
        id,
        user_id,
        comment_text,
        created_at,
        profiles:user_id (
          username,
          display_name
        )
      `)
      .eq('review_id', id)
      .order('created_at', {
        ascending: true,
      });

    setLoading(false);

    if (commentError) {
      Alert.alert(
        'Comment error',
        commentError.message
      );

      return;
    }

    setComments(
      (commentData ?? []) as unknown as
        Comment[]
    );
  }

  async function deleteReview() {
    if (
      !id ||
      !currentUserId ||
      deletingReview
    ) {
      return;
    }

    setDeletingReview(true);

    if (review?.photo_path) {
      const { error: photoDeleteError } =
        await supabase.storage
          .from('review-photos')
          .remove([
            review.photo_path,
          ]);

      if (photoDeleteError) {
        console.log(
          'Photo delete error:',
          photoDeleteError.message
        );
      }
    }

    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('id', id)
      .eq(
        'user_id',
        currentUserId
      );

    setDeletingReview(false);

    if (error) {
      Alert.alert(
        'Delete error',
        error.message
      );

      return;
    }

    router.replace('/');
  }

  function confirmDeleteReview() {
    Alert.alert(
      'Delete review?',
      'This will permanently delete this review, its photo, reactions, and comments.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: deleteReview,
        },
      ]
    );
  }

  async function toggleReaction(
    reaction: ReactionType
  ) {
    if (
      !id ||
      !currentUserId ||
      reactionSaving
    ) {
      return;
    }

    setReactionSaving(true);

    if (myReaction === reaction) {
      const { error } =
        await supabase
          .from('review_reactions')
          .delete()
          .eq('review_id', id)
          .eq(
            'user_id',
            currentUserId
          );

      setReactionSaving(false);

      if (error) {
        Alert.alert(
          'Reaction error',
          error.message
        );

        return;
      }

      setReactionRows((current) =>
        current.filter(
          (row) =>
            row.user_id !==
            currentUserId
        )
      );

      setMyReaction(null);
      return;
    }

    if (myReaction) {
      const { error } =
        await supabase
          .from('review_reactions')
          .update({
            reaction,
          })
          .eq('review_id', id)
          .eq(
            'user_id',
            currentUserId
          );

      setReactionSaving(false);

      if (error) {
        Alert.alert(
          'Reaction error',
          error.message
        );

        return;
      }

      setReactionRows((current) =>
        current.map((row) =>
          row.user_id ===
          currentUserId
            ? {
                ...row,
                reaction,
              }
            : row
        )
      );

      setMyReaction(reaction);
      return;
    }

    const { error } = await supabase
      .from('review_reactions')
      .insert({
        review_id: id,
        user_id: currentUserId,
        reaction,
      });

    setReactionSaving(false);

    if (error) {
      Alert.alert(
        'Reaction error',
        error.message
      );

      return;
    }

    setReactionRows((current) => [
      ...current,
      {
        user_id: currentUserId,
        reaction,
      },
    ]);

    setMyReaction(reaction);
  }

  async function postComment() {
    const trimmedComment =
      commentText.trim();

    if (!trimmedComment) {
      return;
    }

    if (!id || !currentUserId) {
      Alert.alert(
        'Error',
        'You must be signed in.'
      );

      return;
    }

    setCommentSaving(true);

    const { data, error } =
      await supabase
        .from('review_comments')
        .insert({
          review_id: id,
          user_id: currentUserId,
          comment_text:
            trimmedComment,
        })
        .select(`
          id,
          user_id,
          comment_text,
          created_at,
          profiles:user_id (
            username,
            display_name
          )
        `)
        .single();

    setCommentSaving(false);

    if (error) {
      Alert.alert(
        'Comment error',
        error.message
      );

      return;
    }

    setComments((current) => [
      ...current,
      data as unknown as Comment,
    ]);

    setCommentText('');
  }

  async function deleteComment(
    commentId: string
  ) {
    const { error } = await supabase
      .from('review_comments')
      .delete()
      .eq('id', commentId);

    if (error) {
      Alert.alert(
        'Delete error',
        error.message
      );

      return;
    }

    setComments((current) =>
      current.filter(
        (comment) =>
          comment.id !== commentId
      )
    );
  }

  function confirmDeleteComment(
    commentId: string
  ) {
    Alert.alert(
      'Delete comment?',
      'This comment will be permanently removed.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteComment(
              commentId
            ),
        },
      ]
    );
  }

  function getReactionCount(
    reaction: ReactionType
  ) {
    return reactionRows.filter(
      (row) =>
        row.reaction === reaction
    ).length;
  }

  function formatDate(
    date: string
  ) {
    const parsedDate = new Date(
      `${date}T00:00:00`
    );

    return parsedDate.toLocaleDateString(
      undefined,
      {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }
    );
  }

  function formatCommentDate(
    date: string
  ) {
    return new Date(
      date
    ).toLocaleDateString(
      undefined,
      {
        month: 'short',
        day: 'numeric',
      }
    );
  }

  function getPhotoUrl(
    path: string
  ) {
    const { data } =
      supabase.storage
        .from('review-photos')
        .getPublicUrl(path);

    return data.publicUrl;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          size="large"
        />
      </View>
    );
  }

  if (!review) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>
          Review not found.
        </Text>
      </View>
    );
  }

  const isOwnReview =
    review.user_id === currentUserId;

  const photoUrl =
    review.photo_path
      ? getPhotoUrl(
          review.photo_path
        )
      : null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={
        Platform.OS === 'ios'
          ? 'padding'
          : undefined
      }
    >
      <ScrollView
        contentContainerStyle={
          styles.container
        }
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.userRow}
          onPress={() => {
            if (isOwnReview) {
              router.push('/profile');
            } else {
              router.push(
                `/user/${review.user_id}`
              );
            }
          }}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(
                review.profiles
                  ?.display_name ||
                review.profiles
                  ?.username ||
                'U'
              )
                .charAt(0)
                .toUpperCase()}
            </Text>
          </View>

          <View style={styles.userInfo}>
            <Text style={styles.userName}>
              {review.profiles
                ?.display_name ||
                review.profiles
                  ?.username ||
                'User'}
              {isOwnReview
                ? ' · You'
                : ''}
            </Text>

            <Text style={styles.userHandle}>
              @
              {review.profiles
                ?.username ??
                'unknown'}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.reviewCard}>
          <View style={styles.foodRow}>
            <View style={styles.foodInfo}>
              {review.dishes ? (
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname:
                        '/dish/[id]',
                      params: {
                        id: review
                          .dishes!.id,
                      },
                    })
                  }
                >
                  <Text
                    style={
                      styles.dishLink
                    }
                  >
                    {
                      review.dishes
                        .name
                    }
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text
                  style={
                    styles.dishName
                  }
                >
                  Unknown dish
                </Text>
              )}

              {review.dishes
                ?.restaurants ? (
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname:
                        '/restaurant/[id]',
                      params: {
                        id: review
                          .dishes!
                          .restaurants!
                          .id,
                      },
                    })
                  }
                >
                  <Text
                    style={
                      styles.restaurantLink
                    }
                  >
                    {
                      review.dishes
                        .restaurants
                        .name
                    }

                    {review.dishes
                      .restaurants
                      .city
                      ? ` · ${review.dishes.restaurants.city}`
                      : ''}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text
                  style={
                    styles.restaurantName
                  }
                >
                  Unknown restaurant
                </Text>
              )}
            </View>

            <Text style={styles.rating}>
              {review.rating}★
            </Text>
          </View>

          {photoUrl ? (
            <Image
              source={{
                uri: photoUrl,
              }}
              style={styles.reviewPhoto}
              resizeMode="cover"
            />
          ) : null}

          {review.review_text ? (
            <Text
              style={styles.reviewText}
            >
              {review.review_text}
            </Text>
          ) : (
            <Text
              style={
                styles.noReviewText
              }
            >
              No written review.
            </Text>
          )}

          <Text style={styles.date}>
            Eaten{' '}
            {formatDate(
              review.date_eaten
            )}
          </Text>
        </View>

        {isOwnReview ? (
          <View
            style={styles.ownerActions}
          >
            <TouchableOpacity
              style={styles.editButton}
              onPress={() =>
                router.push({
                  pathname:
                    '/review/edit/[id]',
                  params: {
                    id: review.id,
                  },
                })
              }
            >
              <Text
                style={
                  styles.editButtonText
                }
              >
                Edit Review
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={
                styles.deleteReviewButton
              }
              onPress={
                confirmDeleteReview
              }
              disabled={
                deletingReview
              }
            >
              <Text
                style={
                  styles.deleteReviewButtonText
                }
              >
                {deletingReview
                  ? 'Deleting...'
                  : 'Delete Review'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View
          style={
            styles.reactionSection
          }
        >
          <Text
            style={
              styles.reactionTitle
            }
          >
            React
          </Text>

          <View
            style={
              styles.reactionRow
            }
          >
            {reactions.map(
              (reaction) => {
                const selected =
                  myReaction ===
                  reaction;

                const count =
                  getReactionCount(
                    reaction
                  );

                return (
                  <TouchableOpacity
                    key={reaction}
                    style={[
                      styles.reactionButton,
                      selected &&
                        styles.reactionButtonSelected,
                    ]}
                    onPress={() =>
                      toggleReaction(
                        reaction
                      )
                    }
                    disabled={
                      reactionSaving
                    }
                  >
                    <Text
                      style={
                        styles.reactionEmoji
                      }
                    >
                      {reaction}
                    </Text>

                    {count > 0 ? (
                      <Text
                        style={
                          styles.reactionCount
                        }
                      >
                        {count}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              }
            )}
          </View>
        </View>

        <View
          style={
            styles.commentsSection
          }
        >
          <Text
            style={
              styles.commentsTitle
            }
          >
            Comments
          </Text>

          <View
            style={
              styles.commentInputRow
            }
          >
            <TextInput
              style={
                styles.commentInput
              }
              placeholder="Add a comment..."
              placeholderTextColor="#888888"
              value={commentText}
              onChangeText={
                setCommentText
              }
              multiline
              maxLength={500}
            />

            <TouchableOpacity
              style={[
                styles.postButton,
                (!commentText.trim() ||
                  commentSaving) &&
                  styles.postButtonDisabled,
              ]}
              onPress={postComment}
              disabled={
                !commentText.trim() ||
                commentSaving
              }
            >
              <Text
                style={
                  styles.postButtonText
                }
              >
                {commentSaving
                  ? '...'
                  : 'Post'}
              </Text>
            </TouchableOpacity>
          </View>

          {comments.length === 0 ? (
            <Text
              style={styles.noComments}
            >
              No comments yet. Be
              the first.
            </Text>
          ) : (
            comments.map(
              (comment) => {
                const isOwnComment =
                  comment.user_id ===
                  currentUserId;

                return (
                  <View
                    key={
                      comment.id
                    }
                    style={
                      styles.commentCard
                    }
                  >
                    <View
                      style={
                        styles.commentTopRow
                      }
                    >
                      <TouchableOpacity
                        style={
                          styles.commentUserArea
                        }
                        onPress={() => {
                          if (
                            isOwnComment
                          ) {
                            router.push(
                              '/profile'
                            );
                          } else {
                            router.push(
                              `/user/${comment.user_id}`
                            );
                          }
                        }}
                      >
                        <View
                          style={
                            styles.commentAvatar
                          }
                        >
                          <Text
                            style={
                              styles.commentAvatarText
                            }
                          >
                            {(
                              comment
                                .profiles
                                ?.display_name ||
                              comment
                                .profiles
                                ?.username ||
                              'U'
                            )
                              .charAt(
                                0
                              )
                              .toUpperCase()}
                          </Text>
                        </View>

                        <View>
                          <Text
                            style={
                              styles.commentName
                            }
                          >
                            {comment
                              .profiles
                              ?.display_name ||
                              comment
                                .profiles
                                ?.username ||
                              'User'}
                          </Text>

                          <Text
                            style={
                              styles.commentHandle
                            }
                          >
                            @
                            {comment
                              .profiles
                              ?.username ??
                              'unknown'}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {isOwnComment ? (
                        <TouchableOpacity
                          onPress={() =>
                            confirmDeleteComment(
                              comment.id
                            )
                          }
                        >
                          <Text
                            style={
                              styles.deleteComment
                            }
                          >
                            Delete
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    <Text
                      style={
                        styles.commentText
                      }
                    >
                      {
                        comment.comment_text
                      }
                    </Text>

                    <Text
                      style={
                        styles.commentDate
                      }
                    >
                      {formatCommentDate(
                        comment.created_at
                      )}
                    </Text>
                  </View>
                );
              }
            )
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 60,
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  notFound: {
    fontSize: 16,
    color: '#666666',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#eeeeee',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarText: {
    fontSize: 19,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 17,
    fontWeight: '700',
  },
  userHandle: {
    fontSize: 14,
    color: '#777777',
    marginTop: 2,
  },
  reviewCard: {
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 16,
    padding: 20,
    overflow: 'hidden',
  },
  foodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  foodInfo: {
    flex: 1,
    paddingRight: 16,
  },
  dishName: {
    fontSize: 24,
    fontWeight: '700',
  },
  dishLink: {
    fontSize: 24,
    fontWeight: '700',
  },
  restaurantName: {
    fontSize: 15,
    color: '#666666',
    marginTop: 5,
  },
  restaurantLink: {
    fontSize: 15,
    color: '#444444',
    fontWeight: '600',
    marginTop: 5,
  },
  rating: {
    fontSize: 22,
    fontWeight: '700',
  },
  reviewPhoto: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    marginTop: 20,
    backgroundColor: '#eeeeee',
  },
  reviewText: {
    fontSize: 17,
    lineHeight: 25,
    marginTop: 22,
  },
  noReviewText: {
    fontSize: 15,
    color: '#777777',
    fontStyle: 'italic',
    marginTop: 22,
  },
  date: {
    fontSize: 13,
    color: '#888888',
    marginTop: 24,
  },
  ownerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  editButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#111111',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111111',
  },
  deleteReviewButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteReviewButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#b42318',
  },
  reactionSection: {
    marginTop: 24,
  },
  reactionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  reactionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 22,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: '#ffffff',
  },
  reactionButtonSelected: {
    backgroundColor: '#f2f2f2',
    borderColor: '#111111',
  },
  reactionEmoji: {
    fontSize: 20,
  },
  reactionCount: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },
  commentsSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#eeeeee',
  },
  commentsTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
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
    borderColor: '#dddddd',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  postButton: {
    backgroundColor: '#111111',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  postButtonDisabled: {
    opacity: 0.4,
  },
  postButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  noComments: {
    fontSize: 14,
    color: '#777777',
    marginTop: 20,
  },
  commentCard: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  commentTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentUserArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  commentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#eeeeee',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  commentAvatarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  commentName: {
    fontSize: 14,
    fontWeight: '700',
  },
  commentHandle: {
    fontSize: 12,
    color: '#777777',
    marginTop: 1,
  },
  deleteComment: {
    fontSize: 12,
    color: '#777777',
    fontWeight: '600',
    marginLeft: 12,
  },
  commentText: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
  },
  commentDate: {
    fontSize: 12,
    color: '#999999',
    marginTop: 6,
  },
});