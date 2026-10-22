import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PageMaxWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useBreakpoint } from './utils';

/**
 * Every app page scrolls inside this: one max width, one gutter, one rhythm
 * between sections. `scroll={false}` is for pages that manage their own
 * scrolling (a chat, a split editor).
 */
export function Page({
  children,
  scroll = true,
  maxWidth = PageMaxWidth,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  maxWidth?: number;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { isCompact } = useBreakpoint();
  const inner = [
    styles.content,
    { maxWidth, padding: isCompact ? Spacing.three : Spacing.five - 4, paddingBottom: Spacing.six },
    contentStyle,
  ];
  if (!scroll) return <View style={[styles.fill, inner]}>{children}</View>;
  return (
    <ScrollView style={styles.fill} contentContainerStyle={inner} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

/** Title, one line of description, and the page's own actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <ThemedText type="pageTitle" accessibilityRole="header">
          {title}
        </ThemedText>
        {description ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
            {description}
          </ThemedText>
        ) : null}
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  );
}

/** The surface everything sits on: white, hairline border, 16px corners. */
export function Card({
  children,
  style,
  padded = true,
  tone = 'default',
  nativeID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** `danger` is reserved for destructive zones such as account deletion. */
  tone?: 'default' | 'muted' | 'danger' | 'accent';
  nativeID?: string;
}) {
  const theme = useTheme();
  const { isCompact } = useBreakpoint();
  const toneStyle = {
    default: { backgroundColor: theme.surface, borderColor: theme.border },
    muted: { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
    danger: { backgroundColor: theme.surface, borderColor: theme.danger },
    accent: { backgroundColor: theme.accentSoft, borderColor: theme.accentBorder },
  }[tone];
  return (
    <View
      nativeID={nativeID}
      style={[styles.card, toneStyle, padded && { padding: isCompact ? Spacing.three : 20 }, style]}
    >
      {children}
    </View>
  );
}

/** A card or section heading with an optional action on the right. */
export function SectionHeader({
  title,
  subtitle,
  action,
  size = 'section',
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  size?: 'section' | 'card';
  icon?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <View style={styles.sectionText}>
        <ThemedText type={size === 'card' ? 'cardTitle' : 'sectionTitle'} accessibilityRole="header">
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="caption" themeColor="textSecondary" style={styles.subtitle}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {action ? <View style={styles.sectionAction}>{action}</View> : null}
    </View>
  );
}

/**
 * Lays children out in columns that wrap: `columns` on desktop, fewer on a
 * tablet, one on a phone. Children size by `flexBasis`, so a row of KPI cards
 * and a two-thirds/one-third split both work.
 */
export function Grid({
  children,
  minColumnWidth = 260,
  gap = Spacing.three,
  style,
}: {
  children: ReactNode;
  minColumnWidth?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.grid, { gap }, style]}>
      {Array.isArray(children)
        ? children.map((child, index) =>
            child ? (
              <View key={index} style={[styles.gridItem, { flexBasis: minColumnWidth, minWidth: Math.min(minColumnWidth, 280) }]}>
                {child}
              </View>
            ) : null,
          )
        : children}
    </View>
  );
}

/** A row that becomes a column on narrow screens. `ratio` sets the main column's share. */
export function Split({
  main,
  side,
  ratio = 1.7,
  breakAt = 1100,
  gap = Spacing.three,
}: {
  main: ReactNode;
  side: ReactNode;
  ratio?: number;
  breakAt?: number;
  gap?: number;
}) {
  const { width } = useBreakpoint();
  const stacked = width < breakAt;
  return (
    <View style={[styles.split, { gap, flexDirection: stacked ? 'column' : 'row' }]}>
      <View style={[styles.splitColumn, { gap }, !stacked && { flex: ratio }]}>{main}</View>
      <View style={[styles.splitColumn, { gap }, !stacked && { flex: 1 }]}>{side}</View>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }, style]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { width: '100%', alignSelf: 'center', gap: 20 },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  headerText: { flexShrink: 1, flexGrow: 1, flexBasis: 280, gap: 4 },
  description: { fontSize: 15, lineHeight: 22 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  card: { borderWidth: 1, borderRadius: Radius.card, gap: Spacing.three },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + 4 },
  sectionText: { flex: 1, minWidth: 0, gap: 2 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  sectionAction: { flexShrink: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridItem: { flexGrow: 1, flexShrink: 1 },
  split: { alignItems: 'stretch' },
  splitColumn: { minWidth: 0 },
});
