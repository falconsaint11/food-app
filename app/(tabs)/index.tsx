import { formatRating, useIsPremium } from "@/lib/ratings";
import { supabase } from "@/lib/supabase";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Palette } from "@/constants/theme";
type ReactionType = "😂" | "🔥" | "🤤" | "❤️";
type FeedItem = {
  id: string;
  user_id: string;
  rating: number;
  review_text: string | null;
  photo_path: string | null;
  created_at: string;
  date_eaten: string | null;
  review_tags: {
    tagged_user_id: string;
    profiles: { username: string; display_name: string | null } | null;
  }[];
  profiles: {
    username: string;
    display_name: string | null;
    avatar_path: string | null;
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
  review_reactions: {
    reaction: ReactionType;
  }[];
  review_comments: {
    id: string;
  }[];
};
// A rating of a whole restaurant, shown in the feed next to dish reviews.
type RestaurantFeedItem = {
  id: string;
  user_id: string;
  rating: number;
  notes: string | null;
  visited_at: string;
  restaurantId: string;
  restaurantName: string;
  city: string | null;
  profiles: FeedItem["profiles"];
  tagged: { id: string; username: string }[];
};
type FeedEntry =
  | { kind: "dish"; at: string; item: FeedItem }
  | { kind: "restaurant"; at: string; item: RestaurantFeedItem };
const FEED_SIZE = 30;
export default function HomeScreen() {
  const isPremium = useIsPremium();
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedReviews, setExpandedReviews] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      loadFeed();
    }, []),
  );
  async function loadFeed() {
    setLoading(true);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setLoading(false);
      router.replace("/auth");
      return;
    }
    setCurrentUserId(user.id);
    const { data: follows, error: followsError } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", user.id);
    if (followsError) {
      setLoading(false);
      Alert.alert("Follow error", followsError.message);
      return;
    }
    const followingIds = (follows ?? []).map((row) => row.following_id);
    const feedUserIds = [user.id, ...followingIds];
    const { data, error } = await supabase
      .from("reviews")
      .select(
        `
        id,
        user_id,
        rating,
        review_text,
        photo_path,
        created_at,
        date_eaten,
        review_tags (
          tagged_user_id,
          profiles:tagged_user_id (username, display_name)
        ),
        profiles:user_id (
          username,
          display_name,
          avatar_path
        ),
        dishes (
          id,
          name,
          restaurants (
            id,
            name,
            city
          )
        ),
        review_reactions (
          reaction
        ),
        review_comments (
          id
        )
      `,
      )
      .in("user_id", feedUserIds)
      .order("created_at", {
        ascending: false,
      })
      .limit(FEED_SIZE);
    const restaurantItems = await loadRestaurantFeed(feedUserIds);
    setLoading(false);
    if (error) {
      Alert.alert("Feed error", error.message);
      return;
    }
    const entries: FeedEntry[] = [
      ...((data ?? []) as unknown as FeedItem[]).map((item) => ({
        kind: "dish" as const,
        at: item.created_at,
        item,
      })),
      ...restaurantItems.map((item) => ({
        kind: "restaurant" as const,
        at: item.visited_at,
        item,
      })),
    ];
    entries.sort((a, b) => b.at.localeCompare(a.at));
    setFeed(entries.slice(0, FEED_SIZE));
  }
  // Restaurant ratings by you and the people you follow. Brand-wide ratings
  // have no location, so they link to any of the brand's.
  async function loadRestaurantFeed(
    userIds: string[],
  ): Promise<RestaurantFeedItem[]> {
    const { data, error } = await supabase
      .from("restaurant_ratings")
      .select(
        `
        id,
        user_id,
        rating,
        notes,
        visited_at,
        restaurant_id,
        brand_id,
        restaurants (id, name, city, brands (name))
      `,
      )
      .in("user_id", userIds)
      .not("rating", "is", null)
      .order("visited_at", { ascending: false })
      .limit(FEED_SIZE);
    if (error) {
      console.log("Restaurant feed error:", error.message);
      return [];
    }
    type Row = {
      id: string;
      user_id: string;
      rating: number;
      notes: string | null;
      visited_at: string;
      restaurant_id: string | null;
      brand_id: string | null;
      restaurants: {
        id: string;
        name: string;
        city: string | null;
        brands: { name: string } | null;
      } | null;
    };
    const rows = (data ?? []) as unknown as Row[];
    // Friends tagged on visits logged without dishes.
    const { data: tagRows, error: tagsError } = rows.length
      ? await supabase
          .from("restaurant_rating_tags")
          .select("restaurant_rating_id, tagged_user_id")
          .in(
            "restaurant_rating_id",
            rows.map((row) => row.id),
          )
      : { data: [], error: null };
    if (tagsError) console.log("Restaurant tags error:", tagsError.message);
    const tags = (tagRows ?? []) as {
      restaurant_rating_id: string;
      tagged_user_id: string;
    }[];
    const brandIds = [
      ...new Set(
        rows.filter((row) => !row.restaurant_id).map((row) => row.brand_id!),
      ),
    ];
    const ids = [
      ...new Set([
        ...rows.map((row) => row.user_id),
        ...tags.map((tag) => tag.tagged_user_id),
      ]),
    ];
    const [{ data: brands }, { data: brandLocations }, { data: profiles }] =
      await Promise.all([
        brandIds.length
          ? supabase.from("brands").select("id, name").in("id", brandIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        brandIds.length
          ? supabase
              .from("restaurants")
              .select("id, brand_id")
              .in("brand_id", brandIds)
          : Promise.resolve({ data: [] as { id: string; brand_id: string }[] }),
        ids.length
          ? supabase
              .from("profiles")
              .select("id, username, display_name, avatar_path")
              .in("id", ids)
          : Promise.resolve({
              data: [] as {
                id: string;
                username: string;
                display_name: string | null;
                avatar_path: string | null;
              }[],
            }),
      ]);
    const brandName = new Map((brands ?? []).map((b) => [b.id, b.name]));
    const brandLocation = new Map(
      (brandLocations ?? []).map((l) => [l.brand_id, l.id]),
    );
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    return rows.flatMap((row) => {
      const restaurantId =
        row.restaurant_id ?? brandLocation.get(row.brand_id ?? "");
      if (!restaurantId) return [];
      return [
        {
          id: row.id,
          user_id: row.user_id,
          rating: Number(row.rating),
          notes: row.notes?.trim() || null,
          visited_at: row.visited_at,
          restaurantId,
          restaurantName: row.restaurant_id
            ? (row.restaurants?.brands?.name ?? row.restaurants?.name ?? "")
            : (brandName.get(row.brand_id ?? "") ?? ""),
          city: row.restaurant_id ? (row.restaurants?.city ?? null) : null,
          profiles: profileById.get(row.user_id) ?? null,
          tagged: tags
            .filter((tag) => tag.restaurant_rating_id === row.id)
            .flatMap((tag) => {
              const profile = profileById.get(tag.tagged_user_id);
              return profile
                ? [{ id: profile.id, username: profile.username }]
                : [];
            }),
        },
      ];
    });
  }
  function formatDate(date: string | null, fallback: string) {
    if (date) {
      return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    return new Date(fallback).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  function toggleExpanded(reviewId: string) {
    setExpandedReviews((old) =>
      old.includes(reviewId)
        ? old.filter((id) => id !== reviewId)
        : [...old, reviewId],
    );
  }
  function openReview(reviewId: string) {
    router.push({ pathname: "/review/[id]", params: { id: reviewId } });
  }
  function getPhotoUrl(path: string) {
    const { data } = supabase.storage.from("review-photos").getPublicUrl(path);
    return data.publicUrl;
  }
  function getProfilePhotoUrl(path: string) {
    const { data } = supabase.storage.from("profile-photos").getPublicUrl(path);
    return data.publicUrl;
  }
  function renderUserRow(
    userId: string,
    profile: FeedItem["profiles"],
    dateLine: string,
  ) {
    const isOwnPost = userId === currentUserId;
    const profilePhotoUrl = profile?.avatar_path
      ? getProfilePhotoUrl(profile.avatar_path)
      : null;
    return (
      <TouchableOpacity
        onPress={() => {
          if (isOwnPost) {
            router.push("/profile");
          } else {
            router.push(`/user/${userId}`);
          }
        }}
      >
        <View style={styles.userRow}>
          {profilePhotoUrl ? (
            <Image
              source={{
                uri: profilePhotoUrl,
              }}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(profile?.display_name || profile?.username || "U")
                  .charAt(0)
                  .toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.userInfo}>
            <Text style={styles.userName}>
              {profile?.display_name || profile?.username || "User"}
              {isOwnPost ? " · You" : ""}
            </Text>
            <Text style={styles.userHandle}>
              @{profile?.username ?? "unknown"}
            </Text>
            <Text style={styles.date}>{dateLine}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }
  function renderRestaurantCard(item: RestaurantFeedItem) {
    const openRestaurant = () =>
      router.push({
        pathname: "/restaurant/[id]",
        params: { id: item.restaurantId },
      });
    return (
      <View key={`restaurant-${item.id}`} style={styles.card}>
        {renderUserRow(
          item.user_id,
          item.profiles,
          `Visited ${formatDate(null, item.visited_at)}`,
        )}
        <View style={styles.foodRow}>
          <View style={styles.foodInfo}>
            <Text style={styles.restaurantLabel}>Rated the restaurant</Text>
            <TouchableOpacity onPress={openRestaurant}>
              <Text style={styles.dishName}>
                {item.restaurantName}
                {item.city ? ` · ${item.city}` : ""}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.rating}>
            {formatRating(item.rating, isPremium)}★
          </Text>
        </View>
        {item.notes ? <Text style={styles.review}>{item.notes}</Text> : null}
        {item.tagged.length > 0 ? (
          <View style={styles.wentWithRow}>
            <Text style={styles.wentWithLabel}>Went with </Text>
            {item.tagged.map((friend, i) => (
              <TouchableOpacity
                key={friend.id}
                onPress={() =>
                  friend.id === currentUserId
                    ? router.push("/profile")
                    : router.push(`/user/${friend.id}`)
                }
              >
                <Text style={styles.tagLink}>
                  @{friend.username}
                  {i < item.tagged.length - 1 ? ", " : ""}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Wotri</Text>
      <Text style={styles.subtitle}>
        See what you and your friends are eating.
      </Text>
      {feed.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Your feed is empty</Text>
          <Text style={styles.emptyText}>
            Log a dish or follow people in Discover to start building your feed.
          </Text>
        </View>
      ) : (
        feed.map((entry) => {
          if (entry.kind === "restaurant") {
            return renderRestaurantCard(entry.item);
          }
          const item = entry.item;
          const commentCount = item.review_comments?.length ?? 0;
          const expanded = expandedReviews.includes(item.id);
          const reviewText = item.review_text ?? "";
          const isLong = reviewText.length > 240;
          const visibleText =
            isLong && !expanded
              ? reviewText.slice(0, 240).trimEnd() + "…"
              : reviewText;
          const restaurant = item.dishes?.restaurants;
          const photoUrl = item.photo_path
            ? getPhotoUrl(item.photo_path)
            : null;
          return (
            <View key={item.id} style={styles.card}>
              {renderUserRow(
                item.user_id,
                item.profiles,
                `Eaten ${formatDate(item.date_eaten, item.created_at)}`,
              )}
              <View style={styles.foodRow}>
                <View style={styles.foodInfo}>
                  <TouchableOpacity
                    onPress={() =>
                      router.push({
                        pathname: "/review/[id]",
                        params: {
                          id: item.id,
                        },
                      })
                    }
                  >
                    <Text style={styles.dishName}>
                      {item.dishes?.name ?? "Unknown dish"}
                    </Text>
                  </TouchableOpacity>
                  {restaurant ? (
                    <TouchableOpacity
                      onPress={() =>
                        router.push({
                          pathname: "/restaurant/[id]",
                          params: {
                            id: restaurant.id,
                          },
                        })
                      }
                    >
                      <Text style={styles.restaurantLink}>
                        {restaurant.name}
                        {restaurant.city ? ` · ${restaurant.city}` : ""}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.restaurantName}>
                      Unknown restaurant
                    </Text>
                  )}
                </View>
                <Text style={styles.rating}>{formatRating(item.rating, isPremium)}★</Text>
              </View>
              {photoUrl ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => openReview(item.id)}
                >
                  <Image
                    source={{ uri: photoUrl }}
                    style={styles.reviewPhoto}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ) : null}
              {reviewText.length > 0 ? (
                <View>
                  <Text style={styles.review}>{visibleText}</Text>
                  {isLong ? (
                    <TouchableOpacity onPress={() => toggleExpanded(item.id)}>
                      <Text style={styles.readMore}>
                        {expanded ? "Show less" : "Read more"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              {(item.review_tags ?? []).length > 0 ? (
                <View style={styles.wentWithRow}>
                  <Text style={styles.wentWithLabel}>Went with </Text>
                  {(item.review_tags ?? []).map((tag, i) => (
                    <TouchableOpacity
                      key={tag.tagged_user_id}
                      onPress={() => router.push(`/user/${tag.tagged_user_id}`)}
                    >
                      <Text style={styles.tagLink}>
                        @{tag.profiles?.username ?? "user"}
                        {i < item.review_tags.length - 1 ? ", " : ""}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <View style={styles.engagementRow}>
                {/* Every reaction counts as a like. */}
                {(item.review_reactions ?? []).length > 0 ? (
                  <View style={styles.engagementItem}>
                    <Text style={styles.engagementText}>
                      ♥ {(item.review_reactions ?? []).length}
                    </Text>
                  </View>
                ) : null}
                {commentCount > 0 ? (
                  <Text style={styles.commentCount}>
                    {commentCount} {commentCount === 1 ? "comment" : "comments"}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => openReview(item.id)}>
                <Text style={styles.viewReview}>View likes & comments</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 40,
    backgroundColor: Palette.background,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Palette.background,
  },
  title: {
    color: Palette.text,
    fontSize: 30,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 16,
    color: Palette.textSecondary,
    marginTop: 8,
    marginBottom: 24,
  },
  emptyState: {
    marginTop: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
  },
  emptyTitle: {
    color: Palette.text,
    fontSize: 18,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 15,
    color: Palette.textMuted,
    marginTop: 6,
    lineHeight: 21,
  },
  card: {
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Palette.elevated,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Palette.elevated,
    marginRight: 12,
  },
  avatarText: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: "700",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: "700",
  },
  userHandle: {
    fontSize: 13,
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
    fontSize: 18,
    fontWeight: "600",
  },
  restaurantName: {
    fontSize: 14,
    color: Palette.textSecondary,
    marginTop: 3,
  },
  restaurantLink: {
    fontSize: 14,
    color: Palette.textBody,
    marginTop: 3,
    fontWeight: "600",
  },
  restaurantLabel: {
    fontSize: 13,
    color: Palette.textMuted,
    fontWeight: "600",
    marginBottom: 2,
  },
  rating: {
    color: Palette.accent,
    fontSize: 18,
    fontWeight: "700",
  },
  reviewPhoto: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 14,
    marginTop: 14,
    backgroundColor: Palette.elevated,
  },
  review: {
    color: Palette.text,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 12,
  },
  engagementRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  engagementItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  engagementText: {
    fontSize: 14,
    color: Palette.textSecondary,
    fontWeight: "600",
  },
  commentCount: {
    fontSize: 13,
    color: Palette.textMuted,
    fontWeight: "600",
  },
  date: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 3,
  },
  readMore: {
    fontSize: 14,
    color: Palette.textSecondary,
    fontWeight: "700",
    marginTop: 5,
  },
  wentWithRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 12,
  },
  wentWithLabel: {
    fontSize: 14,
    color: Palette.textSecondary,
  },
  tagLink: {
    fontSize: 14,
    fontWeight: "600",
    color: Palette.accent,
  },
  viewReview: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 10,
    fontWeight: "600",
  },
});
