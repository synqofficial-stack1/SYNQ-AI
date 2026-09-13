import { router, usePathname } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ChatPanel } from '@/components/chat-panel';
import { ModalSheet } from '@/components/modal-sheet';
import { PrimaryButton } from '@/components/primary-button';
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
  '/history': 'Activity',
  '/import-leads': 'Sales · CRM',
  '/sales': 'Sales',
  '/cold-call': 'Sales · Cold Call',
  '/follow-ups': 'Sales · Follow-ups',
  '/marketing': 'Marketing',
  '/upgrade': 'Plans',
};

const DESTINATIONS = [
  { label: 'Dashboard', path: '/' },
  { label: 'Activity', path: '/history' },
  { label: 'Sales', path: '/sales' },
  { label: 'CRM', path: '/import-leads' },
  { label: 'Cold Call', path: '/cold-call' },
  { label: 'Follow-ups', path: '/follow-ups' },
  { label: 'Marketing', path: '/marketing' },
  { label: 'Plans', path: '/upgrade' },
];

// The starter workspace includes Sales and Marketing, which is the whole free
// allowance — so "Add department" always lands on the limit today. Wire this to
// a real count when departments become user-creatable.
const FREE_DEPARTMENT_LIMIT = 2;
const DEPARTMENTS_IN_USE = 2;

export function AppShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { session } = useSession();

  const isWide = width >= WideBreakpoint;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
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
      onAddDepartment={() => {
        setDrawerOpen(false);
        setLimitOpen(DEPARTMENTS_IN_USE >= FREE_DEPARTMENT_LIMIT);
      }}
      onUpgrade={() => {
        setDrawerOpen(false);
        router.push('/upgrade');
      }}
      onOpenAssistant={() => {
        setDrawerOpen(false);
        setAssistantOpen(true);
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
          userLabel={session?.user?.email ?? 'Account'}
          menuOpen={userMenuOpen}
          onToggleMenu={() => setUserMenuOpen((open) => !open)}
          onSignOut={() => {
            setUserMenuOpen(false);
            supabase.auth.signOut();
          }}
        />
        <View style={styles.content}>
          {children}
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

      {/* Same `kind` as the dashboard panel, and both reopen the most recent
          thread — so this is one assistant with two doors, not two assistants. */}
      <ModalSheet
        visible={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        title="Ask Synq"
        description="Reads your real workspace. It can find businesses to call, but never places a call itself."
        align="top"
      >
        <ChatPanel
          kind="assistant"
          placeholder="Ask about your workspace, or tell it what to do…"
          emptyHint="Ask about your contacts, calls or follow-ups. It can also find local businesses to call and build the list for you to approve."
          suggestions={['What needs my attention?', 'Where should I start?']}
          height={340}
        />
      </ModalSheet>

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
                  router.push(entry.path as Parameters<typeof router.push>[0]);
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

      <ModalSheet
        visible={limitOpen}
        onClose={() => setLimitOpen(false)}
        title="You've reached your department limit"
        description={`The free workspace includes ${FREE_DEPARTMENT_LIMIT} departments. Upgrade to Synq Pro to add more.`}
      >
        <View style={styles.modalActions}>
          <PrimaryButton
            title="See plans"
            onPress={() => {
              setLimitOpen(false);
              router.push('/upgrade');
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setLimitOpen(false)}
            style={styles.tertiary}
          >
            <ThemedText type="small" themeColor="textSecondary">
              Maybe later
            </ThemedText>
          </Pressable>
        </View>
      </ModalSheet>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  content: { flex: 1 },
  drawerBackdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  drawerPanel: { height: '100%' },
  resultList: { maxHeight: 260 },
  result: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.control },
  noResults: { padding: Spacing.three },
  modalActions: { gap: Spacing.two },
  tertiary: { alignSelf: 'center', paddingVertical: Spacing.two },
});
