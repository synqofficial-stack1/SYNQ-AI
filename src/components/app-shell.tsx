import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { type ComponentType, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AIWorkspace } from '@/components/ai-workspace';
import {
  BellIcon,
  BuildingIcon,
  CalendarIcon,
  ChartIcon,
  ClockIcon,
  CrownIcon,
  GearIcon,
  GridIcon,
  HomeIcon,
  LogOutIcon,
  MailIcon,
  MegaphoneIcon,
  SparkIcon,
  TargetIcon,
  UploadIcon,
  UserPlusIcon,
  VideoIcon,
  type IconProps,
} from '@/components/icons';
import { ModalSheet } from '@/components/modal-sheet';
import { Sidebar } from '@/components/sidebar';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Button, EmptyState, IconTile, Popover, SearchInput, ToastHost, transition, useBreakpoint } from '@/components/ui';
import { DataColors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { supabase } from '@/lib/supabase';

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/ceo': 'Control Center',
  '/history': 'Activity',
  '/import-leads': 'Sales · Leads',
  '/sales': 'Sales',
  '/company': 'Company',
  '/ai-mode': 'Ask Synq',
  '/marketing': 'Marketing',
  '/plugins': 'Plugins',
  '/upgrade': 'Plans',
  '/settings': 'Settings',
};

const HINTS: Record<string, string> = {
  '/': '(find leads, create reel, write email, etc.)',
  '/company': '(e.g. team, tasks, join requests)',
  '/sales': '(e.g. leads, meetings, email duties)',
  '/import-leads': '(e.g. leads, meetings, email duties)',
  '/marketing': '(e.g. create reel, drafts, publishing)',
  '/plugins': '(e.g. connect YouTube, Gmail)',
  '/settings': '(e.g. appearance, password, delete account)',
};

type Destination = {
  label: string;
  hint: string;
  path?: string;
  action?: 'assistant';
  keywords: string;
  icon: ComponentType<IconProps>;
};

// Only places and actions that exist. Each entry opens a real route.
const DESTINATIONS: Destination[] = [
  { label: 'Dashboard', hint: 'Overview of your workspace', path: '/', keywords: 'home overview', icon: HomeIcon },
  { label: 'Ask Synq', hint: 'Chat with your AI assistant', action: 'assistant', keywords: 'ai assistant chat help', icon: SparkIcon },
  { label: 'Company', hint: 'Team, chat, tasks and join requests', path: '/company', keywords: 'team members chat tasks assign join requests workspace', icon: BuildingIcon },
  { label: 'Sales', hint: 'Sales overview', path: '/sales', keywords: 'sales overview pipeline', icon: ChartIcon },
  { label: 'Import leads', hint: 'Bring contacts in from a spreadsheet', path: '/import-leads', keywords: 'leads crm import csv contacts find', icon: UploadIcon },
  { label: 'Meetings', hint: 'Plan and review sales meetings', path: '/sales?view=meetings', keywords: 'meetings schedule book', icon: CalendarIcon },
  { label: 'Targets', hint: 'Monthly revenue and deal targets', path: '/sales?view=targets', keywords: 'targets goals revenue', icon: TargetIcon },
  { label: 'Email duties', hint: 'Gmail outreach and replies', path: '/sales?view=email', keywords: 'email outreach gmail cold emails replies', icon: MailIcon },
  { label: 'Write emails', hint: 'Start a new email duty', path: '/sales?compose=1', keywords: 'write email compose new duty', icon: MailIcon },
  { label: 'Marketing', hint: 'Content and publishing', path: '/marketing', keywords: 'marketing content', icon: MegaphoneIcon },
  { label: 'Create reel', hint: 'Upload a video and publish it', path: '/marketing?view=create', keywords: 'reel video upload publish post youtube instagram', icon: VideoIcon },
  { label: 'Plugins', hint: 'Connect YouTube, Instagram, X and Gmail', path: '/plugins', keywords: 'plugins tools marketplace integrations connect accounts youtube instagram x twitter gmail', icon: GridIcon },
  { label: 'Activity', hint: 'Everything your AI team has done', path: '/history', keywords: 'history activity runs', icon: ClockIcon },
  { label: 'Settings', hint: 'Profile, appearance, privacy', path: '/settings', keywords: 'settings profile appearance theme dark light password delete account', icon: GearIcon },
  { label: 'Plans', hint: 'Synq Pro and credits', path: '/upgrade', keywords: 'plans upgrade pro pricing credits billing', icon: CrownIcon },
];

const COLLAPSE_KEY = 'synq-sidebar-collapsed';

