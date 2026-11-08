import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { useHeaderHeight } from "@react-navigation/elements";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  type TextInputInstance,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ContentMenu } from "@/components/content-menu";
import { useCoverPinActions } from "@/components/cover-pin-controls";
import { fetchHiddenUserIds, withoutHiddenUsers } from "@/lib/moderation";
import { formatRating, useIsPremium } from "@/lib/ratings";
import { dishLabel } from "@/lib/dishes";
import { supabase } from "@/lib/supabase";
import { Palette } from "@/constants/theme";

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

    discontinued_at?: string | null;

    restaurants: {
      id: string;

      name: string;

      city: string | null;
    } | null;
  } | null;
};

type TaggedFriend = {
  id: string;
  username: string;
  display_name: string | null;
};

type ReactionType = "😂" | "🔥" | "🤤" | "❤️";

type ReactionRow = {
  user_id: string;

  reaction: ReactionType;
};

type Comment = {
  id: string;

  user_id: string;

  // The top-level comment this replies to; replies are one level deep.
  parent_id: string | null;

  comment_text: string;

  created_at: string;

  profiles: {
    username: string;

    display_name: string | null;
  } | null;
};

type CommentLike = {
  comment_id: string;
  user_id: string;
};

const COMMENT_SELECT = `
  id,
  user_id,
  parent_id,
  comment_text,
  created_at,
  profiles:user_id (
    username,
    display_name
  )
`;

