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
    const unreadKeys =
      notifications
        .filter(
          (item) =>
            !item.isRead
        )
        .map(
          (item) => item.id
        );

    if (
      unreadKeys.length === 0
    ) {
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

    const then =
      new Date(
        date
      ).getTime();

    const seconds =
      Math.floor(
        (now - then) / 1000
      );

    if (seconds < 60) {
      return 'Just now';
    }

    const minutes =
      Math.floor(
        seconds / 60
      );

    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours =
      Math.floor(
        minutes / 60
      );

    if (hours < 24) {
      return `${hours}h`;
    }

    const days =
      Math.floor(
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

const styles =
  StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: 24,
      paddingTop: 70,
      paddingBottom: 50,
      backgroundColor:
        '#ffffff',
    },

    centered: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        '#ffffff',
    },

    headerRow: {
      flexDirection: 'row',
      justifyContent:
        'space-between',
      alignItems:
        'flex-start',
      marginBottom: 26,
    },

    headerText: {
      flex: 1,
      paddingRight: 14,
    },

    title: {
      fontSize: 30,
      fontWeight: '700',
    },

    subtitle: {
      fontSize: 14,
      color: '#777777',
      marginTop: 5,
    },

    markAllButton: {
      borderWidth: 1,
      borderColor:
        '#dddddd',
      borderRadius: 9,
      paddingHorizontal: 11,
      paddingVertical: 8,
      marginTop: 2,
    },

    markAll: {
      fontSize: 12,
      fontWeight: '700',
      color: '#333333',
    },

    section: {
      marginTop: 2,
    },

    olderSection: {
      marginTop: 30,
    },

    sectionHeader: {
      flexDirection: 'row',
      alignItems:
        'center',
      marginBottom: 6,
    },

    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
    },

    countBadge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: 11,
      backgroundColor:
        '#111111',
      alignItems:
        'center',
      justifyContent:
        'center',
      marginLeft: 8,
    },

    countBadgeText: {
      color: '#ffffff',
      fontSize: 11,
      fontWeight: '700',
    },

    emptyState: {
      marginTop: 16,
      alignItems:
        'center',
      paddingVertical: 34,
      paddingHorizontal: 24,
      borderWidth: 1,
      borderColor:
        '#eeeeee',
      borderRadius: 16,
    },

    emptyIcon: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor:
        '#f3f3f3',
      alignItems:
        'center',
      justifyContent:
        'center',
      marginBottom: 14,
    },

    emptyIconText: {
      fontSize: 23,
    },

    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
    },

    emptyText: {
      fontSize: 14,
      color: '#777777',
      marginTop: 6,
      lineHeight: 20,
      textAlign:
        'center',
      maxWidth: 300,
    },

    notification: {
      flexDirection: 'row',
      alignItems:
        'flex-start',
      paddingVertical: 15,
      paddingHorizontal: 12,
      marginTop: 6,
      borderWidth: 1,
      borderColor:
        '#eeeeee',
      borderRadius: 14,
      backgroundColor:
        '#ffffff',
    },

    unreadNotification: {
      backgroundColor:
        '#f7f7f7',
      borderColor:
        '#dddddd',
    },

    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor:
        '#eeeeee',
      alignItems:
        'center',
      justifyContent:
        'center',
      marginRight: 12,
    },

    avatarText: {
      fontSize: 17,
      fontWeight: '700',
    },

    notificationBody: {
      flex: 1,
      paddingRight: 8,
    },

    notificationTopRow: {
      flexDirection: 'row',
      alignItems:
        'flex-start',
    },

    notificationText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: '#333333',
    },

    unreadText: {
      color: '#111111',
    },

    actorName: {
      fontWeight: '700',
    },

    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor:
        '#111111',
      marginLeft: 8,
      marginTop: 6,
    },

    commentPreviewBox: {
      marginTop: 7,
      backgroundColor:
        '#ffffff',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },

    commentPreview: {
      fontSize: 13,
      color: '#666666',
      lineHeight: 18,
    },

    time: {
      fontSize: 11,
      color: '#999999',
      marginTop: 7,
    },

    iconArea: {
      width: 30,
      alignItems:
        'center',
      paddingTop: 1,
    },

    notificationIcon: {
      fontSize: 19,
    },
  });