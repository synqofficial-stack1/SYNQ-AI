import { router, usePathname } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Tab = { label: string; path: string };

/** Department sub-navigation. Kept out of the global sidebar on purpose: these
 *  are context inside a department, not top-level destinations. */
export function TabStrip({ tabs }: { tabs: Tab[] }) {
  const theme = useTheme();
  const pathname = usePathname();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {tabs.map((tab) => {
        const active = pathname === tab.path;
        return (
          <Pressable
            key={tab.path}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => router.push(tab.path as Parameters<typeof router.push>[0])}
            style={({ hovered }) => [
              styles.tab,
              {
                backgroundColor: active
                  ? theme.backgroundSelected
                  : hovered
                    ? theme.surfaceRaised
                    : 'transparent',
                borderColor: active ? AccentColors.primary : theme.border,
              },
            ]}
          >
            <ThemedText type="caption" style={{ color: active ? theme.text : theme.textSecondary }}>
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, paddingRight: Spacing.four },
  tab: {
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - 2,
  },
});