export default function ReviewDetailScreen() {
  const isPremium = useIsPremium();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [review, setReview] = useState<Review | null>(null);

  const [loading, setLoading] = useState(true);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [deletingReview, setDeletingReview] = useState(false);

  const [reactionRows, setReactionRows] = useState<ReactionRow[]>([]);

  const [myReaction, setMyReaction] = useState<ReactionType | null>(null);

  const [reactionSaving, setReactionSaving] = useState(false);

  const [taggedFriends, setTaggedFriends] = useState<TaggedFriend[]>([]);

  const [comments, setComments] = useState<Comment[]>([]);

  const [commentText, setCommentText] = useState("");

  const [commentSaving, setCommentSaving] = useState(false);

  const [commentLikes, setCommentLikes] = useState<CommentLike[]>([]);

  // The comment being replied to, if any.
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

  const commentInput = useRef<TextInputInstance>(null);

  const headerHeight = useHeaderHeight();

  const insets = useSafeAreaInsets();

  const [keyboardShown, setKeyboardShown] = useState(false);

  const pinActions = useCoverPinActions(String(id ?? ""), !!review?.photo_path);

  // The comment bar sits on the keyboard, so it drops the home-bar padding
  // while typing.
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () =>
      setKeyboardShown(true),
    );
    const hide = Keyboard.addListener("keyboardWillHide", () =>
      setKeyboardShown(false),
    );

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReview();
    }, [id]),
  );

  async function loadReview() {
    if (!id) {
      return;
    }

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    setCurrentUserId(user?.id ?? null);

    const { data, error } = await supabase

      .from("reviews")

      .select(
        `

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

            discontinued_at,

            restaurants (

              id,

              name,

              city

            )

          )

        `,
      )

      .eq("id", id)

      .maybeSingle();

    if (error) {
      setLoading(false);

      Alert.alert(
        "Review error",

        error.message,
      );

      return;
    }

    const loadedReview = (data ?? null) as unknown as Review | null;

    // A review by someone blocked (either way) isn't shown.
    if (
      loadedReview &&
      (await fetchHiddenUserIds()).has(loadedReview.user_id)
    ) {
      setReview(null);
      setLoading(false);
      return;
    }

    setReview(loadedReview);

    // Load friends tagged in this review. Their tags are separate from diary entries.
    const { data: tagRows, error: tagError } = await supabase
      .from("review_tags")
      .select("tagged_user_id")
      .eq("review_id", id);

    if (tagError) {
      console.log("Review tags error:", tagError.message);
      setTaggedFriends([]);
    } else {
      const taggedIds = (tagRows ?? []).map((row) => row.tagged_user_id);
      if (taggedIds.length === 0) {
        setTaggedFriends([]);
      } else {
        const { data: friendProfiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id, username, display_name")
          .in("id", taggedIds);

        if (profilesError) {
          console.log("Tagged profiles error:", profilesError.message);
          setTaggedFriends([]);
        } else {
          setTaggedFriends((friendProfiles ?? []) as TaggedFriend[]);
        }
      }
    }

    const {
      data: reactionData,

      error: reactionError,
    } = await supabase

      .from("review_reactions")

      .select("user_id, reaction")

      .eq("review_id", id);

    if (reactionError) {
      setLoading(false);

      Alert.alert(
        "Reaction error",

        reactionError.message,
      );

      return;
    }

    const rows = (reactionData ?? []) as ReactionRow[];

    setReactionRows(rows);

    if (user) {
      const ownReaction = rows.find((row) => row.user_id === user.id);

      setMyReaction(ownReaction?.reaction ?? null);
    } else {
      setMyReaction(null);
    }

    const { data: commentData, error: commentError } = await supabase
      .from("review_comments")
      .select(COMMENT_SELECT)
      .eq("review_id", id)
      .order("created_at", { ascending: true });

    if (commentError) {
      setLoading(false);
      Alert.alert("Comment error", commentError.message);
      return;
    }

    const visibleComments = await withoutHiddenUsers(
      (commentData ?? []) as unknown as Comment[],
      (comment) => comment.user_id,
    );

    setComments(visibleComments);

    const commentIds = visibleComments.map((comment) => comment.id);

    const { data: likeData, error: likeError } =
      commentIds.length > 0
        ? await supabase
            .from("review_comment_likes")
            .select("comment_id, user_id")
            .in("comment_id", commentIds)
        : { data: [], error: null };

    if (likeError) console.log("Comment likes error:", likeError.message);

    setCommentLikes((likeData ?? []) as CommentLike[]);

    setLoading(false);
  }

  async function deleteReview() {
    if (!id || !currentUserId || deletingReview) {
      return;
    }

    setDeletingReview(true);

    if (review?.photo_path) {
      const { error: photoDeleteError } = await supabase.storage

        .from("review-photos")

        .remove([review.photo_path]);

      if (photoDeleteError) {
        console.log(
          "Photo delete error:",

          photoDeleteError.message,
        );
      }
    }

    const { error } = await supabase

      .from("reviews")

      .delete()

      .eq("id", id)

      .eq(
        "user_id",

        currentUserId,
      );

    setDeletingReview(false);

    if (error) {
      Alert.alert(
        "Delete error",

        error.message,
      );

      return;
    }

    router.replace("/");
  }

  function confirmDeleteReview() {
    if (deletingReview) return;

    Alert.alert(
      "Delete review?",

      "This will permanently delete this review, its photo, reactions, and comments.",

      [
        {
          text: "Cancel",

          style: "cancel",
        },

        {
          text: "Delete",

          style: "destructive",

          onPress: deleteReview,
        },
      ],
    );
  }

  // One kind of reaction now: a like. Older emoji reactions count as likes.
  async function toggleLike() {
    if (!id || !currentUserId || reactionSaving) {
      return;
    }

    setReactionSaving(true);

    const { error } = myReaction
      ? await supabase
          .from("review_reactions")
          .delete()
          .eq("review_id", id)
          .eq("user_id", currentUserId)
      : await supabase.from("review_reactions").insert({
          review_id: id,
          user_id: currentUserId,
          reaction: "❤️",
        });

    setReactionSaving(false);

    if (error) {
      Alert.alert("Like error", error.message);
      return;
    }

    setReactionRows((current) =>
      myReaction
        ? current.filter((row) => row.user_id !== currentUserId)
        : [...current, { user_id: currentUserId, reaction: "❤️" }],
    );

    setMyReaction(myReaction ? null : "❤️");
  }

  async function toggleCommentLike(comment: Comment) {
    if (!currentUserId) return;

    const liked = commentLikes.some(
      (like) =>
        like.comment_id === comment.id && like.user_id === currentUserId,
    );

    const { error } = liked
      ? await supabase
          .from("review_comment_likes")
          .delete()
          .eq("comment_id", comment.id)
          .eq("user_id", currentUserId)
      : await supabase
          .from("review_comment_likes")
          .insert({ comment_id: comment.id, user_id: currentUserId });

    if (error) {
      Alert.alert("Like error", error.message);
      return;
    }

    setCommentLikes((current) =>
      liked
        ? current.filter(
            (like) =>
              !(
                like.comment_id === comment.id && like.user_id === currentUserId
              ),
          )
        : [...current, { comment_id: comment.id, user_id: currentUserId }],
    );
  }

  function startReply(comment: Comment) {
    setReplyTo(comment);
    commentInput.current?.focus();
  }

  async function postComment() {
    const trimmedComment = commentText.trim();

    if (!trimmedComment) {
      return;
    }

    if (!id || !currentUserId) {
      Alert.alert(
        "Error",

        "You must be signed in.",
      );

      return;
    }

    setCommentSaving(true);

    const { data, error } = await supabase
      .from("review_comments")
      .insert({
        review_id: id,
        user_id: currentUserId,
        comment_text: trimmedComment,
        // Replies to a reply go under the same top-level comment.
        parent_id: replyTo ? (replyTo.parent_id ?? replyTo.id) : null,
      })
      .select(COMMENT_SELECT)
      .single();

    setCommentSaving(false);

    if (error) {
      Alert.alert("Comment error", error.message);
      return;
    }

    setComments((current) => [...current, data as unknown as Comment]);

    setCommentText("");

    setReplyTo(null);
  }

  async function deleteComment(commentId: string) {
    const { error } = await supabase

      .from("review_comments")

      .delete()

      .eq("id", commentId);

    if (error) {
      Alert.alert(
        "Delete error",

        error.message,
      );

      return;
    }

    // Its replies are deleted with it.
    setComments((current) =>
      current.filter(
        (comment) =>
          comment.id !== commentId && comment.parent_id !== commentId,
      ),
    );
  }

  function confirmDeleteComment(commentId: string) {
    Alert.alert(
      "Delete comment?",

      "This comment and any replies to it will be permanently removed.",

      [
        {
          text: "Cancel",

          style: "cancel",
        },

        {
          text: "Delete",

          style: "destructive",

          onPress: () => deleteComment(commentId),
        },
      ],
    );
  }

  function formatDate(date: string) {
    const parsedDate = new Date(`${date}T00:00:00`);

    return parsedDate.toLocaleDateString(
      undefined,

      {
        month: "long",

        day: "numeric",

        year: "numeric",
      },
    );
  }

  function formatCommentDate(date: string) {
    return new Date(date).toLocaleDateString(
      undefined,

      {
        month: "short",

        day: "numeric",
      },
    );
  }

  function getPhotoUrl(path: string) {
    const { data } = supabase.storage

      .from("review-photos")

      .getPublicUrl(path);

    return data.publicUrl;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!review) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>This review isn’t available.</Text>
      </View>
    );
  }

  const isOwnReview = review.user_id === currentUserId;

  // Replies show under their comment, so a reply whose comment is hidden
  // (e.g. its author is blocked) isn't shown.
  const topLevelComments = comments.filter((comment) => !comment.parent_id);

  function renderComment(comment: Comment, isReply: boolean) {
    const isOwnComment = comment.user_id === currentUserId;
    const likes = commentLikes.filter((like) => like.comment_id === comment.id);
    const liked = likes.some((like) => like.user_id === currentUserId);
    const name =
      comment.profiles?.display_name || comment.profiles?.username || "User";

    return (
      <View key={comment.id} style={[styles.comment, isReply && styles.reply]}>
        <TouchableOpacity
          onPress={() => {
            if (isOwnComment) {
              router.push("/profile");
            } else {
              router.push(`/user/${comment.user_id}`);
            }
          }}
        >
          <View style={styles.commentAvatar}>
            <Text style={styles.commentAvatarText}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.commentBody}>
          <Text style={styles.commentText}>
            <Text
              style={styles.commentName}
              onPress={() => {
                if (isOwnComment) {
                  router.push("/profile");
                } else {
                  router.push(`/user/${comment.user_id}`);
                }
              }}
            >
              {comment.profiles?.username ?? "user"}
            </Text>{" "}
            {comment.comment_text}
          </Text>

          <View style={styles.commentFooter}>
            <Text style={styles.commentDate}>
              {formatCommentDate(comment.created_at)}
            </Text>

            <TouchableOpacity onPress={() => startReply(comment)}>
              <Text style={styles.commentAction}>Reply</Text>
            </TouchableOpacity>

            <ContentMenu
              targetType="comment"
              targetId={String(comment.id)}
              authorId={comment.user_id}
              authorName={name}
              onBlocked={() =>
                setComments((current) =>
                  current.filter((other) => other.user_id !== comment.user_id),
                )
              }
              actions={
                isOwnComment
                  ? [
                      {
                        label: "Delete comment",
                        destructive: true,
                        onPress: () => confirmDeleteComment(comment.id),
                      },
                    ]
                  : []
              }
            />
          </View>
        </View>

        <TouchableOpacity
          style={styles.commentLike}
          onPress={() => toggleCommentLike(comment)}
          accessibilityLabel={liked ? "Unlike comment" : "Like comment"}
        >
          <Text style={[styles.commentHeart, liked && styles.heartOn]}>
            {liked ? "♥" : "♡"}
          </Text>
          {likes.length > 0 ? (
            <Text style={styles.commentLikeCount}>{likes.length}</Text>
          ) : null}
        </TouchableOpacity>
      </View>
    );
  }

  const photoUrl = review.photo_path ? getPhotoUrl(review.photo_path) : null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.userHeader}>
          <TouchableOpacity
            style={styles.userRow}
            onPress={() => {
              if (isOwnReview) {
                router.push("/profile");
              } else {
                router.push(`/user/${review.user_id}`);
              }
            }}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(
                  review.profiles?.display_name ||
                  review.profiles?.username ||
                  "U"
                )

                  .charAt(0)

                  .toUpperCase()}
              </Text>
            </View>

            <View style={styles.userInfo}>
              <Text style={styles.userName}>
                {review.profiles?.display_name ||
                  review.profiles?.username ||
                  "User"}

                {isOwnReview ? " · You" : ""}
              </Text>

              <Text style={styles.userHandle}>
                @{review.profiles?.username ?? "unknown"}
              </Text>
            </View>
          </TouchableOpacity>

          <ContentMenu
            targetType="review"
            targetId={String(review.id)}
            authorId={review.user_id}
            authorName={
              review.profiles?.display_name ||
              review.profiles?.username ||
              "this user"
            }
            onBlocked={() => router.back()}
            actions={[
              ...(isOwnReview
                ? [
                    {
                      label: "Edit review",
                      onPress: () =>
                        router.push({
                          pathname: "/review/edit/[id]",
                          params: { id: review.id },
                        }),
                    },
                    {
                      label: "Delete review",
                      destructive: true,
                      onPress: confirmDeleteReview,
                    },
                  ]
                : []),
              ...pinActions,
            ]}
          />
        </View>

        <View>
          <View style={styles.foodRow}>
            <View style={styles.foodInfo}>
              {review.dishes ? (
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: "/dish/[id]",

                      params: {
                        id: review.dishes!.id,
                      },
                    })
                  }
                >
                  <Text style={styles.dishLink}>
                    {dishLabel(review.dishes)}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.dishName}>Unknown dish</Text>
              )}

              {review.dishes?.restaurants ? (
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: "/restaurant/[id]",

                      params: {
                        id: review.dishes!.restaurants!.id,
                      },
                    })
                  }
                >
                  <Text style={styles.restaurantLink}>
                    {review.dishes.restaurants.name}

                    {review.dishes.restaurants.city
                      ? ` · ${review.dishes.restaurants.city}`
                      : ""}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.restaurantName}>Unknown restaurant</Text>
              )}
            </View>

            <Text style={styles.rating}>
              {formatRating(review.rating, isPremium)}★
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
            <Text style={styles.reviewText}>{review.review_text}</Text>
          ) : (
            <Text style={styles.noReviewText}>No written review.</Text>
          )}

          {taggedFriends.length > 0 ? (
            <View style={styles.taggedFriendsRow}>
              <Text style={styles.taggedFriendsLabel}>Went with </Text>
              {taggedFriends.map((friend, index) => (
                <View key={friend.id} style={styles.taggedFriendItem}>
                  {index > 0 ? (
                    <Text style={styles.taggedFriendsLabel}>, </Text>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => router.push(`/user/${friend.id}`)}
                    accessibilityRole="link"
                  >
                    <Text style={styles.taggedFriendLink}>
                      @{friend.username}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={[styles.date, styles.dateRow]}>
            Eaten {formatDate(review.date_eaten)}
          </Text>
        </View>

        <View style={styles.likeBar}>
          <TouchableOpacity
            style={styles.likeButton}
            onPress={toggleLike}
            disabled={reactionSaving}
            accessibilityLabel={myReaction ? "Unlike" : "Like"}
          >
            <Text style={[styles.heart, myReaction && styles.heartOn]}>
              {myReaction ? "♥" : "♡"}
            </Text>
            <Text style={styles.likeCount}>
              {reactionRows.length === 0
                ? "Like"
                : `${reactionRows.length} ${reactionRows.length === 1 ? "like" : "likes"}`}
            </Text>
          </TouchableOpacity>

          <Text style={styles.likeCount}>
            {comments.length === 1
              ? "1 comment"
              : `${comments.length} comments`}
          </Text>
        </View>

        <View style={styles.commentsSection}>
          {comments.length === 0 ? (
            <Text style={styles.noComments}>
              No comments yet. Be the first.
            </Text>
          ) : (
            topLevelComments.map((comment) => (
              <View key={comment.id} style={styles.commentThread}>
                {renderComment(comment, false)}

                {comments
                  .filter((reply) => reply.parent_id === comment.id)
                  .map((reply) => renderComment(reply, true))}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <View
        style={[
          styles.commentBar,
          { paddingBottom: keyboardShown ? 10 : Math.max(insets.bottom, 10) },
        ]}
      >
        {replyTo ? (
          <View style={styles.replyingRow}>
            <Text style={styles.replyingText}>
              Replying to @{replyTo.profiles?.username ?? "user"}
            </Text>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Text style={styles.replyingCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.commentInputRow}>
          <TextInput
            ref={commentInput}
            style={styles.commentInput}
            placeholder={replyTo ? "Write a reply..." : "Add a comment..."}
            placeholderTextColor={Palette.textMuted}
            value={commentText}
            onChangeText={setCommentText}
            multiline
            maxLength={500}
          />

          <TouchableOpacity
            style={[
              styles.postButton,
              (!commentText.trim() || commentSaving) &&
                styles.postButtonDisabled,
            ]}
            onPress={postComment}
            disabled={!commentText.trim() || commentSaving}
          >
            <Text style={styles.postButtonText}>
              {commentSaving ? "..." : "Post"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,

    backgroundColor: Palette.background,
  },

  container: {
    flexGrow: 1,

    padding: 24,

    paddingTop: 70,

    paddingBottom: 60,

    backgroundColor: Palette.background,
  },

  centered: {
    flex: 1,

    justifyContent: "center",

    alignItems: "center",

    backgroundColor: Palette.background,
  },

  notFound: {
    fontSize: 16,

    color: Palette.textSecondary,
  },

  userHeader: {
    flexDirection: "row",

    alignItems: "center",

    marginBottom: 24,
  },

  userRow: {
    flex: 1,

    flexDirection: "row",

    alignItems: "center",
  },

  avatar: {
    width: 48,

    height: 48,

    borderRadius: 24,

    backgroundColor: Palette.elevated,

    justifyContent: "center",

    alignItems: "center",

    marginRight: 14,
  },

  avatarText: {
    color: Palette.text,
    fontSize: 19,

    fontWeight: "700",
  },

  userInfo: {
    flex: 1,
  },

  userName: {
    color: Palette.text,
    fontSize: 17,

    fontWeight: "700",
  },

  userHandle: {
    fontSize: 14,

    color: Palette.accent,

    marginTop: 2,
  },

  foodRow: {
    flexDirection: "row",

    justifyContent: "space-between",

    alignItems: "flex-start",
  },

  foodInfo: {
    flex: 1,

    paddingRight: 16,
  },

  dishName: {
    color: Palette.text,
    fontSize: 24,

    fontWeight: "700",
  },

  dishLink: {
    color: Palette.text,
    fontSize: 24,

    fontWeight: "700",
  },

  restaurantName: {
    fontSize: 15,

    color: Palette.textSecondary,

    marginTop: 5,
  },

  restaurantLink: {
    fontSize: 15,

    color: Palette.textBody,

    fontWeight: "600",

    marginTop: 5,
  },

  rating: {
    color: Palette.accent,
    fontSize: 22,

    fontWeight: "700",
  },

  reviewPhoto: {
    width: "100%",

    aspectRatio: 4 / 3,

    borderRadius: 12,

    marginTop: 20,

    backgroundColor: Palette.elevated,
  },

  reviewText: {
    color: Palette.text,
    fontSize: 17,

    lineHeight: 25,

    marginTop: 22,
  },

  noReviewText: {
    fontSize: 15,

    color: Palette.textMuted,

    fontStyle: "italic",

    marginTop: 22,
  },

  taggedFriendsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 18,
  },
  taggedFriendsLabel: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  taggedFriendItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  taggedFriendLink: {
    fontSize: 14,
    color: Palette.accent,
    fontWeight: "700",
  },
  date: {
    fontSize: 13,

    color: Palette.textMuted,
  },

  dateRow: {
    marginTop: 20,
  },

  commentBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
    backgroundColor: Palette.background,
  },

  likeBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Palette.border,
  },

  likeButton: {
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "600",
    color: Palette.textSecondary,
  },

  commentsSection: {
    marginTop: 8,
  },

  commentThread: {
    paddingVertical: 6,
  },

  comment: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
  },

  reply: {
    marginLeft: 44,
  },

  commentBody: {
    flex: 1,
  },

  commentFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 4,
  },

  commentAction: {
    fontSize: 12,
    fontWeight: "700",
    color: Palette.textMuted,
  },

  commentLike: {
    alignItems: "center",
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },

  replyingText: {
    fontSize: 13,
    color: Palette.textSecondary,
  },

  replyingCancel: {
    fontSize: 13,
    fontWeight: "700",
    color: Palette.textMuted,
  },

  commentInputRow: {
    flexDirection: "row",

    alignItems: "flex-end",

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

    fontWeight: "700",
  },

  noComments: {
    fontSize: 14,

    color: Palette.textMuted,

    marginTop: 20,
  },

  commentAvatar: {
    width: 34,

    height: 34,

    borderRadius: 17,

    backgroundColor: Palette.elevated,

    justifyContent: "center",

    alignItems: "center",

    marginRight: 10,
  },

  commentAvatarText: {
    color: Palette.text,
    fontSize: 14,

    fontWeight: "700",
  },

  commentName: {
    color: Palette.text,
    fontSize: 14,

    fontWeight: "700",
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
