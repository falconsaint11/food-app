import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Food App</Text>
      <Text style={styles.subtitle}>
        See what your friends are eating.
      </Text>

      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No activity yet</Text>
        <Text style={styles.emptyText}>
          Follow people and start logging dishes to build your feed.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 70,
    backgroundColor: '#ffffff',
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
  emptyState: {
    marginTop: 40,
    padding: 24,
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
    marginTop: 8,
    lineHeight: 21,
  },
});