export function AppShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ ai?: string; department?: string; prompt?: string }>();
  const aiOpen = params.ai === '1' || pathname === '/ai-mode';
  const department = ['general', 'sales', 'marketing'].includes(params.department ?? '')
    ? (params.department as 'general' | 'sales' | 'marketing')
    : pathname === '/marketing'
      ? 'marketing'
      : ['/sales', '/import-leads', '/cold-call', '/follow-ups', '/ai-mode'].includes(pathname)
        ? 'sales'
        : 'general';
  const openAI = useCallback(() => router.setParams({ ai: '1', department: 'general' }), []);
  // A prompt from the dashboard's Ask Synq box rides in the URL until the
  // assistant has sent it, then leaves so a refresh does not send it twice.
  const clearPrompt = useCallback(() => router.setParams({ prompt: undefined }), []);
  const closeAI = () => {
    if (pathname === '/ai-mode') router.replace(department === 'marketing' ? '/marketing' : department === 'sales' ? '/sales' : '/');
    else router.setParams({ ai: '0', department: undefined });
  };
  const changeDepartment = (value: string) => {
    const path = value === 'sales' ? '/sales' : value === 'marketing' ? '/marketing' : '/';
    if (value !== department) router.push(`${path}?ai=1` as Parameters<typeof router.push>[0]);
  };
  const { isWide } = useBreakpoint();
  const { session } = useSession();
  const { identity } = useWorkspace();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const menuAnchor = useRef<View>(null);
  const notificationsAnchor = useRef<View>(null);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(COLLAPSE_KEY)
      .then((saved) => {
        if (live && saved === '1') setCollapsed(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      AsyncStorage.setItem(COLLAPSE_KEY, value ? '0' : '1').catch(() => {});
      return !value;
    });
  };

  const openSearch = useCallback(() => setSearchOpen(true), []);

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return DESTINATIONS;
    return DESTINATIONS.filter((entry) => `${entry.label} ${entry.hint} ${entry.keywords}`.toLowerCase().includes(trimmed));
  }, [query]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  const choose = (entry: Destination) => {
    closeSearch();
    if (entry.action === 'assistant') {
      openAI();
      return;
    }
    if (!entry.path) return;
    // Assistant mode follows the person around, as it does from the sidebar.
    router.push(`${entry.path}${aiOpen ? `${entry.path.includes('?') ? '&' : '?'}ai=1` : ''}` as Parameters<typeof router.push>[0]);
  };

  const userName = identity?.full_name || session?.user?.email || 'Account';
  const userRole = identity?.membership?.role === 'owner' ? 'Owner' : identity?.membership ? 'Member' : 'Personal workspace';
  const pending = identity?.membership?.role === 'owner' ? identity.membership.pending_count ?? 0 : 0;

  const sidebar = (inDrawer: boolean) => (
    <Sidebar
      collapsed={inDrawer ? false : collapsed}
      onToggleCollapsed={inDrawer ? undefined : toggleCollapsed}
      onNavigate={() => setDrawerOpen(false)}
      onUpgrade={() => {
        setDrawerOpen(false);
        router.push('/upgrade');
      }}
      userName={userName}
      userRole={userRole}
    />
  );

  const goFromMenu = (path: string) => {
    setUserMenuOpen(false);
    router.push(path as Parameters<typeof router.push>[0]);
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {isWide ? sidebar(false) : null}

      <View style={styles.main}>
        <TopBar
          title={TITLES[pathname] ?? (pathname.startsWith('/plugins') ? 'Plugins' : pathname.startsWith('/history') ? 'Activity' : 'Synq')}
          searchHint={HINTS[pathname] ?? HINTS['/']}
          showMenuButton={!isWide}
          onMenu={() => setDrawerOpen(true)}
          onOpenSearch={openSearch}
          onOpenAssistant={openAI}
          onOpenNotifications={() => setNotificationsOpen(true)}
          hasNotifications={pending > 0}
          notificationsAnchor={notificationsAnchor}
          userLabel={userName}
          menuOpen={userMenuOpen}
          onToggleMenu={() => setUserMenuOpen((open) => !open)}
          menuAnchor={menuAnchor}
        />
        <View style={styles.content}>
          {aiOpen ? (
            <AIWorkspace
              department={department}
              onClose={closeAI}
              onDepartment={changeDepartment}
              onOpenCalls={() => router.push('/sales?view=email&ai=0' as Parameters<typeof router.push>[0])}
              initialPrompt={typeof params.prompt === 'string' ? params.prompt : undefined}
              onPromptSent={clearPrompt}
            />
          ) : null}
          <View style={{ flex: 1, minHeight: 0, display: aiOpen ? 'none' : 'flex' }}>
            {pending > 0 && pathname !== '/company' ? (
              <View style={[styles.banner, { backgroundColor: theme.accentSoft, borderColor: theme.accentBorder }]}>
                <UserPlusIcon size={17} color={theme.accentText} />
                <ThemedText type="small" style={styles.bannerText}>
                  {pending === 1 ? '1 person is' : `${pending} people are`} waiting to join your company.
                </ThemedText>
                <Button label="Review" size="sm" onPress={() => router.push('/company?tab=team' as Parameters<typeof router.push>[0])} />
              </View>
            ) : null}
            <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
          </View>
        </View>
      </View>

      <Modal visible={drawerOpen && !isWide} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
        <View style={[styles.drawerBackdrop, { backgroundColor: theme.overlay }]}>
          {/* The dismiss target sits behind the drawer as a sibling. Wrapping
              the drawer in a Pressable would put every link in the sidebar
              inside a <button> on web, which is invalid and swallows the taps
              it was meant to pass through. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            onPress={() => setDrawerOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.drawerPanel}>{sidebar(true)}</View>
        </View>
      </Modal>

      <ModalSheet
        visible={searchOpen}
        onClose={closeSearch}
        title="Search Synq"
        description="Jump to a page or start something."
        align="top"
        width={560}
      >
        <SearchInput
          placeholder="Search pages and actions…"
          value={query}
          onChangeText={setQuery}
          autoFocus
          onSubmitEditing={() => results[0] && choose(results[0])}
        />
        <ScrollView style={styles.resultList}>
          {results.length === 0 ? (
            <EmptyState title={`No matches for “${query.trim()}”`} description="Try a page name such as Sales, Integrations or Settings." compact />
          ) : (
            results.map((entry) => (
              <Pressable
                key={entry.label}
                accessibilityRole="button"
                accessibilityLabel={`${entry.label}: ${entry.hint}`}
                onPress={() => choose(entry)}
                style={({ hovered }) => [styles.result, transition, { backgroundColor: hovered ? theme.surfaceRaised : 'transparent' }]}
              >
                <IconTile icon={entry.icon} color={entry.action ? DataColors.sales : theme.textSecondary} size={34} />
                <View style={styles.resultText}>
                  <ThemedText type="smallBold">{entry.label}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {entry.hint}
                  </ThemedText>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </ModalSheet>

      <Popover
        anchorRef={notificationsAnchor}
        visible={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        align="right"
        width={340}
        label="Notifications"
      >
        <View style={styles.menuHead}>
          <ThemedText type="cardTitle">Notifications</ThemedText>
        </View>
        {pending > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setNotificationsOpen(false);
              router.push('/company?tab=team' as Parameters<typeof router.push>[0]);
            }}
            style={({ hovered }) => [styles.menuItem, hovered && { backgroundColor: theme.surfaceRaised }]}
          >
            <IconTile icon={UserPlusIcon} color={DataColors.company} size={34} />
            <View style={styles.resultText}>
              <ThemedText type="smallBold">
                {pending === 1 ? '1 join request' : `${pending} join requests`}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                Approve or decline in Company → Team.
              </ThemedText>
            </View>
          </Pressable>
        ) : (
          <View style={styles.menuEmpty}>
            <EmptyState icon={BellIcon} title="You're all caught up" description="Join requests for your company show up here." compact />
          </View>
        )}
      </Popover>

      <Popover
        anchorRef={menuAnchor}
        visible={userMenuOpen}
        onClose={() => setUserMenuOpen(false)}
        align="right"
        width={260}
        label="Account menu"
      >
        <View style={[styles.menuHead, { borderBottomColor: theme.border, borderBottomWidth: 1 }]}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {userName}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
            {session?.user?.email ?? ''}
          </ThemedText>
        </View>
        {[
          { label: 'Profile & settings', path: '/settings', icon: GearIcon },
          { label: 'Company workspace', path: '/company', icon: BuildingIcon },
          { label: 'Plans & credits', path: '/upgrade', icon: CrownIcon },
        ].map((item) => (
          <Pressable
            key={item.path}
            accessibilityRole="menuitem"
            onPress={() => goFromMenu(item.path)}
            style={({ hovered }) => [styles.menuItem, hovered && { backgroundColor: theme.surfaceRaised }]}
          >
            <item.icon size={17} color={theme.textSecondary} />
            <Text style={[styles.menuText, { color: theme.text }]}>{item.label}</Text>
          </Pressable>
        ))}
        <View style={[styles.menuDivider, { backgroundColor: theme.border }]} />
        <Pressable
          accessibilityRole="menuitem"
          onPress={() => {
            setUserMenuOpen(false);
            supabase.auth.signOut();
          }}
          style={({ hovered }) => [styles.menuItem, hovered && { backgroundColor: theme.dangerSoft }]}
        >
          <LogOutIcon size={17} color={theme.danger} />
          <Text style={[styles.menuText, { color: theme.danger }]}>Log out</Text>
        </Pressable>
      </Popover>

      <ToastHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },
  content: { flex: 1, minHeight: 0 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.control + 2,
    borderWidth: 1,
  },
  bannerText: { flex: 1 },
  drawerBackdrop: { flex: 1, flexDirection: 'row' },
  drawerPanel: { height: '100%' },
  resultList: { maxHeight: 380 },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.control,
  },
  resultText: { flex: 1, minWidth: 0, gap: 1 },
  menuHead: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 2 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
  },
  menuText: { fontSize: 14, fontWeight: '500' },
  menuDivider: { height: 1, marginVertical: 4 },
  menuEmpty: { padding: 6 },
});
