import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useState, type ComponentType } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AlertIcon,
  ArrowIcon,
  BookIcon,
  BuildingIcon,
  ChartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrownIcon,
  FileTextIcon,
  GearIcon,
  HelpIcon,
  HomeIcon,
  MegaphoneIcon,
  MessageIcon,
  PuzzleIcon,
  SparkIcon,
  UsersIcon,
  type IconProps,
} from '@/components/icons';
import { ModalSheet } from '@/components/modal-sheet';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, showToast, transition } from '@/components/ui';
import { SidebarCollapsedWidth, SidebarColors, SidebarWidth } from '@/constants/theme';
import { isAdmin } from '@/lib/admin';
import { supabase } from '@/lib/supabase';

// The global navigation, in three groups: the departments, quick access to
// the places people reach for most, and help. Every entry opens a real page;
// nothing here is a placeholder.
//
// The counts beside Sales and Marketing are live: new leads nobody has
// contacted yet, and marketing drafts not yet published. A count of zero is
// not shown, so a badge always means "something is waiting for you".
//
// The sidebar is near-black in both themes: it carries the brand, and the
// yellow selection reads best against it.

// The cut-out mark, not the black card: the sidebar is already dark, so a tile
// inside it would read as a box within a box.
const MARK = require('../../assets/images/synq-mark.png');
const MARK_ASPECT = 312 / 448;

const SUPPORT_PHONE = '6300840955';
const VIOLET = '#A78BFA';

type Badge = 'sales' | 'marketing';

type NavEntry = {
  label: string;
  path: string;
  icon: ComponentType<IconProps>;
  /** Other routes that belong to this item, e.g. a department's sub-pages. */
  matches?: (pathname: string) => boolean;
  /** A short label shown on the item while it is the current page. */
  tag?: string;
  badge?: Badge;
  iconColor?: string;
};

const DEPARTMENTS: NavEntry[] = [
  { label: 'Dashboard', path: '/', icon: HomeIcon, tag: 'Home', matches: (p) => p === '/' },
  { label: 'Company', path: '/company', icon: BuildingIcon },
  {
    label: 'Sales',
    path: '/sales',
    icon: ChartIcon,
    badge: 'sales',
    matches: (p) => ['/sales', '/import-leads', '/cold-call', '/follow-ups'].includes(p),
  },
  { label: 'Marketing', path: '/marketing', icon: MegaphoneIcon, badge: 'marketing' },
  { label: 'Plugins', path: '/plugins', icon: PuzzleIcon, matches: (p) => p.startsWith('/plugins') },
];

const QUICK_ACCESS: NavEntry[] = [
  { label: 'Team', path: '/company?tab=team', icon: UsersIcon, matches: () => false },
  { label: 'Reports', path: '/history', icon: FileTextIcon, matches: (p) => p.startsWith('/history') },
  { label: 'Settings', path: '/settings', icon: GearIcon },
];

const BADGE_LABEL: Record<Badge, (count: number) => string> = {
  sales: (count) => `${count} new ${count === 1 ? 'lead' : 'leads'} to contact`,
  marketing: (count) => `${count} unpublished ${count === 1 ? 'draft' : 'drafts'}`,
};

/** Counts for the badges. A failed count hides its badge rather than showing a wrong number. */
async function loadBadgeCounts(): Promise<Record<Badge, number>> {
  const [leads, drafts] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabase.from('marketing_post_drafts').select('id', { count: 'exact', head: true }),
  ]);
  return {
    sales: leads.error ? 0 : leads.count ?? 0,
    marketing: drafts.error ? 0 : drafts.count ?? 0,
  };
}

function NavItem({
  entry,
  active,
  collapsed,
  count,
  onPress,
  role = 'link',
}: {
  entry: NavEntry;
  active: boolean;
  collapsed: boolean;
  count: number;
  onPress: () => void;
  /** `button` for items that open a dialog rather than a page. */
  role?: 'link' | 'button';
}) {
  const Icon = entry.icon;
  const badgeText = entry.badge && count > 0 ? (count > 99 ? '99+' : String(count)) : null;
  const label = entry.badge && count > 0 ? `${entry.label}, ${BADGE_LABEL[entry.badge](count)}` : entry.label;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.navItem,
        transition,
        collapsed && styles.navItemCollapsed,
        {
          backgroundColor: active ? 'transparent' : hovered || pressed ? SidebarColors.hover : 'transparent',
          borderColor: active ? 'rgba(255, 212, 90, 0.45)' : 'transparent',
        },
        active && styles.navItemActive,
      ]}
    >
      {active ? (
        <LinearGradient
          colors={['rgba(255, 212, 90, 0.22)', 'rgba(255, 212, 90, 0.06)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.activeFill}
          pointerEvents="none"
        />
      ) : null}
      {/* The yellow edge marks "you are here" without relying on the fill alone. */}
      {active ? <View style={styles.activeEdge} /> : null}
      <Icon size={20} color={active ? SidebarColors.accent : entry.iconColor ?? SidebarColors.textSecondary} />
      {collapsed ? null : (
        <>
          <Text numberOfLines={1} style={[styles.navLabel, { color: active ? SidebarColors.text : '#D6D3CC', fontWeight: active ? '700' : '500' }]}>
            {entry.label}
          </Text>
          {active && entry.tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{entry.tag}</Text>
            </View>
          ) : null}
          {badgeText ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badgeText}</Text>
            </View>
          ) : null}
          {active ? null : <ChevronRightIcon size={16} color="#77736B" />}
        </>
      )}
      {collapsed && badgeText ? <View style={styles.badgeDot} /> : null}
    </Pressable>
  );
}

