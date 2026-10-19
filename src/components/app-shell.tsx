import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AIWorkspace } from '@/components/ai-workspace';
import { ModalSheet } from '@/components/modal-sheet';
import { Sidebar } from '@/components/sidebar';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Radius, Spacing, WideBreakpoint } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/ceo': 'CEO Control Center',
  '/history': 'Activity',
  '/import-leads': 'Sales · CRM',
  '/sales': 'Sales',
  '/ai-mode': 'AI Mode',
  '/cold-call': 'Sales · Cold Call',
  '/follow-ups': 'Sales · Follow-ups',
  '/marketing': 'Marketing',
  '/upgrade': 'Plans',
};

const DESTINATIONS = [
  { label: 'Dashboard', path: '/' },
  { label: 'Activity', path: '/history' },
  { label: 'Sales', path: '/sales' },
  { label: 'AI Mode', path: '/ai-mode' },
  { label: 'CRM', path: '/import-leads' },
  { label: 'Cold Call', path: '/cold-call' },
  { label: 'Follow-ups', path: '/follow-ups' },
  { label: 'Marketing', path: '/marketing' },
  { label: 'Plans', path: '/upgrade' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ ai?: string; department?: string }>();
  const aiOpen = params.ai === '1' || pathname === '/ai-mode';
  const department = ['general', 'sales', 'marketing'].includes(params.department ?? '')
    ? params.department as 'general' | 'sales' | 'marketing'
    : pathname === '/marketing' ? 'marketing'
      : ['/sales', '/import-leads', '/cold-call', '/follow-ups', '/ai-mode'].includes(pathname) ? 'sales' : 'general';
  const openAI = () => router.setParams({ ai: '1', department: 'general' });
  const closeAI = () => {
    if (pathname === '/ai-mode') router.replace(department === 'marketing' ? '/marketing' : department === 'sales' ? '/sales' : '/');
    else router.setParams({ ai: '0', department: undefined });
  };
  const changeDepartment = (value: string) => {
    const path = value === 'sales' ? '/sales' : value === 'marketing' ? '/marketing' : '/';
    if (value !== department) router.push(`${path}?ai=1` as Parameters<typeof router.push>[0]);
  };
  const { width } = useWindowDimensions();
  const { session } = useSession();

  const isWide = width >= WideBreakpoint;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const openSearch = useCallback(() => setSearchOpen(true), []);

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return DESTINATIONS;
    return DESTINATIONS.filter((entry) => entry.label.toLowerCase().includes(trimmed));
  }, [query]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  const sidebar = (
    <Sidebar
      onNavigate={() => setDrawerOpen(false)}
      onUpgrade={() => {
        setDrawerOpen(false);
        router.push('/upgrade');
      }}
      onOpenAssistant={() => {
        setDrawerOpen(false);
        openAI();
      }}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {isWide ? sidebar : null}

      <View style={styles.main}>
        <TopBar
          title={TITLES[pathname] ?? 'Synq'}
          showMenuButton={!isWide}
          onMenu={() => setDrawerOpen(true)}
          onOpenSearch={openSearch}
          onOpenNotifications={() => setNotificationsOpen(true)}
          userLabel={session?.user?.email ?? 'Account'}
          menuOpen={userMenuOpen}
          onToggleMenu={() => setUserMenuOpen((open) => !open)}
          onSignOut={() => {
            setUserMenuOpen(false);
            supabase.auth.signOut();
          }}
        />
        <View style={styles.content}>
          {aiOpen ? <AIWorkspace department={department} onClose={closeAI} onDepartment={changeDepartment} onOpenCalls={() => router.push('/sales?ai=0' as Parameters<typeof router.push>[0])} /> : null}
          <View style={{ flex: 1, minHeight: 0, display: aiOpen ? 'none' : 'flex' }}>
            <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
          </View>
          {/* Only mounted while the menu is open. Wrapping the page itself in a
              Pressable put every button on the page inside a <button>, which is
              invalid HTML and confuses screen readers. */}
          {userMenuOpen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close account menu"
              style={StyleSheet.absoluteFill}
              onPress={() => setUserMenuOpen(false)}
            />
          ) : null}
        </View>
      </View>

      <Modal visible={drawerOpen && !isWide} transparent animationType="fade">
        <View style={styles.drawerBackdrop}>
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
          <View style={styles.drawerPanel}>{sidebar}</View>
        </View>
      </Modal>

      <ModalSheet
        visible={searchOpen}
        onClose={closeSearch}
        title="Search"
        description="Jump to any part of the workspace."
        align="top"
      >
        <TextField
          placeholder="Search anything…"
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
        <ScrollView style={styles.resultList}>
          {results.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.noResults}>
              No matches for “{query.trim()}”.
            </ThemedText>
          ) : (
            results.map((entry) => (
              <Pressable
                key={entry.path}
                accessibilityRole="button"
                onPress={() => {
                  closeSearch();
                  router.push(`${entry.path}${aiOpen && entry.path !== '/ai-mode' ? '?ai=1' : ''}` as Parameters<typeof router.push>[0]);
                }}
                style={({ hovered }) => [
                  styles.result,
                  { backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
                ]}
              >
                <ThemedText type="small">{entry.label}</ThemedText>
              </Pressable>
            ))
          )}
        </ScrollView>
      </ModalSheet>

      {/* Synq sends nothing today: no scheduler, no background jobs, no push.
          The bell says that rather than showing an invented inbox. */}
      <ModalSheet
        visible={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        title="Notifications"
        description="Nothing to show. Synq doesn't send notifications yet — results appear on the page that asked for them."
        align="top"
      >
        <View />
      </ModalSheet>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  content: { flex: 1, minHeight: 0 },
  drawerBackdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  drawerPanel: { height: '100%' },
  resultList: { maxHeight: 260 },
  result: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.control },
  noResults: { padding: Spacing.three },
});
