import { useEffect, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { BellIcon, ChevronDownIcon, MenuIcon, SearchIcon, SparkIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Avatar, IconButton, transition, useBreakpoint } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The bar above every page: search, the assistant, notifications and the
 * account menu. It sits on the page colour with no border so it stays quiet;
 * the page title lives in each page's own header.
 */
export function TopBar({
  title,
  searchHint,
  showMenuButton,
  onMenu,
  onOpenSearch,
  onOpenAssistant,
  onOpenNotifications,
  hasNotifications,
  notificationsAnchor,
  userLabel,
  menuOpen,
  onToggleMenu,
  menuAnchor,
}: {
  title: string;
  searchHint: string;
  showMenuButton: boolean;
  onMenu: () => void;
  onOpenSearch: () => void;
  onOpenAssistant: () => void;
  onOpenNotifications: () => void;
  hasNotifications: boolean;
  notificationsAnchor: RefObject<View | null>;
  userLabel: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  menuAnchor: RefObject<View | null>;
}) {
  const theme = useTheme();
  const { width } = useBreakpoint();
  // On a phone there is room for the menu, one search button, the bell and a
  // face — the search box and the name both have to go.
  const compact = width < 720;

  // Ctrl/Cmd+K is a web affordance; a phone has no hardware keyboard to listen
  // to, so the shortcut and its hint are both web-only.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenSearch]);

  const isMac = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  return (
    <View role="banner" style={[styles.bar, compact && styles.barCompact, { backgroundColor: theme.background }]}>
      {showMenuButton ? <IconButton icon={MenuIcon} label="Open navigation" onPress={onMenu} variant="outline" /> : null}

      {showMenuButton ? (
        <ThemedText type="cardTitle" style={styles.title} numberOfLines={1}>
          {title}
        </ThemedText>
      ) : null}

      {compact ? (
        <View style={styles.compactActions}>
          <IconButton icon={SearchIcon} label="Search" onPress={onOpenSearch} variant="outline" />
        </View>
      ) : (
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search Synq"
          accessibilityHint="Opens search"
          onPress={onOpenSearch}
          style={({ hovered }) => [
            styles.search,
            transition,
            { backgroundColor: theme.surface, borderColor: hovered ? theme.borderStrong : theme.border },
          ]}
        >
          <SearchIcon size={17} color={theme.textSecondary} />
          <Text numberOfLines={1} style={[styles.searchText, { color: theme.textSecondary }]}>
            <Text style={{ color: theme.text, fontWeight: '500' }}>Search anything…</Text>
            {width >= 1100 ? <Text style={{ color: theme.textTertiary }}>{`  ${searchHint}`}</Text> : null}
          </Text>
          {Platform.OS === 'web' ? (
            <View style={[styles.kbd, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
              <Text style={[styles.kbdText, { color: theme.textSecondary }]}>{isMac ? '⌘ K' : 'Ctrl K'}</Text>
            </View>
          ) : null}
        </Pressable>
      )}

      <View style={styles.right}>
        {compact ? (
          <IconButton icon={SparkIcon} label="Ask Synq" onPress={onOpenAssistant} variant="outline" color={theme.accentText} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask Synq, your AI assistant"
            onPress={onOpenAssistant}
            style={({ hovered }) => [
              styles.assistant,
              transition,
              { borderColor: theme.accentBorder, backgroundColor: hovered ? theme.accentSoft : theme.surface },
            ]}
          >
            <SparkIcon size={16} color={theme.accentText} />
            <Text style={[styles.assistantText, { color: theme.text }]}>Ask Synq</Text>
          </Pressable>
        )}

        <View ref={notificationsAnchor} collapsable={false}>
          <IconButton
            icon={BellIcon}
            label={hasNotifications ? 'Notifications, new items' : 'Notifications'}
            onPress={onOpenNotifications}
            badge={hasNotifications}
          />
        </View>

        <View ref={menuAnchor} collapsable={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Account menu for ${userLabel}`}
            accessibilityState={{ expanded: menuOpen }}
            onPress={onToggleMenu}
            style={({ hovered }) => [
              styles.user,
              transition,
              { backgroundColor: hovered || menuOpen ? theme.surfaceRaised : 'transparent' },
            ]}
          >
            <Avatar name={userLabel} size={34} />
            {compact ? null : (
              <Text numberOfLines={1} style={[styles.userName, { color: theme.text }]}>
                {userLabel}
              </Text>
            )}
            <ChevronDownIcon size={16} color={theme.textSecondary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 28,
    zIndex: 10,
  },
  barCompact: { height: 64, paddingHorizontal: 16, gap: 8 },
  title: { flex: 1, minWidth: 0 },
  compactActions: { marginLeft: 'auto' },
  search: {
    flex: 1,
    maxWidth: 780,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  searchText: { flex: 1, fontSize: 14 },
  kbd: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  kbdText: { fontSize: 11.5, fontWeight: '500' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  assistant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  assistantText: { fontSize: 14, fontWeight: '600' },
  user: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingLeft: 5,
    paddingRight: 10,
    borderRadius: Radius.pill,
  },
  userName: { maxWidth: 170, fontSize: 14.5, fontWeight: '600' },
});
