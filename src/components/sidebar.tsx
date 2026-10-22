import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useState, type ComponentType } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ArrowIcon,
  BuildingIcon,
  ChartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrownIcon,
  GearIcon,
  GridIcon,
  HomeIcon,
  MegaphoneIcon,
  SparkIcon,
  type IconProps,
} from '@/components/icons';
import { Avatar, transition } from '@/components/ui';
import { SidebarCollapsedWidth, SidebarColors, SidebarWidth } from '@/constants/theme';
import { isAdmin } from '@/lib/admin';

// The global navigation. Department pages (CRM import, meetings, email duties)
// live on their department's own tabs rather than here — repeating them would
// mean two places to keep in step. Activity is reached from the dashboard.
// Settings is not a nav item: it is the gear beside the person's name, because
// it is about them rather than a place they work in. Connecting accounts lives
// on Plugins, so there is no separate Integrations page.
//
// The sidebar is near-black in both themes: it carries the brand, and the
// yellow selection reads best against it.

// The cut-out mark, not the black card: the sidebar is already dark, so a tile
// inside it would read as a box within a box.
const MARK = require('../../assets/images/synq-mark.png');
const MARK_ASPECT = 312 / 448;

type NavEntry = {
  label: string;
  path: string;
  icon: ComponentType<IconProps>;
  /** Other routes that belong to this item, e.g. a department's sub-pages. */
  matches?: (pathname: string) => boolean;
};

const NAV: NavEntry[] = [
  { label: 'Dashboard', path: '/', icon: HomeIcon, matches: (p) => p === '/' || p.startsWith('/history') },
  { label: 'Company', path: '/company', icon: BuildingIcon },
  {
    label: 'Sales',
    path: '/sales',
    icon: ChartIcon,
    matches: (p) => ['/sales', '/import-leads', '/cold-call', '/follow-ups'].includes(p),
  },
  { label: 'Marketing', path: '/marketing', icon: MegaphoneIcon },
  { label: 'Plugins', path: '/plugins', icon: GridIcon, matches: (p) => p.startsWith('/plugins') },
];

function NavItem({
  entry,
  active,
  collapsed,
  onPress,
}: {
  entry: NavEntry;
  active: boolean;
  collapsed: boolean;
  onPress: () => void;
}) {
  const Icon = entry.icon;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={entry.label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.navItem,
        transition,
        collapsed && styles.navItemCollapsed,
        {
          backgroundColor: active
            ? SidebarColors.activeBackground
            : hovered || pressed
              ? SidebarColors.hover
              : 'transparent',
          borderColor: active ? SidebarColors.activeBorder : 'transparent',
        },
      ]}
    >
      <Icon size={19} color={active ? SidebarColors.accent : SidebarColors.textSecondary} />
      {collapsed ? null : (
        <Text
          numberOfLines={1}
          style={[styles.navLabel, { color: active ? SidebarColors.text : SidebarColors.textSecondary, fontWeight: active ? '600' : '500' }]}
        >
          {entry.label}
        </Text>
      )}
      {/* The yellow edge marks "you are here" without relying on the fill alone. */}
      {active && !collapsed ? <View style={styles.activeEdge} /> : null}
    </Pressable>
  );
}

