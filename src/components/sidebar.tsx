import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, SidebarWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type NavEntry = {
  label: string;
  path: string;
  hint?: string;
  /** Extra paths that should keep this item highlighted, e.g. department tabs. */
  alsoMatches?: string[];
};

// Department pages (CRM, Cold Call, Follow-ups, Campaigns, Content) live on
// their department's tab strip rather than here — repeating them globally would
// mean two places to keep in step.
//
// Activity is reached from the dashboard's "View all" instead of taking a
// permanent sidebar slot.
const MAIN_NAV: NavEntry[] = [{ label: 'Dashboard', path: '/' }];

// Only Sales is wired to a real agent. Marketing exists so the department
// hierarchy is visible, and says so plainly rather than faking activity.
const DEPARTMENTS: NavEntry[] = [
  {
    label: 'Sales',
    path: '/sales',
    alsoMatches: ['/import-leads', '/cold-call', '/follow-ups'],
  },
  { label: 'Marketing', path: '/marketing' },
];

function NavItem({
  label,
  hint,
  active,
  onPress,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.navItem,
        {
          backgroundColor: active
            ? theme.backgroundSelected
            : hovered || pressed
              ? theme.surfaceRaised
              : 'transparent',
        },
      ]}
    >
      {/* A 2px rule rather than a glow: enough to find at a glance, quiet
          enough to ignore while reading the rest of the list. */}
      <View
        style={[
          styles.activeRule,
          { backgroundColor: active ? AccentColors.primary : 'transparent' },
        ]}
      />
      <ThemedText
        type="small"
        style={[styles.navLabel, { color: active ? theme.text : theme.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
      {hint ? (
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {hint}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionLabel}>
      {children}
    </ThemedText>
  );
}

export function Sidebar({
  onNavigate,
  onAddDepartment,
  onUpgrade,
  onOpenAssistant,
}: {
  onNavigate?: () => void;
  onAddDepartment: () => void;
  onUpgrade: () => void;
  onOpenAssistant: () => void;
}) {
  const theme = useTheme();
  const pathname = usePathname();

  const go = (path: string) => {
    router.push(path as Parameters<typeof router.push>[0]);
    onNavigate?.();
  };

  return (
    <View style={[styles.sidebar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.brand}>
        <ThemedText type="sectionTitle" style={styles.wordmark}>
          SYNQ
        </ThemedText>
      </View>

      <View style={styles.section}>
        {/* Above the navigation, not inside it: it opens a panel rather than
            going anywhere, and it's reachable from every page. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onOpenAssistant();
            onNavigate?.();
          }}
          style={({ hovered, pressed }) => [
            styles.assistantButton,
            {
              borderColor: hovered || pressed ? AccentColors.primary : theme.border,
              backgroundColor: hovered || pressed ? theme.surfaceRaised : 'transparent',
            },
          ]}
        >
          <ThemedText type="small" style={{ color: AccentColors.primary }}>
            ✦ Ask Synq
          </ThemedText>
        </Pressable>

        {MAIN_NAV.map((entry) => (
          <NavItem
            key={entry.path}
            label={entry.label}
            active={pathname === entry.path}
            onPress={() => go(entry.path)}
          />
        ))}
      </View>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <View style={styles.section}>
        <SectionLabel>DEPARTMENTS</SectionLabel>
        {DEPARTMENTS.map((entry) => (
          <NavItem
            key={entry.path}
            label={entry.label}
            hint={entry.hint}
            active={pathname === entry.path || (entry.alsoMatches?.includes(pathname) ?? false)}
            onPress={() => go(entry.path)}
          />
        ))}
        <NavItem label="+ Add department" active={false} onPress={onAddDepartment} />
      </View>

      <View style={styles.spacer} />

      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          onPress={onUpgrade}
          style={({ hovered }) => [
            styles.upgradeCard,
            {
              borderColor: hovered ? AccentColors.primary : theme.border,
              backgroundColor: theme.surfaceRaised,
            },
          ]}
        >
          <ThemedText type="caption" style={{ color: AccentColors.primary }}>
            ✦ Synq Pro
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            Unlock more departments and advanced insights.
          </ThemedText>
          <ThemedText type="caption" style={{ color: AccentColors.primary }}>
            Upgrade →
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SidebarWidth,
    height: '100%',
    borderRightWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  brand: {
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.four,
  },
  wordmark: { letterSpacing: 2 },
  section: { gap: Spacing.half },
  assistantButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    marginBottom: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    letterSpacing: 0.8,
    fontSize: 11,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 34,
    paddingRight: Spacing.two,
    borderRadius: Radius.control,
  },
  activeRule: {
    width: 2,
    height: 16,
    borderRadius: 1,
    marginLeft: Spacing.two,
  },
  navLabel: { flex: 1 },
  divider: { height: 1, marginVertical: Spacing.three, marginHorizontal: Spacing.two },
  spacer: { flex: 1 },
  upgradeCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderWidth: 1,
  },
});
