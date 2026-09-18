import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

export default function ActivityScreen() {
  const [notifications, setNotifications] = useState<
    NotificationItem[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadActivity();
    }, [])
  );

  async function loadActivity() {
    setLoading(true);

    try {
      const data = await getNotifications();
      setNotifications(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not load activity.';

      Alert.alert('Activity error', message);
    } finally {
      setLoading(false);
    }
  }

  async function openNotification(
    item: NotificationItem
  ) {
    if (!item.isRead) {
      try {
        await markNotificationRead(item.id);

        setNotifications((current) =>
          current.map((notification) =>
            notification.id === item.id
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
      .filter((item) => !item.isRead)
      .map((item) => item.id);

    if (unreadKeys.length === 0) {
      return;
    }

    setMarkingAll(true);

    try {
      await markAllNotificationsRead(unreadKeys);

      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          isRead: true,
        }))
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not mark notifications as read.';

      Alert.alert('Error', message);
    } finally {
      setMarkingAll(false);
    }
  }

  function formatTimeAgo(date: string) {
    const now = Date.now();
    const then = new Date(date).getTime();

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

    return new Date(date).toLocaleDateString(
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
    if (item.type === 'follow') {
      return 'started following you.';
    }

    if (item.type === 'reaction') {
      return `reacted ${item.reaction} to your review of ${item.dishName}.`;
    }

    return `commented on your review of ${item.dishName}.`;
  }

  function getNotificationIcon(
    item: NotificationItem
  ) {
    if (item.type === 'follow') {
      return '👤';
    }

    if (item.type === 'reaction') {
      return item.reaction ?? '❤️';
    }

    return '💬';
  }

  const unreadCount = notifications.filter(
    (item) => !item.isRead
  ).length;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            Activity
          </Text>

          <Text style={styles.subtitle}>
            Reactions, comments, and new followers.
          </Text>
        </View>

        {unreadCount > 0 ? (
          <TouchableOpacity
            onPress={handleMarkAllRead}
            disabled={markingAll}
          >
            <Text style={styles.markAll}>
              {markingAll
                ? '...'
                : 'Mark all read'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>
            No notifications yet
          </Text>

          <Text style={styles.emptyText}>
            When people follow you, react to your
            reviews, or leave comments, you&apos;ll
            see it here.
          </Text>
        </View>
      ) : (
        notifications.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[
              styles.notification,
              !item.isRead &&
                styles.unreadNotification,
            ]}
            activeOpacity={0.7}
            onPress={() =>
              openNotification(item)
            }
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.actorName
                  .charAt(0)
                  .toUpperCase()}
              </Text>
            </View>

            <View style={styles.notificationBody}>
              <View style={styles.notificationTopRow}>
                <Text
                  style={[
                    styles.notificationText,
                    !item.isRead &&
                      styles.unreadText,
                  ]}
                >
                  <Text style={styles.actorName}>
                    {item.actorName}
                  </Text>{' '}
                  {getNotificationText(item)}
                </Text>

                {!item.isRead ? (
                  <View style={styles.unreadDot} />
                ) : null}
              </View>

              {item.type === 'comment' &&
              item.commentText ? (
                <Text
                  style={styles.commentPreview}
                  numberOfLines={2}
                >
                  &quot;{item.commentText}&quot;
                </Text>
              ) : null}

              <Text style={styles.time}>
                {formatTimeAgo(
                  item.createdAt
                )}
              </Text>
            </View>

            <Text style={styles.notificationIcon}>
              {getNotificationIcon(item)}
            </Text>
          </TouchableOpacity>
        ))
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
    backgroundColor: '#ffffff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerText: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginTop: 8,
  },
  markAll: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
  },
  emptyState: {
    marginTop: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 15,
    color: '#777777',
    marginTop: 6,
    lineHeight: 21,
  },
  notification: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 16,
    paddingHorizontal: 10,
    marginHorizontal: -10,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  unreadNotification: {
    backgroundColor: '#f7f7f7',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#eeeeee',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 17,
    fontWeight: '700',
  },
  notificationBody: {
    flex: 1,
    paddingRight: 10,
  },
  notificationTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  notificationText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: '#222222',
  },
  unreadText: {
    fontWeight: '500',
  },
  actorName: {
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#111111',
    marginLeft: 8,
    marginTop: 6,
  },
  commentPreview: {
    fontSize: 14,
    color: '#666666',
    marginTop: 5,
    lineHeight: 19,
  },
  time: {
    fontSize: 12,
    color: '#999999',
    marginTop: 6,
  },
  notificationIcon: {
    fontSize: 20,
    marginTop: 2,
  },
});