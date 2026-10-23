import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  AlertCircleIcon,
  AlertIcon,
  CheckCircleIcon,
  InfoIcon,
  type IconProps,
} from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Button } from './button';
import { alpha } from './utils';

/**
 * What a section shows when it has nothing to show yet. It says what will
 * appear here and, when there is one, offers the action that makes it appear.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: ComponentType<IconProps>;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void; icon?: ComponentType<IconProps> };
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.empty,
        compact && styles.emptyCompact,
        { borderColor: theme.border, backgroundColor: theme.surfaceRaised },
      ]}
    >
      {Icon ? (
        <View style={[styles.emptyIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Icon size={20} color={theme.textSecondary} />
        </View>
      ) : null}
      <ThemedText type="smallBold" style={styles.center}>
        {title}
      </ThemedText>
      {description ? (
        <ThemedText type="caption" themeColor="textSecondary" style={[styles.center, styles.emptyText]}>
          {description}
        </ThemedText>
      ) : null}
      {action ? (
        <Button label={action.label} icon={action.icon} onPress={action.onPress} size="sm" style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const NOTICE_ICONS: Record<NoticeTone, ComponentType<IconProps>> = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: AlertIcon,
  danger: AlertCircleIcon,
};

/**
 * A message inside the page: a failed load, a saved form, a heads-up. Errors
 * are announced immediately; everything else politely.
 */
export function InlineAlert({
  tone = 'info',
  title,
  message,
  action,
  style,
}: {
  tone?: NoticeTone;
  title?: string;
  message: string;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const color = { info: theme.info, success: theme.success, warning: theme.warning, danger: theme.danger }[tone];
  const bg = { info: theme.infoSoft, success: theme.successSoft, warning: theme.warningSoft, danger: theme.dangerSoft }[tone];
  const Icon = NOTICE_ICONS[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      style={[styles.notice, { backgroundColor: bg, borderColor: alpha(color, 0.25) }, style]}
    >
      <Icon size={18} color={color} />
      <View style={styles.noticeText}>
        {title ? <ThemedText type="smallBold">{title}</ThemedText> : null}
        <ThemedText type="small" style={{ color: theme.text }}>
          {message}
        </ThemedText>
      </View>
      {action}
    </View>
  );
}

/** A grey placeholder block shown while real content loads. */
export function Skeleton({ width = '100%', height = 14, radius = 6, style }: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return <View style={[{ width, height, borderRadius: radius, backgroundColor: theme.surfaceRaised }, style]} />;
}

/** A few skeleton rows, the shape of a list that is about to arrive. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" style={styles.skeletonList}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <Skeleton width={34} height={34} radius={10} />
          <View style={styles.skeletonText}>
            <Skeleton width="62%" height={12} />
            <Skeleton width="38%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator color={theme.accentText} />
      <ThemedText type="caption" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

/** A section that failed to load, with a way to try again. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <InlineAlert
      tone="danger"
      message={message}
      action={onRetry ? <Button label="Try again" size="sm" onPress={onRetry} /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: Radius.card - 4,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyCompact: { paddingVertical: 18 },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  center: { textAlign: 'center' },
  emptyText: { maxWidth: 340, fontSize: 13, lineHeight: 18 },
  emptyAction: { alignSelf: 'center', marginTop: 8 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.control + 2,
    borderWidth: 1,
  },
  noticeText: { flex: 1, gap: 2 },
  skeletonList: { gap: 14 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skeletonText: { flex: 1, gap: 6 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 28 },
});