function SectionLabel({ title, collapsed }: { title: string; collapsed: boolean }) {
  return (
    <View style={styles.section}>
      <View style={styles.separator} />
      {collapsed ? null : (
        <Text accessibilityRole="header" style={styles.sectionLabel}>
          {title}
        </Text>
      )}
    </View>
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

  // Refreshed on every page change, which is when a lead or draft is most
  // likely to have just been added or handled.
  const [counts, setCounts] = useState<Record<Badge, number>>({ sales: 0, marketing: 0 });
  useEffect(() => {
    let live = true;
    loadBadgeCounts()
      .then((next) => {
        if (live) setCounts(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  const go = (path: string) => {
    const withAi = (pathname === '/ai-mode' || ai === '1') && path !== '/ai-mode';
    const destination = withAi ? `${path}${path.includes('?') ? '&' : '?'}ai=1` : path;
    router.push(destination as Parameters<typeof router.push>[0]);
    onNavigate?.();
  };

  const isActive = (entry: NavEntry) => {
    if (pathname === '/ai-mode') {
      return entry.path === (department === 'marketing' ? '/marketing' : department === 'sales' ? '/sales' : '/');
    }
    return entry.matches ? entry.matches(pathname) : pathname === entry.path;
  };

  const departments: NavEntry[] = showControlCenter
    ? [...DEPARTMENTS, { label: 'Control Center', path: '/ceo', icon: CrownIcon, iconColor: VIOLET }]
    : DEPARTMENTS;

  const item = (entry: NavEntry) => (
    <NavItem
      key={entry.label}
      entry={entry}
      active={isActive(entry)}
      collapsed={collapsed}
      count={entry.badge ? counts[entry.badge] : 0}
      onPress={() => go(entry.path)}
    />
  );

  async function sendFeedback() {
    setFeedbackBusy(true);
    const { error } = await supabase.functions.invoke('request-ceo-alert', { body: {} });
    setFeedbackBusy(false);
    setFeedbackOpen(false);
    showToast(error ? 'Could not send your report. Please try again later.' : 'Thanks — the Synq team has been alerted.', error ? 'danger' : 'success');
  }

  const onSettings = pathname === '/settings';

  return (
    <View
      role="navigation"
      accessibilityLabel="Main navigation"
      style={[styles.sidebar, { width: collapsed ? SidebarCollapsedWidth : SidebarWidth }]}
    >
      <View style={[styles.brandRow, collapsed && styles.brandRowCollapsed]}>
        <Pressable accessibilityRole="link" accessibilityLabel="Synq dashboard" onPress={() => go('/')} style={styles.brand}>
          {/* The building mark is cut out onto transparency, so its windows show
              the sidebar through them and it sits on the dark rail with no box. */}
          <Image source={MARK} style={collapsed ? styles.logo : styles.logoBeside} contentFit="contain" accessibilityLabel="" />
          {collapsed ? null : (
            <View style={styles.wordmarkRow}>
              <Text style={styles.wordmark}>Synq</Text>
              <View style={styles.sparkle}>
                <SparkIcon size={14} color={SidebarColors.accent} strokeWidth={2.2} />
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
        <View style={styles.group}>{departments.map(item)}</View>

        <SectionLabel title="Quick access" collapsed={collapsed} />
        <View style={styles.group}>{QUICK_ACCESS.map(item)}</View>

        <SectionLabel title="Resources" collapsed={collapsed} />
        <View style={styles.group}>
          {item({ label: 'Help & Support', path: '/settings?section=help', icon: BookIcon, matches: () => false })}
          <NavItem
            entry={{ label: 'Feedback', path: '', icon: MessageIcon }}
            active={false}
            collapsed={collapsed}
            count={0}
            role="button"
            onPress={() => setFeedbackOpen(true)}
          />
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
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Synq Pro: unlock more departments and advanced features. See plans"
          onPress={onUpgrade}
          style={({ hovered }) => [styles.pro, transition, hovered && styles.proHover]}
        >
          <LinearGradient
            colors={['rgba(255, 212, 90, 0.16)', 'rgba(255, 212, 90, 0.04)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.proFill}
            pointerEvents="none"
          />
          {/* The gold sweep in the corner, clipped to the card. */}
          <View style={styles.proSweepClip} pointerEvents="none">
            <LinearGradient
              colors={['rgba(255, 212, 90, 0)', 'rgba(255, 212, 90, 0.55)', 'rgba(255, 212, 90, 0)']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.proSweep}
            />
          </View>
          <CrownIcon size={20} color={SidebarColors.accent} />
          <View style={styles.proText}>
            <Text style={styles.proTitle}>Synq Pro</Text>
            <Text style={styles.proBody}>Unlock more departments and advanced features.</Text>
          </View>
          <View style={styles.proArrow}>
            <ArrowIcon size={15} color="#171717" />
          </View>
        </Pressable>
      )}

      <View style={[styles.profile, collapsed && styles.profileCollapsed]}>
        <View>
          <Avatar name={userName} size={collapsed ? 34 : 40} />
          {/* Signed in: the dot is the session, not a presence system. */}
          <View style={[styles.online, collapsed && styles.onlineSmall]} accessibilityLabel="Signed in" />
        </View>
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

      <ModalSheet
        visible={feedbackOpen}
        onClose={() => (feedbackBusy ? undefined : setFeedbackOpen(false))}
        title="Feedback"
        description="Something not working, or an idea for Synq? Tell the team."
      >
        <ThemedText type="small" themeColor="textSecondary">
          Report a problem and the Synq team is alerted with your account, so they can look into it. To talk it through, call support.
        </ThemedText>
        <View style={styles.feedbackActions}>
          <Button label="Call support" icon={HelpIcon} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`).catch(() => {})} />
          <Button label="Report a problem" variant="primary" icon={AlertIcon} loading={feedbackBusy} onPress={() => void sendFeedback()} />
        </View>
      </ModalSheet>
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
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8, paddingBottom: 6 },
  brandRowCollapsed: { flexDirection: 'column', gap: 12, paddingLeft: 0 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { height: 30, width: 30 * MARK_ASPECT },
  // Sized to the wordmark's cap height plus its descender, so the two read as one lockup.
  logoBeside: { height: 34, width: 34 * MARK_ASPECT },
  wordmarkRow: { flexDirection: 'row', alignItems: 'flex-start' },
  wordmark: { color: SidebarColors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  sparkle: { marginLeft: 1, marginTop: -4 },
  collapse: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: SidebarColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { gap: 6, paddingBottom: 4 },
  group: { gap: 3 },
  section: { gap: 10, paddingTop: 8, paddingBottom: 2 },
  separator: { height: 1, backgroundColor: SidebarColors.border, marginHorizontal: 6 },
  sectionLabel: { color: '#8A8578', fontSize: 11, fontWeight: '600', letterSpacing: 2.2, textTransform: 'uppercase', paddingLeft: 12 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 44,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 11,
    borderWidth: 1,
    overflow: 'hidden',
  },
  navItemActive: {
    shadowColor: '#FFD45A',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  navItemCollapsed: { justifyContent: 'center', paddingLeft: 0, paddingRight: 0 },
  activeFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  activeEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: SidebarColors.accent,
  },
  navLabel: { flex: 1, fontSize: 14.5 },
  tag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255, 212, 90, 0.18)' },
  tagText: { color: SidebarColors.accent, fontSize: 12, fontWeight: '700' },
  badge: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  badgeText: { color: SidebarColors.text, fontSize: 12, fontWeight: '700' },
  badgeDot: { position: 'absolute', top: 9, right: 12, width: 7, height: 7, borderRadius: 4, backgroundColor: SidebarColors.accent },
  pro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 212, 90, 0.4)',
    overflow: 'hidden',
  },
  proHover: { borderColor: 'rgba(255, 212, 90, 0.7)' },
  proFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  proSweepClip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  proSweep: { position: 'absolute', right: -40, bottom: 14, width: 170, height: 2, transform: [{ rotate: '-24deg' }] },
  proText: { flex: 1, gap: 3 },
  proTitle: { color: SidebarColors.accent, fontSize: 16, fontWeight: '700' },
  proBody: { color: SidebarColors.textSecondary, fontSize: 12.5, lineHeight: 17 },
  proArrow: { width: 28, height: 28, borderRadius: 14, backgroundColor: SidebarColors.accent, alignItems: 'center', justifyContent: 'center' },
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
    gap: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: SidebarColors.raised,
  },
  profileCollapsed: { flexDirection: 'column', justifyContent: 'center', padding: 8, gap: 8 },
  online: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: SidebarColors.raised,
  },
  onlineSmall: { width: 10, height: 10, borderRadius: 5 },
  profileText: { flex: 1, minWidth: 0 },
  profileName: { color: SidebarColors.text, fontSize: 14.5, fontWeight: '700' },
  profileRole: { color: SidebarColors.textSecondary, fontSize: 12.5, marginTop: 1 },
  profileSettings: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  feedbackActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 },
});
