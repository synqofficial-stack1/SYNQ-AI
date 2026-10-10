import { Image } from 'expo-image';
import { router, usePathname } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  ChartIcon,
  CrownIcon,
  GearIcon,
  HomeIcon,
  MegaphoneIcon,
  PlugIcon,
  PlusIcon,
} from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, SidebarWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isAdmin } from '@/lib/admin';

// Department pages (CRM, Cold Call, Follow-ups) live on their department's tab
// strip rather than here — repeating them globally would mean two places to
// keep in step. Activity is reached from the dashboard's "View all".

// The cut-out mark, not the black card: the sidebar is already a dark surface,
// so a tile inside it would read as a box within a box.
const MARK = require('../../assets/images/synq-mark.png');
const MARK_ASPECT = 312 / 448;

type NavEntry = {
  label: string;
  path: string;
  icon: (active: boolean) => ReactNode;
  /** Extra paths that should keep this item highlighted, e.g. department tabs. */
  alsoMatches?: string[];
};

const iconColor = (active: boolean, muted: string) => (active ? AccentColors.primaryLight : muted);

function NavItem({
  label,
  icon,
  active,
  onPress,
  trailing,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed, hovered }) => [
        styles.navItem,
        {
          backgroundColor: active
            ? 'rgba(232, 197, 71, 0.12)'
            : !disabled && (hovered || pressed)
              ? theme.surfaceRaised
              : 'transparent',
          borderColor: active ? 'rgba(232, 197, 71, 0.35)' : 'transparent',
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      {/* A short gold rule on the active row: enough to find at a glance, quiet
          enough to ignore while reading the rest of the list. */}
      <View
        style={[styles.activeRule, { backgroundColor: active ? AccentColors.primary : 'transparent' }]}
      />
      <View style={styles.navIcon}>{icon}</View>
      <ThemedText
        type="small"
        style={[styles.navLabel, { color: active ? theme.text : theme.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
      {trailing}
    </Pressable>
  );
}

function SoonTag() {
  const theme = useTheme();
  return (
    <View style={[styles.soon, { borderColor: theme.border }]}>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.soonText}>
        Soon
      </ThemedText>
    </View>
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
  onUpgrade,
  onOpenAssistant,
}: {
  onNavigate?: () => void;
  onUpgrade: () => void;
  onOpenAssistant: () => void;
}) {
  const theme = useTheme();
  const pathname = usePathname();

  // Whether to offer the Control Center at all. Hiding it is a courtesy, not a
  // lock: the route and its Edge Function both refuse a non-admin regardless.
  const [showControlCenter, setShowControlCenter] = useState(false);
  useEffect(() => {
    let live = true;
    isAdmin().then((allowed) => {
      if (live) setShowControlCenter(allowed);
    });
    return () => {
      live = false;
    };
  }, []);

  const go = (path: string) => {
    router.push(path as Parameters<typeof router.push>[0]);
    onNavigate?.();
  };

  const main: NavEntry[] = [
    { label: 'Dashboard', path: '/', icon: (a) => <HomeIcon size={17} color={iconColor(a, theme.textSecondary)} /> },
  ];

  const departments: NavEntry[] = [
    {
      label: 'Sales',
      path: '/sales',
      alsoMatches: ['/import-leads', '/cold-call', '/follow-ups'],
      icon: (a) => <ChartIcon size={17} color={iconColor(a, theme.textSecondary)} />,
    },
    {
      label: 'Marketing',
      path: '/marketing',
      icon: (a) => <MegaphoneIcon size={17} color={iconColor(a, theme.textSecondary)} />,
    },
  ];

  return (
    <View style={[styles.sidebar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.brand}>
        <Image source={MARK} style={styles.logo} contentFit="contain" accessibilityLabel="Synq" />
        <ThemedText type="sectionTitle" style={styles.wordmark}>
          Synq
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
              borderColor: hovered || pressed ? AccentColors.primary : 'rgba(232, 197, 71, 0.45)',
              backgroundColor: hovered || pressed ? 'rgba(232, 197, 71, 0.14)' : 'rgba(232, 197, 71, 0.07)',
            },
          ]}
        >
          <PlusIcon size={16} color={AccentColors.primaryLight} />
          <ThemedText type="small" style={styles.assistantLabel}>
            Ask Synq
          </ThemedText>
        </Pressable>

        {main.map((entry) => {
          const active = pathname === entry.path;
          return (
            <NavItem
              key={entry.path}
              label={entry.label}
              icon={entry.icon(active)}
              active={active}
              onPress={() => go(entry.path)}
            />
          );
        })}

        {showControlCenter ? (
          <NavItem
            label="Control Center"
            icon={
              <CrownIcon
                size={17}
                color={pathname === '/ceo' ? AccentColors.primaryLight : theme.textSecondary}
              />
            }
            active={pathname === '/ceo'}
            onPress={() => go('/ceo')}
          />
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionLabel>DEPARTMENTS</SectionLabel>
        {departments.map((entry) => {
          const active = pathname === entry.path || (entry.alsoMatches?.includes(pathname) ?? false);
          return (
            <NavItem
              key={entry.path}
              label={entry.label}
              icon={entry.icon(active)}
              active={active}
              onPress={() => go(entry.path)}
            />
          );
        })}
      </View>

      <View style={styles.spacer} />

      <View style={styles.section}>
        <SectionLabel>PLUGINS</SectionLabel>
        <NavItem
          label="Plugins"
          icon={<PlugIcon size={17} color={iconColor(pathname === '/plugins', theme.textSecondary)} />}
          active={pathname === '/plugins'}
          onPress={() => go('/plugins')}
        />
        <NavItem
          label="Settings"
          icon={<GearIcon size={17} color={theme.textSecondary} />}
          active={false}
          disabled
          trailing={<SoonTag />}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onUpgrade}
        style={({ hovered }) => [
          styles.upgradeCard,
          {
            borderColor: hovered ? AccentColors.primary : 'rgba(232, 197, 71, 0.3)',
            backgroundColor: hovered ? 'rgba(232, 197, 71, 0.12)' : 'rgba(232, 197, 71, 0.06)',
          },
        ]}
      >
        <View style={styles.upgradeHead}>
          <CrownIcon size={15} color={AccentColors.primaryLight} />
          <ThemedText type="smallBold" style={{ color: AccentColors.primaryLight }}>
            Synq Pro
          </ThemedText>
        </View>
        <ThemedText type="caption" themeColor="textSecondary">
          Unlock more departments and advanced insights.
        </ThemedText>
        <View style={[styles.upgradeCta, { backgroundColor: AccentColors.primaryLight }]}>
          <ThemedText type="caption" style={styles.upgradeCtaText}>
            Upgrade →
          </ThemedText>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SidebarWidth + 16,
    height: '100%',
    borderRightWidth: 1,
    paddingHorizontal: Spacing.two + 2,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.four,
  },
  logo: { height: 26, width: 26 * MARK_ASPECT },
  wordmark: { fontSize: 20, letterSpacing: 0.2 },

  section: { gap: 2 },
  assistantButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    paddingVertical: Spacing.two + 2,
    marginBottom: Spacing.three,
    borderRadius: Radius.control + 2,
    borderWidth: 1,
  },
  assistantLabel: { color: AccentColors.primaryLight, fontWeight: '600' },

  sectionLabel: {
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
    letterSpacing: 1.2,
    fontSize: 10,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 38,
    paddingRight: Spacing.two,
    borderRadius: Radius.control + 2,
    borderWidth: 1,
  },
  activeRule: { width: 2, height: 18, borderRadius: 1, marginLeft: Spacing.two - 1 },
  navIcon: { width: 20, alignItems: 'center' },
  navLabel: { flex: 1 },
  soon: {
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  soonText: { fontSize: 10 },

  spacer: { flex: 1, minHeight: Spacing.three },

  upgradeCard: {
    gap: Spacing.two,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card + 4,
    borderWidth: 1,
  },
  upgradeHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  upgradeCta: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
  },
  upgradeCtaText: { color: '#0D0D0D', fontWeight: '700' },
});
