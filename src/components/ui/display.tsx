import { useState, type ComponentType, type ReactNode } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { ChevronRightIcon, type IconProps } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { alpha, initials, transition } from './utils';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

function useTone(tone: Tone) {
  const theme = useTheme();
  return {
    neutral: { fg: theme.textSecondary, bg: theme.surfaceRaised, border: theme.border },
    accent: { fg: theme.accentText, bg: theme.accentSoft, border: theme.accentBorder },
    success: { fg: theme.success, bg: theme.successSoft, border: alpha(theme.success, 0.25) },
    warning: { fg: theme.warning, bg: theme.warningSoft, border: alpha(theme.warning, 0.25) },
    danger: { fg: theme.danger, bg: theme.dangerSoft, border: alpha(theme.danger, 0.25) },
    info: { fg: theme.info, bg: theme.infoSoft, border: alpha(theme.info, 0.25) },
  }[tone];
}

/**
 * A status label. Always carries words, never colour alone: the dot is a
 * decoration, the label is the information.
 */
export function StatusBadge({ label, tone = 'neutral', dot = true }: { label: string; tone?: Tone; dot?: boolean }) {
  const colors = useTone(tone);
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      {dot ? <View style={[styles.badgeDot, { backgroundColor: colors.fg }]} /> : null}
      <Text style={[styles.badgeText, { color: colors.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A category tag: a plain label in a soft pill, no status meaning. */
export function Tag({ label, color }: { label: string; color?: string }) {
  const theme = useTheme();
  const fg = color ?? theme.textSecondary;
  return (
    <View style={[styles.tag, { backgroundColor: color ? alpha(color, 0.1) : theme.surfaceRaised }]}>
      <Text style={[styles.tagText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The coloured square an icon sits in, tinted from one colour. */
export function IconTile({
  icon: Icon,
  color,
  size = 40,
  style,
}: {
  icon: ComponentType<IconProps>;
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size >= 40 ? 12 : 10, backgroundColor: alpha(color, 0.12) },
        style,
      ]}
    >
      <Icon size={Math.round(size * 0.48)} color={color} />
    </View>
  );
}

export function Avatar({ name, size = 36, tone = 'accent' }: { name: string; size?: number; tone?: 'accent' | 'neutral' }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone === 'accent' ? theme.accent : theme.surfaceRaised,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42, color: tone === 'accent' ? theme.onAccent : theme.text }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

/**
 * Progress towards a real target. Callers must only use this when there is a
 * target to measure against; a bar with nothing behind it is a made-up number.
 */
export function ProgressBar({
  value,
  color,
  label,
  height = 8,
}: {
  /** 0–1. Values above 1 draw full. */
  value: number;
  color?: string;
  label: string;
  height?: number;
}) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: theme.surfaceRaised }]}
    >
      <View style={{ width: `${clamped * 100}%`, height: '100%', borderRadius: height / 2, backgroundColor: color ?? theme.accent }} />
    </View>
  );
}

export type TabItem<K extends string> = { key: K; label: string; icon?: ComponentType<IconProps>; count?: number };