export function Sidebar({
  onNavigate,
  onUpgrade,
  collapsed = false,
  onToggleCollapsed,
  userName,
  userRole,
}: {
  onNavigate?: () => void;
  onUpgrade: () => void;
  collapsed?: boolean;
  /** Absent in the phone drawer, which closes instead of collapsing. */
  onToggleCollapsed?: () => void;
  userName: string;
  userRole: string;
}) {
  const pathname = usePathname();
  const { department, ai } = useGlobalSearchParams<{ department?: string; ai?: string }>();

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
    const destination = (pathname === '/ai-mode' || ai === '1') && path !== '/ai-mode' ? `${path}?ai=1` : path;
    router.push(destination as Parameters<typeof router.push>[0]);
    onNavigate?.();
  };

  const isActive = (entry: NavEntry) => {
    if (pathname === '/ai-mode') {
      return entry.path === (department === 'marketing' ? '/marketing' : department === 'sales' ? '/sales' : '/');
    }
    return entry.matches ? entry.matches(pathname) : pathname === entry.path;
  };

  const nav: NavEntry[] = showControlCenter
    ? [...NAV, { label: 'Control Center', path: '/ceo', icon: CrownIcon }]
    : NAV;
  const onSettings = pathname === '/settings';

  return (
    <View
      role="navigation"
      accessibilityLabel="Main navigation"
      style={[styles.sidebar, { width: collapsed ? SidebarCollapsedWidth : SidebarWidth }]}
    >
      {/* A diagonal beam of gold light in the empty middle of the rail: the one
          decorative flourish in the app. Purely visual, so it ignores touches
          and is hidden from screen readers. */}
      {/* The rotated beam is wider than the rail. It sits in its own clipped
          layer: if it overflowed the sidebar itself, the browser would scroll
          the sidebar sideways when a button inside took focus. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.beamClip}>
        <View style={styles.beamWrap}>
          <LinearGradient
            colors={['rgba(255, 212, 90, 0)', 'rgba(255, 212, 90, 0.16)', 'rgba(255, 212, 90, 0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.beamGlow}
          />
          <LinearGradient
            colors={['rgba(255, 212, 90, 0)', 'rgba(255, 220, 120, 0.85)', 'rgba(255, 212, 90, 0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.beamLine}
          />
        </View>
      </View>

      <View style={[styles.brandRow, collapsed && styles.brandRowCollapsed]}>
        <Pressable accessibilityRole="link" accessibilityLabel="Synq dashboard" onPress={() => go('/')} style={styles.brand}>
          {collapsed ? (
            <Image source={MARK} style={styles.logo} contentFit="contain" accessibilityLabel="" />
          ) : (
            <View style={styles.wordmarkRow}>
              <Text style={styles.wordmark}>Synq</Text>
              <View style={styles.sparkle}>
                <SparkIcon size={13} color={SidebarColors.accent} strokeWidth={2.2} />
              </View>
            </View>
          )}
        </Pressable>
        {onToggleCollapsed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onPress={onToggleCollapsed}
            style={({ hovered }) => [styles.collapse, transition, hovered && { backgroundColor: SidebarColors.hover }]}
          >
            {collapsed ? (
              <ChevronRightIcon size={16} color={SidebarColors.textSecondary} />
            ) : (
              <ChevronLeftIcon size={16} color={SidebarColors.textSecondary} />
            )}
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.group}>
          {nav.map((entry) => (
            <NavItem key={entry.path} entry={entry} active={isActive(entry)} collapsed={collapsed} onPress={() => go(entry.path)} />
          ))}
        </View>
      </ScrollView>

      {collapsed ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Synq Pro: see plans"
          onPress={onUpgrade}
          style={({ hovered }) => [styles.proCollapsed, transition, hovered && { backgroundColor: SidebarColors.hover }]}
        >
          <CrownIcon size={19} color={SidebarColors.accent} />
        </Pressable>
      ) : (
        <View style={styles.pro}>
          <View style={styles.proHead}>
            <CrownIcon size={17} color={SidebarColors.accent} />
            <Text style={styles.proTitle}>Synq Pro</Text>
          </View>
          <Text style={styles.proText}>Unlock more departments and advanced features.</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Upgrade: see plans"
            onPress={onUpgrade}
            style={({ hovered, pressed }) => [styles.proButton, transition, { backgroundColor: hovered || pressed ? '#EAB938' : SidebarColors.accent }]}
          >
            <Text style={styles.proButtonText}>Upgrade</Text>
            <ArrowIcon size={15} color="#171717" />
          </Pressable>
        </View>
      )}

      <View style={[styles.profile, collapsed && styles.profileCollapsed]}>
        <Avatar name={userName} size={collapsed ? 34 : 38} />
        {collapsed ? null : (
          <View style={styles.profileText}>
            <Text numberOfLines={1} style={styles.profileName}>
              {userName}
            </Text>
            <Text numberOfLines={1} style={styles.profileRole}>
              {userRole}
            </Text>
          </View>
        )}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Settings"
          accessibilityState={{ selected: onSettings }}
          onPress={() => go('/settings')}
          style={({ hovered }) => [
            styles.profileSettings,
            transition,
            {
              backgroundColor: onSettings ? SidebarColors.activeBackground : hovered ? SidebarColors.hover : 'transparent',
              borderColor: onSettings ? SidebarColors.activeBorder : SidebarColors.border,
            },
          ]}
        >
          <GearIcon size={16} color={onSettings ? SidebarColors.accent : SidebarColors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    height: '100%',
    backgroundColor: SidebarColors.background,
    paddingHorizontal: 12,
    paddingTop: 20,
    paddingBottom: 14,
    gap: 12,
    overflow: 'hidden',
  },
  // Sits between the nav and the Pro card, angled up to the right as in the
  // brand artwork. Drawn first so every control paints over it.
  beamClip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  beamWrap: {
    position: 'absolute',
    left: -90,
    right: -90,
    bottom: 230,
    height: 220,
    transform: [{ rotate: '-38deg' }],
    justifyContent: 'center',
  },
  beamGlow: { height: 90, borderRadius: 45 },
  beamLine: { position: 'absolute', left: 40, right: 40, height: 2 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8, paddingBottom: 14 },
  brandRowCollapsed: { flexDirection: 'column', gap: 12, paddingLeft: 0 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { height: 30, width: 30 * MARK_ASPECT },
  wordmarkRow: { flexDirection: 'row', alignItems: 'flex-start' },
  wordmark: { color: SidebarColors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  sparkle: { marginLeft: 1, marginTop: -2 },
  collapse: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: SidebarColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { gap: 12 },
  group: { gap: 4 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  navItemCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  navLabel: { flex: 1, fontSize: 14.5 },
  activeEdge: {
    position: 'absolute',
    right: 0,
    top: 9,
    bottom: 9,
    width: 3,
    borderRadius: 2,
    backgroundColor: SidebarColors.accent,
  },
  pro: {
    gap: 8,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 212, 90, 0.28)',
    backgroundColor: 'rgba(255, 212, 90, 0.05)',
  },
  proHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proTitle: { color: SidebarColors.accent, fontSize: 15, fontWeight: '700' },
  proText: { color: SidebarColors.textSecondary, fontSize: 13, lineHeight: 19 },
  proButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    marginTop: 4,
    borderRadius: 10,
  },
  proButtonText: { color: '#171717', fontSize: 14, fontWeight: '700' },
  proCollapsed: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 212, 90, 0.28)',
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: SidebarColors.raised,
  },
  profileCollapsed: { flexDirection: 'column', justifyContent: 'center', padding: 8 },
  profileText: { flex: 1, minWidth: 0 },
  profileName: { color: SidebarColors.text, fontSize: 14, fontWeight: '600' },
  profileRole: { color: SidebarColors.textSecondary, fontSize: 12, marginTop: 1 },
  profileSettings: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
