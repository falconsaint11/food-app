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

import { ListsSection } from "@/components/lists-section";
import { RatingsChart } from "@/components/ratings-chart";
import { latestPhotoPaths, TopPickCard } from "@/components/top-pick-card";
import { Palette } from "@/constants/theme";

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_path: string | null;
  city: string | null;
  created_at: string;
};
type DiaryEntry = {
  id: string;
  rating: number;
  review_text: string | null;
  photo_path: string | null;
  date_eaten: string;
  dishes: {
    id: string;
    name: string;
    restaurants: {
      id: string;
      name: string;
      city: string | null;
      brand_id: string | null;
    } | null;
  } | null;
};
type RankedDish = {
  id: string;
  rank: number;
  dishes: {
    id: string;
    name: string;
    restaurants: {
      id: string;
      name: string;
    } | null;
  } | null;
};
type RankedRestaurant = {
  id: string;
  rank: number;
  restaurants: {
    id: string;
    name: string;
    city: string | null;
    brand_id: string | null;
  } | null;
};
export default function ProfileScreen() {
  const isPremium = useIsPremium();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [topDishes, setTopDishes] = useState<RankedDish[]>([]);
  const [topRestaurants, setTopRestaurants] = useState<RankedRestaurant[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [dishCount, setDishCount] = useState(0);
  const [restaurantCount, setRestaurantCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, []),
  );
  async function loadProfile() {
    setLoading(true);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setLoading(false);
      Alert.alert("Error", "No signed-in user found.");
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      setLoading(false);
      Alert.alert("Profile error", error.message);
      return;
    }
    if (!data) {
      setLoading(false);
      setProfile(null);
      return;
    }
    setProfile(data);
    const { data: diaryData, error: diaryError } = await supabase
      .from("reviews")
      .select(
        `
        id,
        rating,
        review_text,
        photo_path,
        date_eaten,
        dishes (
          id,
          name,
          restaurants (
            id,
            name,
            city,
            brand_id
          )
        )
      `,
      )
      .eq("user_id", user.id)
      .order("date_eaten", {
        ascending: false,
      })
      .order("created_at", {
        ascending: false,
      });
    if (diaryError) {
      setLoading(false);
      Alert.alert("Diary error", diaryError.message);
      return;
    }
    const entries = (diaryData ?? []) as unknown as DiaryEntry[];
    setDiary(entries);
    setReviewCount(entries.length);
    const uniqueDishIds = new Set(
      entries.map((entry) => entry.dishes?.id).filter(Boolean),
    );
    setDishCount(uniqueDishIds.size);
    const uniqueRestaurantIds = new Set(
      entries.map((entry) => entry.dishes?.restaurants?.id).filter(Boolean),
    );
    setRestaurantCount(uniqueRestaurantIds.size);
    const { data: rankedDishData, error: rankedDishError } = await supabase
      .from("dish_rankings")
      .select(
        `
        id,
        rank,
        dishes (
          id,
          name,
          restaurants (
            id,
            name
          )
        )
      `,
      )
      .eq("user_id", user.id)
      .order("rank", {
        ascending: true,
      });
    if (rankedDishError) {
      setLoading(false);
      Alert.alert("Ranking error", rankedDishError.message);
      return;
    }
    setTopDishes((rankedDishData ?? []) as unknown as RankedDish[]);
    const { data: rankedRestaurantData, error: rankedRestaurantError } =
      await supabase
        .from("restaurant_rankings")
        .select(
          `
        id,
        rank,
        restaurants (
          id,
          name,
          city,
          brand_id
        )
      `,
        )
        .eq("user_id", user.id)
        .order("rank", {
          ascending: true,
        });
    if (rankedRestaurantError) {
      setLoading(false);
      Alert.alert("Ranking error", rankedRestaurantError.message);
      return;
    }
    setTopRestaurants(
      (rankedRestaurantData ?? []) as unknown as RankedRestaurant[],
    );
    const { count: followers, error: followerError } = await supabase
      .from("follows")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("following_id", user.id);
    if (followerError) {
      setLoading(false);
      Alert.alert("Follower error", followerError.message);
      return;
    }
    setFollowerCount(followers ?? 0);
    const { count: following, error: followingError } = await supabase
      .from("follows")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("follower_id", user.id);
    if (followingError) {
      setLoading(false);
      Alert.alert("Following error", followingError.message);
      return;
    }
    setFollowingCount(following ?? 0);
    setLoading(false);
  }
  function formatDate(date: string) {
    const parsedDate = new Date(`${date}T00:00:00`);
    return parsedDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  function getPhotoUrl(path: string) {
    const { data } = supabase.storage.from("review-photos").getPublicUrl(path);
    return data.publicUrl;
  }
  function getProfilePhotoUrl(path: string) {
    const { data } = supabase.storage.from("profile-photos").getPublicUrl(path);
    return data.publicUrl;
  }
  // Top picks show the user's newest photo of that dish or restaurant.
  const topPhotos = latestPhotoPaths(diary);
  function getTopPhotoUrl(paths: Map<string, string>, id: string | undefined) {
    const path = id ? paths.get(id) : undefined;
    return path ? getPhotoUrl(path) : null;
  }

  function confirmSignOut() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.auth.signOut();

          if (error) {
            Alert.alert("Sign out error", error.message);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.noProfileTitle}>No profile yet</Text>
        <Text style={styles.noProfileText}>
          Create a profile to start using the app.
        </Text>
        <TouchableOpacity
          style={styles.createProfileButton}
          onPress={() => router.push("/create-profile")}
        >
          <Text style={styles.createProfileButtonText}>Create Profile</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={confirmSignOut}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.profileHeader}>
        {profile.avatar_path ? (
          <Image
            source={{
              uri: getProfilePhotoUrl(profile.avatar_path),
            }}
            style={styles.profileAvatar}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {(profile.display_name || profile.username)
                .charAt(0)
                .toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={styles.displayName}>
          {profile.display_name || profile.username}
        </Text>
        <Text style={styles.username}>@{profile.username}</Text>

        {profile.city?.trim() ? (
          <View style={styles.cityRow}>
            <Text style={styles.cityPin}>📍</Text>
            <Text style={styles.cityText}>{profile.city.trim()}</Text>
          </View>
        ) : null}
        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        <View style={styles.profileActions}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.push("/edit-profile")}
          >
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.push("/settings")}
          >
            <Text style={styles.editButtonText}>⚙️ Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.statsCard}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{reviewCount}</Text>
          <Text style={styles.statLabel}>Reviews</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{dishCount}</Text>
          <Text style={styles.statLabel}>Dishes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{restaurantCount}</Text>
          <Text style={styles.statLabel}>Restaurants</Text>
        </View>
      </View>
      <View style={styles.socialStats}>
        <TouchableOpacity
          style={styles.socialStat}
          onPress={() =>
            router.push({
              pathname: "/followers",
              params: {
                userId: profile.id,
              },
            })
          }
        >
          <Text style={styles.socialNumber}>{followerCount}</Text>
          <Text style={styles.socialLabel}>
            {followerCount === 1 ? "Follower" : "Followers"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.socialStat}
          onPress={() =>
            router.push({
              pathname: "/following",
              params: {
                userId: profile.id,
              },
            })
          }
        >
          <Text style={styles.socialNumber}>{followingCount}</Text>
          <Text style={styles.socialLabel}>Following</Text>
        </TouchableOpacity>
      </View>

      <ListsSection userId={profile.id} isOwner />

      <TouchableOpacity
        style={styles.compareButton}
        activeOpacity={0.7}
        onPress={() => router.push("/compare")}
      >
        <Text style={styles.compareTitle}>Which was better?</Text>
        <Text style={styles.compareSubtext}>
          Settle close calls between dishes and restaurants you rated the same
        </Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Top Dishes</Text>
          <TouchableOpacity onPress={() => router.push("/rank-dishes")}>
            <Text style={styles.rankLink}>Edit Ranking</Text>
          </TouchableOpacity>
        </View>
        {topDishes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Nothing ranked yet.</Text>
          </View>
        ) : (
          <View style={styles.featureGrid}>
            {topDishes.slice(0, 4).map((item) => (
              <TopPickCard
                key={item.id}
                rank={item.rank}
                title={item.dishes?.name ?? "Unknown dish"}
                subtitle={item.dishes?.restaurants?.name ?? "Unknown restaurant"}
                photoUrl={getTopPhotoUrl(topPhotos.byDish, item.dishes?.id)}
                onPress={() => {
                  if (!item.dishes?.id) return;
                  router.push({ pathname: "/dish/[id]", params: { id: item.dishes.id } });
                }}
              />
            ))}
          </View>
        )}
      </View>
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Top Restaurants</Text>
          <TouchableOpacity onPress={() => router.push("/rank-restaurants")}>
            <Text style={styles.rankLink}>Edit Ranking</Text>
          </TouchableOpacity>
        </View>
        {topRestaurants.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Nothing ranked yet.</Text>
          </View>
        ) : (
          <View style={styles.featureGrid}>
            {topRestaurants.slice(0, 4).map((item) => (
              <TopPickCard
                key={item.id}
                rank={item.rank}
                title={item.restaurants?.name ?? "Unknown restaurant"}
                subtitle={item.restaurants?.city ?? "Location unknown"}
                photoUrl={getTopPhotoUrl(
                  topPhotos.byRestaurant,
                  item.restaurants?.brand_id ?? item.restaurants?.id,
                )}
                onPress={() => {
                  if (!item.restaurants?.id) return;
                  router.push({
                    pathname: "/restaurant/[id]",
                    params: { id: item.restaurants.id },
                  });
                }}
              />
            ))}
          </View>
        )}
      </View>
      <RatingsChart userId={profile.id} />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Diary</Text>
          {diary.length > 0 ? (
            <TouchableOpacity onPress={() => router.push("/diary")}>
              <Text style={styles.rankLink}>See All</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {diary.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Nothing logged yet.</Text>
          </View>
        ) : (
          diary.slice(0, 3).map((entry) => {
            const photoUrl = entry.photo_path
              ? getPhotoUrl(entry.photo_path)
              : null;
            return (
              <TouchableOpacity
                key={entry.id}
                style={styles.diaryCard}
                activeOpacity={0.7}
                onPress={() =>
                  router.push({
                    pathname: "/review/[id]",
                    params: {
                      id: entry.id,
                    },
                  })
                }
              >
                <View style={styles.diaryContentRow}>
                  {photoUrl ? (
                    <Image
                      source={{
                        uri: photoUrl,
                      }}
                      style={styles.diaryThumbnail}
                      resizeMode="cover"
                    />
                  ) : null}
                  <View style={styles.diaryMainContent}>
                    <View style={styles.diaryTopRow}>
                      <View style={styles.diaryInfo}>
                        <Text style={styles.dishName}>
                          {entry.dishes?.name ?? "Unknown dish"}
                        </Text>
                        <Text style={styles.restaurantName} numberOfLines={1}>
                          {entry.dishes?.restaurants?.name ??
                            "Unknown restaurant"}
                          {entry.dishes?.restaurants?.city
                            ? ` · ${entry.dishes.restaurants.city}`
                            : ""}
                        </Text>
                      </View>
                      <View style={styles.diaryRight}>
                        <Text style={styles.rating}>{formatRating(entry.rating, isPremium)}★</Text>
                        <Text style={styles.dateText}>
                          {formatDate(entry.date_eaten)}
                        </Text>
                      </View>
                    </View>
                    {entry.review_text ? (
                      <Text style={styles.reviewText} numberOfLines={2}>
                        {entry.review_text}
                      </Text>
                    ) : null}
                    <Text style={styles.viewReview}>View review</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 55,
    paddingBottom: 60,
    backgroundColor: Palette.background,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Palette.background,
  },
  noProfileTitle: {
    color: Palette.text,
    fontSize: 24,
    fontWeight: "700",
  },
  noProfileText: {
    fontSize: 15,
    color: Palette.textSecondary,
    marginTop: 8,
    marginBottom: 20,
  },
  createProfileButton: {
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  createProfileButtonText: {
    color: Palette.text,
    fontSize: 15,
    fontWeight: "600",
  },
  profileHeader: {
    alignItems: "center",
  },
  profileAvatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: Palette.elevated,
  },
  avatarPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: Palette.elevated,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: Palette.text,
    fontSize: 34,
    fontWeight: "700",
  },
  displayName: {
    color: Palette.text,
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 14,
  },
  username: {
    fontSize: 15,
    textAlign: "center",
    marginTop: 3,
    color: Palette.textMuted,
  },
  cityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 9,
    gap: 6,
  },
  cityPin: { fontSize: 17, color: "#FF5722", fontWeight: "700" },
  cityText: { fontSize: 14, color: Palette.textSecondary },

  bio: {
    fontSize: 15,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 21,
    color: Palette.textBody,
    maxWidth: 320,
  },
  profileActions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    gap: 10,
  },
  editButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 10,
  },
  editButtonText: {
    color: Palette.text,
    fontSize: 14,
    fontWeight: "600",
  },

  signOutButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  signOutText: {
    fontSize: 14,
    color: Palette.danger,
    fontWeight: "600",
  },
  statsCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    marginTop: 28,
    paddingVertical: 17,
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    backgroundColor: Palette.elevated,
  },
  statNumber: {
    color: Palette.text,
    fontSize: 20,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
    color: Palette.textMuted,
  },
  socialStats: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 14,
    gap: 36,
  },
  socialStat: {
    alignItems: "center",
    minWidth: 80,
  },
  socialNumber: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: "700",
  },
  socialLabel: {
    fontSize: 13,
    color: Palette.textSecondary,
    marginTop: 2,
  },
  section: {
    marginTop: 32,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    color: Palette.text,
    fontSize: 21,
    fontWeight: "700",
  },
  compareButton: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: Palette.accent,
    borderRadius: 14,
    padding: 16,
  },
  compareTitle: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: "700",
  },
  compareSubtext: {
    color: Palette.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  rankLink: {
    fontSize: 14,
    fontWeight: "600",
    color: Palette.textSecondary,
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 8,
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    padding: 16,
  },
  emptyText: {
    fontSize: 14,
    color: Palette.textMuted,
  },
  diaryCard: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  diaryContentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  diaryThumbnail: {
    width: 88,
    height: 88,
    borderRadius: 12,
    marginRight: 13,
    backgroundColor: Palette.elevated,
  },
  diaryMainContent: {
    flex: 1,
  },
  diaryTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  diaryInfo: {
    flex: 1,
    paddingRight: 10,
  },
  diaryRight: {
    alignItems: "flex-end",
  },
  dishName: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: "700",
  },
  restaurantName: {
    fontSize: 13,
    color: Palette.textSecondary,
    marginTop: 3,
  },
  rating: {
    color: Palette.accent,
    fontSize: 17,
    fontWeight: "700",
  },
  dateText: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 3,
  },
  reviewText: {
    fontSize: 14,
    marginTop: 8,
    lineHeight: 19,
    color: Palette.textBody,
  },
  viewReview: {
    fontSize: 12,
    color: Palette.textMuted,
    fontWeight: "600",
    marginTop: 7,
  },
});
