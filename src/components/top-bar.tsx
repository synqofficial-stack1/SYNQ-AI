import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TopBar({
  title,
  showMenuButton,
  onMenu,
  onOpenSearch,
  userLabel,
  onSignOut,
  menuOpen,
  onToggleMenu,
}: {
  title: string;
  showMenuButton: boolean;
  onMenu: () => void;
  onOpenSearch: () => void;
  userLabel: string;
  onSignOut: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const theme = useTheme();

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
            { borderColor: theme.border, backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
          ]}
        >
          <ThemedText type="small">☰</ThemedText>
        </Pressable>
      ) : null}

      <ThemedText type="small" style={styles.title} numberOfLines={1}>
        {title}
      </ThemedText>

      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Search"
        onPress={onOpenSearch}
        style={({ hovered }) => [
          styles.search,
          {
            borderColor: hovered ? theme.borderStrong : theme.border,
            backgroundColor: theme.surfaceRaised,
          },
        ]}
      >
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.searchText}>
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

      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account menu"
          accessibilityState={{ expanded: menuOpen }}
          onPress={onToggleMenu}
          style={({ hovered }) => [
            styles.user,
            { backgroundColor: hovered || menuOpen ? theme.surfaceRaised : 'transparent' },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: AccentColors.primary }]}>
            <ThemedText type="caption" style={styles.avatarText}>
              {userLabel.slice(0, 1).toUpperCase()}
            </ThemedText>
          </View>
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1} style={styles.userName}>
            {userLabel}
          </ThemedText>
        </Pressable>

        {menuOpen ? (
          <View
            style={[
              styles.dropdown,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
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
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  title: { flexShrink: 1 },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  search: {
    flex: 1,
    maxWidth: 420,
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 34,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  searchText: { flex: 1 },
  kbd: {
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  user: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 34,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.control,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#0d0d0d', fontWeight: 700 },
  userName: { maxWidth: 160 },
  dropdown: {
    position: 'absolute',
    top: 40,
    right: 0,
    minWidth: 160,
    padding: Spacing.one,
    borderRadius: Radius.card,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },
  dropdownItem: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
  },
});
