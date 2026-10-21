import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { DepartmentActivityChart } from '@/components/department-activity-chart';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function MarketingScreen() {
  const theme = useTheme();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Marketing</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Your marketing workspace: campaign chats, generated videos, and social posts.
        </ThemedText>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/marketing?ai=1' as Parameters<typeof router.push>[0])}
        style={({ hovered, pressed }) => [
          styles.chatButton,
          { opacity: hovered || pressed ? 0.82 : 1 },
        ]}
      >
        <ThemedText type="smallBold" style={{ color: AccentColors.primary }}>✦ Marketing chat</ThemedText>
      </Pressable>

      <DepartmentActivityChart department="marketing" />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ThemedText type="smallBold">Marketing activity</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Brainstorm campaign ideas, create videos, and manage publishing from Marketing chat.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, padding: Spacing.five, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: Spacing.one },
  chatButton: { alignSelf: 'flex-end', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderWidth: 1, borderRadius: Radius.control, borderColor: AccentColors.primary, backgroundColor: 'rgba(232, 197, 71, 0.07)' },
  card: { gap: Spacing.two, padding: Spacing.four, borderWidth: 1, borderRadius: Radius.card },
});
