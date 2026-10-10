import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { BellIcon, ChevronDownIcon, MenuIcon, SearchIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TopBar({
  title,
  showMenuButton,
  onMenu,
  onOpenSearch,
  onOpenNotifications,
  userLabel,
  onSignOut,
  menuOpen,
  onToggleMenu,
}: {
  title: string;
  showMenuButton: boolean;
  onMenu: () => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  userLabel: string;
  onSignOut: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  // On a phone there is room for the menu, one search button, the bell and a
  // face — the search box and the email address both have to go.
  const compact = width < 720;

  // Cmd/Ctrl+K is a web affordance; there is no hardware keyboard to listen to
  // on a phone, so the shortcut and its hint are both web-only.
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

  return (
    <View style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {showMenuButton ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation"
          onPress={onMenu}
          style={({ hovered }) => [
            styles.iconButton,
            {
              borderColor: theme.border,
              backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
            },
          ]}
        >
          <MenuIcon size={18} color={theme.text} />
        </Pressable>
      ) : null}

      {/* On a wide screen the sidebar already says where you are, so the bar
          gives its width to the search box instead. */}
      {showMenuButton ? (
        <ThemedText type="small" style={styles.title} numberOfLines={1}>
          {title}
        </ThemedText>
      ) : null}

      {compact ? (
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search"
          onPress={onOpenSearch}
          style={({ hovered }) => [
            styles.iconButton,
            styles.compactSearch,
            {
              borderColor: theme.border,
              backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
            },
          ]}
        >
          <SearchIcon size={16} color={theme.textSecondary} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search"
          onPress={onOpenSearch}
          style={({ hovered }) => [
            styles.search,
            {
              borderColor: hovered ? 'rgba(232, 197, 71, 0.4)' : theme.border,
              backgroundColor: theme.surfaceRaised,
            },
          ]}
        >
          <SearchIcon size={15} color={theme.textSecondary} />
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            style={styles.searchText}
          >
            Search anything…
          </ThemedText>
          {Platform.OS === 'web' ? (
            <View style={[styles.kbd, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <ThemedText type="caption" themeColor="textSecondary">
                Ctrl K
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        onPress={onOpenNotifications}
        style={({ hovered }) => [
          styles.iconButton,
          {
            borderColor: theme.border,
            backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
          },
        ]}
      >
        <BellIcon size={17} color={theme.textSecondary} />
      </Pressable>

      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account menu"
          accessibilityState={{ expanded: menuOpen }}
          onPress={onToggleMenu}
          style={({ hovered }) => [
            styles.user,
            {
              borderColor: theme.border,
              backgroundColor: hovered || menuOpen ? theme.surfaceRaised : 'transparent',
            },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: AccentColors.primaryLight }]}>
            <ThemedText type="caption" style={styles.avatarText}>
              {userLabel.slice(0, 1).toUpperCase()}
            </ThemedText>
          </View>
          {compact ? null : (
            <ThemedText
              type="caption"
              themeColor="textSecondary"
              numberOfLines={1}
              style={styles.userName}
            >
              {userLabel}
            </ThemedText>
          )}
          <ChevronDownIcon size={14} color={theme.textSecondary} />
        </Pressable>

        {menuOpen ? (
          <View style={[styles.dropdown, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Pressable
              accessibilityRole="button"
              onPress={onSignOut}
              style={({ hovered }) => [
                styles.dropdownItem,
                { backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
              ]}
            >
              <ThemedText type="small">Log out</ThemedText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  title: { flexShrink: 1 },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  search: {
    flex: 1,
    maxWidth: 440,
    marginHorizontal: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  searchText: { flex: 1 },
  compactSearch: { marginLeft: 'auto' },
  kbd: {
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  user: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 40,
    paddingLeft: Spacing.one,
    paddingRight: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#0d0d0d', fontWeight: 700 },
  userName: { maxWidth: 180 },
  dropdown: {
    position: 'absolute',
    top: 46,
    right: 0,
    minWidth: 180,
    padding: Spacing.one,
    borderRadius: Radius.card,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 10,
  },
  dropdownItem: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
  },
});
