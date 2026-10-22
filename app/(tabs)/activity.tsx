import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationItem,
} from '@/lib/notifications';

import { supabase } from '@/lib/supabase';
import { Palette } from '@/constants/theme';

type AvatarMap = {
  [userId: string]: string | null;
};

export default function ActivityScreen() {
  const [notifications, setNotifications] = useState<
    NotificationItem[]
  >([]);

  const [avatarPaths, setAvatarPaths] = useState<AvatarMap>({});

  const [loading, setLoading] = useState(true);

  const [markingAll, setMarkingAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadActivity();
    }, [])
  );

  function getProfilePhotoUrl(path: string) {
    const { data } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async function loadActivity() {
    setLoading(true);

    try {
      const data = await getNotifications();

      setNotifications(data);

      const actorIds = [
        ...new Set(
          data
            .map((item) => item.actorId)
            .filter(Boolean)
        ),
      ];

      if (actorIds.length === 0) {
        setAvatarPaths({});
        return;
      }

      const {
        data: profileData,
        error: profileError,
      } = await supabase
        .from('profiles')
        .select('id, avatar_path')
        .in('id', actorIds);

      if (profileError) {
        console.log(
          'Could not load notification profile photos:',
          profileError
        );

        setAvatarPaths({});

        return;
      }

      const nextAvatarPaths: AvatarMap = {};

      (profileData ?? []).forEach((profile) => {
        nextAvatarPaths[profile.id] =
          profile.avatar_path ?? null;
      });

      setAvatarPaths(nextAvatarPaths);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not load activity.';

      Alert.alert(
        'Activity error',
        message
      );
    } finally {
      setLoading(false);
    }
  }

  async function openNotification(
    item: NotificationItem
  ) {
    if (!item.isRead) {
      try {
        await markNotificationRead(
          item.id
        );

        setNotifications(
          (current) =>
            current.map(
              (notification) =>
                notification.id ===
                item.id
                  ? {
                      ...notification,
                      isRead: true,
                    }
                  : notification
            )
        );
      } catch (error) {
        console.log(
          'Could not mark notification read:',
          error
        );
      }
    }

    if (item.type === 'follow') {
      router.push({
        pathname: '/user/[id]',
        params: {
          id: item.actorId,
        },
      });

      return;
    }

    if (item.reviewId) {
      router.push({
        pathname: '/review/[id]',
        params: {
          id: item.reviewId,
        },
      });
    }
  }

  async function handleMarkAllRead() {
    const unreadKeys = notifications
      .filter(
        (item) => !item.isRead
      )
      .map(
        (item) => item.id
      );

    if (unreadKeys.length === 0) {
      return;
    }

    setMarkingAll(true);

    try {
      await markAllNotificationsRead(
        unreadKeys
      );

      setNotifications(
        (current) =>
          current.map(
            (item) => ({
              ...item,
              isRead: true,
            })
          )
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not mark notifications as read.';

      Alert.alert(
        'Error',
        message
      );
    } finally {
      setMarkingAll(false);
    }
  }

  function formatTimeAgo(
    date: string
  ) {
    const now = Date.now();

    const then = new Date(
      date
    ).getTime();

    const seconds = Math.floor(
      (now - then) / 1000
    );

    if (seconds < 60) {
      return 'Just now';
    }

    const minutes = Math.floor(
      seconds / 60
    );

    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours = Math.floor(
      minutes / 60
    );

    if (hours < 24) {
      return `${hours}h`;
    }

    const days = Math.floor(
      hours / 24
    );

    if (days < 7) {
      return `${days}d`;
    }

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

  function getNotificationText(
    item: NotificationItem
  ) {
    if (
      item.type === 'follow'
    ) {
      return 'started following you.';
    }

    if (
      item.type === 'reaction'
    ) {
      return `reacted ${item.reaction} to your review of ${item.dishName}.`;
    }

    return `commented on your review of ${item.dishName}.`;
  }

  function getNotificationIcon(
    item: NotificationItem
  ) {
    if (
      item.type === 'follow'
    ) {
      return '👤';
    }

    if (
      item.type === 'reaction'
    ) {
      return (
        item.reaction ??
        '❤️'
      );
    }

    return '💬';
  }

  function renderNotification(
    item: NotificationItem
  ) {
    const avatarPath =
      avatarPaths[item.actorId];

    return (
      <TouchableOpacity
        key={item.id}
        style={[
          styles.notification,
          !item.isRead &&
            styles.unreadNotification,
        ]}
        activeOpacity={0.7}
        onPress={() =>
          openNotification(
            item
          )
        }
      >
        {avatarPath ? (
          <Image
            source={{
              uri: getProfilePhotoUrl(
                avatarPath
              ),
            }}
            style={
              styles.avatarImage
            }
            resizeMode="cover"
          />
        ) : (
          <View
            style={
              styles.avatar
            }
          >
            <Text
              style={
                styles.avatarText
              }
            >
              {item.actorName
                .charAt(0)
                .toUpperCase()}
            </Text>
          </View>
        )}

        <View
          style={
            styles.notificationBody
          }
        >
          <View
            style={
              styles.notificationTopRow
            }
          >
            <Text
              style={[
                styles.notificationText,
                !item.isRead &&
                  styles.unreadText,
              ]}
            >
              <Text
                style={
                  styles.actorName
                }
              >
                {item.actorName}
              </Text>{' '}
              {getNotificationText(
                item
              )}
            </Text>

            {!item.isRead ? (
              <View
                style={
                  styles.unreadDot
                }
              />
            ) : null}
          </View>

          {item.type ===
            'comment' &&
          item.commentText ? (
            <View
              style={
                styles.commentPreviewBox
              }
            >
              <Text
                style={
                  styles.commentPreview
                }
                numberOfLines={2}
              >
                “{item.commentText}”
              </Text>
            </View>
          ) : null}

          <Text
            style={
              styles.time
            }
          >
            {formatTimeAgo(
              item.createdAt
            )}
          </Text>
        </View>

        <View
          style={
            styles.iconArea
          }
        >
          <Text
            style={
              styles.notificationIcon
            }
          >
            {getNotificationIcon(
              item
            )}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  const unreadNotifications =
    notifications.filter(
      (item) =>
        !item.isRead
    );

  const readNotifications =
    notifications.filter(
      (item) =>
        item.isRead
    );

  const unreadCount =
    unreadNotifications.length;

  if (loading) {
    return (
      <View
        style={
          styles.centered
        }
      >
        <ActivityIndicator
          size="large"
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={
        styles.container
      }
    >
      <View
        style={
          styles.headerRow
        }
      >
        <View
          style={
            styles.headerText
          }
        >
          <Text
            style={
              styles.title
            }
          >
            Activity
          </Text>

          <Text
            style={
              styles.subtitle
            }
          >
            {unreadCount > 0
              ? `${unreadCount} unread ${
                  unreadCount === 1
                    ? 'notification'
                    : 'notifications'
                }`
              : 'You’re all caught up.'}
          </Text>
        </View>

        {unreadCount > 0 ? (
          <TouchableOpacity
            style={
              styles.markAllButton
            }
            onPress={
              handleMarkAllRead
            }
            disabled={
              markingAll
            }
          >
            <Text
              style={
                styles.markAll
              }
            >
              {markingAll
                ? 'Marking...'
                : 'Mark all read'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {notifications.length ===
      0 ? (
        <View
          style={
            styles.emptyState
          }
        >
          <View
            style={
              styles.emptyIcon
            }
          >
            <Text
              style={
                styles.emptyIconText
              }
            >
              🔔
            </Text>
          </View>

          <Text
            style={
              styles.emptyTitle
            }
          >
            No activity yet
          </Text>

          <Text
            style={
              styles.emptyText
            }
          >
            When people follow you,
            react to your reviews, or
            leave comments, you’ll see
            it here.
          </Text>
        </View>
      ) : (
        <>
          {unreadNotifications.length >
          0 ? (
            <View
              style={
                styles.section
              }
            >
              <View
                style={
                  styles.sectionHeader
                }
              >
                <Text
                  style={
                    styles.sectionTitle
                  }
                >
                  New
                </Text>

                <View
                  style={
                    styles.countBadge
                  }
                >
                  <Text
                    style={
                      styles.countBadgeText
                    }
                  >
                    {
                      unreadNotifications.length
                    }
                  </Text>
                </View>
              </View>

              {unreadNotifications.map(
                renderNotification
              )}
            </View>
          ) : null}

          {readNotifications.length >
          0 ? (
            <View
              style={[
                styles.section,
                unreadNotifications.length >
                  0 &&
                  styles.olderSection,
              ]}
            >
              <Text
                style={
                  styles.sectionTitle
                }
              >
                Earlier
              </Text>

              {readNotifications.map(
                renderNotification
              )}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 70,
    paddingBottom: 50,
    backgroundColor: Palette.background,
  },

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Palette.background,
  },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 26,
  },

  headerText: {
    flex: 1,
    paddingRight: 14,
  },

  title: {
    color: Palette.text,
    fontSize: 30,
    fontWeight: '700',
  },

  subtitle: {
    fontSize: 14,
    color: Palette.textMuted,
    marginTop: 5,
  },

  markAllButton: {
    borderWidth: 1,
    borderColor: Palette.borderStrong,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
    marginTop: 2,
  },

  markAll: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.textBody,
  },

  section: {
    marginTop: 2,
  },

  olderSection: {
    marginTop: 30,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },

  sectionTitle: {
    color: Palette.text,
    fontSize: 18,
    fontWeight: '700',
  },

  countBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: Palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  countBadgeText: {
    color: Palette.text,
    fontSize: 11,
    fontWeight: '700',
  },

  emptyState: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 34,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
  },

  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },

  emptyIconText: {
    color: Palette.text,
    fontSize: 23,
  },

  emptyTitle: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '700',
  },

  emptyText: {
    fontSize: 14,
    color: Palette.textMuted,
    marginTop: 6,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 300,
  },

  notification: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 15,
    paddingHorizontal: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 14,
    backgroundColor: Palette.background,
  },

  unreadNotification: {
    backgroundColor: Palette.surface,
    borderColor: Palette.borderStrong,
  },

  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Palette.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  avatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Palette.elevated,
    marginRight: 12,
  },

  avatarText: {
    color: Palette.text,
    fontSize: 17,
    fontWeight: '700',
  },

  notificationBody: {
    flex: 1,
    paddingRight: 8,
  },

  notificationTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  notificationText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: Palette.textBody,
  },

  unreadText: {
    color: Palette.text,
  },

  actorName: {
    color: Palette.text,
    fontWeight: '700',
  },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.accent,
    marginLeft: 8,
    marginTop: 6,
  },

  commentPreviewBox: {
    marginTop: 7,
    backgroundColor: Palette.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },

  commentPreview: {
    fontSize: 13,
    color: Palette.textSecondary,
    lineHeight: 18,
  },

  time: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 7,
  },

  iconArea: {
    width: 30,
    alignItems: 'center',
    paddingTop: 1,
  },

  notificationIcon: {
    color: Palette.text,
    fontSize: 19,
  },
});