/**
 * Section tabs: the selected one is filled yellow, the rest sit on white. On a
 * narrow screen they scroll sideways instead of wrapping into a wall of pills.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  size = 'md',
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Names the tab list for screen readers, e.g. "Sales sections". */
  label: string;
  size?: 'sm' | 'md';
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabsScroll}
      contentContainerStyle={styles.tabs}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {items.map((item) => {
        const active = item.key === value;
        const Icon = item.icon;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.count !== undefined ? `${item.label}, ${item.count}` : item.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(item.key)}
            style={({ hovered, pressed }) => [
              styles.tab,
              transition,
              size === 'sm' && styles.tabSmall,
              {
                backgroundColor: active ? theme.accent : hovered || pressed ? theme.surfaceRaised : theme.surface,
                borderColor: active ? theme.accent : theme.border,
              },
            ]}
          >
            {Icon ? <Icon size={15} color={active ? theme.onAccent : theme.textSecondary} /> : null}
            <Text
              style={[
                styles.tabText,
                size === 'sm' && styles.tabTextSmall,
                { color: active ? theme.onAccent : theme.text, fontWeight: active ? '600' : '500' },
              ]}
            >
              {item.label}
            </Text>
            {item.count !== undefined ? (
              <View style={[styles.tabCount, { backgroundColor: active ? 'rgba(23,23,23,0.12)' : theme.surfaceRaised }]}>
                <Text style={[styles.tabCountText, { color: active ? theme.onAccent : theme.textSecondary }]}>{item.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Small filter chips (All / Social / Video…). Selected is yellow, like tabs. */
export function FilterChips<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return <Tabs items={items} value={value} onChange={onChange} label={label} size="sm" />;
}

/**
 * A tiny trend line drawn from real counts. With fewer than two points, or no
 * activity at all, it draws nothing rather than a flat pretend line.
 */
export function Sparkline({ values, color, width = 96, height = 36 }: { values: number[]; color: string; width?: number; height?: number }) {
  const id = `spark-${color.replace('#', '')}`;
  if (values.length < 2 || !values.some((value) => value > 0)) return null;
  const peak = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values.map((value, index) => ({ x: index * step, y: height - 3 - (value / peak) * (height - 6) }));
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const mid = (from.x + to.x) / 2;
    d += ` C ${mid} ${from.y} ${mid} ${to.y} ${to.x} ${to.y}`;
  }
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  // The trend is decorative (the card states the number), so it is hidden from
  // screen readers. The props go on a View: react-native-svg hands unknown
  // props straight to the DOM on web, where React rejects them.
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={area} fill={`url(#${id})`} />
        <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/**
 * A headline number. `value` of null means "still loading" and draws a
 * placeholder; a note explains the number, and `trend` is only passed when
 * there is a genuine earlier period to compare with.
 */
export function KpiCard({
  label,
  value,
  icon,
  color,
  note,
  trend,
  spark,
  onPress,
}: {
  label: string;
  value: string | null;
  icon: ComponentType<IconProps>;
  color: string;
  note?: string;
  trend?: { text: string; direction: 'up' | 'down' | 'flat' };
  spark?: number[];
  onPress?: () => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const trendColor = trend?.direction === 'up' ? theme.success : trend?.direction === 'down' ? theme.danger : theme.textSecondary;
  const body = (
    <View style={styles.kpiRow} onLayout={onLayout}>
      <IconTile icon={icon} color={color} size={44} />
      <View style={styles.kpiText}>
        <ThemedText type="label" themeColor="textSecondary" numberOfLines={1}>
          {label}
        </ThemedText>
        <View style={styles.kpiValueRow}>
          {value === null ? (
            <View style={[styles.kpiSkeleton, { backgroundColor: theme.surfaceRaised }]} />
          ) : (
            <ThemedText type="metric" numberOfLines={1}>
              {value}
            </ThemedText>
          )}
          {trend && value !== null ? (
            <Text style={[styles.trend, { color: trendColor }]}>
              {trend.direction === 'up' ? '↑ ' : trend.direction === 'down' ? '↓ ' : ''}
              {trend.text}
            </Text>
          ) : null}
        </View>
        {note ? (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
            {note}
          </ThemedText>
        ) : null}
      </View>
      {spark && width > 300 ? (
        <View style={styles.kpiSpark}>
          <Sparkline values={spark} color={color} />
        </View>
      ) : null}
    </View>
  );
  const containerStyle = [styles.kpi, { backgroundColor: theme.surface, borderColor: theme.border }];
  if (!onPress) return <View style={containerStyle}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${value ?? 'loading'}`}
      onPress={onPress}
      style={({ hovered }) => [containerStyle, transition, hovered && { borderColor: theme.borderStrong }]}
    >
      {body}
    </Pressable>
  );
}

/**
 * One row of a list: icon, title, subtitle, and whatever goes on the right.
 * With `onPress` it becomes a link and gets a chevron.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  meta,
  onPress,
  chevron,
  divider = true,
  accessibilityLabel,
  danger,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  meta?: string;
  onPress?: () => void;
  chevron?: boolean;
  divider?: boolean;
  accessibilityLabel?: string;
  danger?: boolean;
}) {
  const theme = useTheme();
  const content = (
    <>
      {leading}
      <View style={styles.rowText}>
        <ThemedText type="small" numberOfLines={2} style={[styles.rowTitle, danger && { color: theme.danger }]}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {meta ? (
        <ThemedText type="caption" themeColor="textSecondary" style={styles.rowMeta}>
          {meta}
        </ThemedText>
      ) : null}
      {trailing}
      {onPress && chevron !== false ? <ChevronRightIcon size={16} color={danger ? theme.danger : theme.textSecondary} /> : null}
    </>
  );
  const base = [styles.row, divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }];
  if (!onPress) return <View style={base}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ hovered, pressed }) => [base, styles.rowPressable, transition, (hovered || pressed) && { backgroundColor: theme.surfaceRaised }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.pill },
  tagText: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700' },
  track: { width: '100%', overflow: 'hidden' },
  tabsScroll: { flexGrow: 0, flexShrink: 0 },
  tabs: { flexDirection: 'row', gap: Spacing.two, paddingVertical: 2 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  tabSmall: { height: 32, paddingHorizontal: 13 },
  tabText: { fontSize: 14 },
  tabTextSmall: { fontSize: 13 },
  tabCount: { minWidth: 20, paddingHorizontal: 6, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabCountText: { fontSize: 11, fontWeight: '600' },
  kpi: { flex: 1, borderWidth: 1, borderRadius: Radius.card, padding: 18 },
  kpiRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  kpiText: { flex: 1, minWidth: 0, gap: 2 },
  kpiValueRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  kpiSkeleton: { width: 64, height: 30, borderRadius: 8, marginVertical: 3 },
  kpiSpark: { alignSelf: 'flex-end' },
  trend: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowPressable: { paddingHorizontal: 8, marginHorizontal: -8, borderRadius: Radius.control },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontWeight: '500' },
  rowMeta: { flexShrink: 0 },
});
