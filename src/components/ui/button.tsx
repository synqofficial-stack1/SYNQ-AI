import { useState, type ComponentType, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { IconProps } from '@/components/icons';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { alpha, transition } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger' | 'dangerOutline';
export type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ComponentType<IconProps>;
  iconRight?: ComponentType<IconProps>;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT: Record<ButtonSize, number> = { sm: 34, md: 40, lg: 46 };
const PAD: Record<ButtonSize, number> = { sm: 12, md: 16, lg: 20 };
const FONT: Record<ButtonSize, number> = { sm: 13, md: 14, lg: 15 };

/**
 * The one button. Yellow `primary` is for the main action on a surface — at
 * most one or two per screen; `secondary` is the white bordered default for
 * everything else; `dark` is the near-black alternative primary; `danger` is
 * only for destructive confirmation.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading,
  disabled,
  fullWidth,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  style,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const palette = {
    primary: { bg: theme.accent, hover: theme.accentHover, fg: theme.onAccent, border: theme.accent },
    secondary: { bg: theme.surface, hover: theme.surfaceRaised, fg: theme.text, border: theme.border },
    ghost: { bg: 'transparent', hover: theme.surfaceRaised, fg: theme.text, border: 'transparent' },
    dark: { bg: '#171717', hover: '#2A2A28', fg: '#FFFFFF', border: '#171717' },
    danger: { bg: theme.danger, hover: alpha(theme.danger, 0.88), fg: '#FFFFFF', border: theme.danger },
    dangerOutline: { bg: theme.surface, hover: theme.dangerSoft, fg: theme.danger, border: alpha(theme.danger, 0.45) },
  }[variant];

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.base,
        transition,
        {
          height: HEIGHT[size],
          paddingHorizontal: PAD[size],
          backgroundColor: !inactive && (hovered || pressed) ? palette.hover : palette.bg,
          borderColor: palette.border,
          opacity: inactive ? 0.5 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : Icon ? (
        <Icon size={FONT[size] + 3} color={palette.fg} />
      ) : null}
      <Text numberOfLines={1} style={[styles.label, { color: palette.fg, fontSize: FONT[size] }]}>
        {label}
      </Text>
      {IconRight && !loading ? <IconRight size={FONT[size] + 2} color={palette.fg} /> : null}
    </Pressable>
  );
}

type IconButtonProps = {
  icon: ComponentType<IconProps>;
  /** Required: it is the accessible name and the hover tooltip. */
  label: string;
  onPress?: () => void;
  variant?: 'ghost' | 'outline' | 'dark';
  size?: number;
  /** A small dot in the corner, e.g. unread notifications. */
  badge?: boolean;
  selected?: boolean;
  disabled?: boolean;
  color?: string;
  accessibilityState?: { expanded?: boolean; selected?: boolean };
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  icon: Icon,
  label,
  onPress,
  variant = 'ghost',
  size = 38,
  badge,
  selected,
  disabled,
  color,
  accessibilityState,
  style,
}: IconButtonProps) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const dark = variant === 'dark';
  const fg = color ?? (dark ? '#A9A59C' : theme.textSecondary);
  return (
    <View style={styles.iconWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled, selected, ...accessibilityState }}
        disabled={disabled}
        onPress={onPress}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        style={({ pressed, hovered }) => [
          styles.icon,
          transition,
          {
            width: size,
            height: size,
            borderColor: variant === 'outline' ? theme.border : 'transparent',
            backgroundColor:
              hovered || pressed || selected
                ? dark
                  ? 'rgba(255, 255, 255, 0.08)'
                  : theme.surfaceRaised
                : variant === 'outline'
                  ? theme.surface
                  : 'transparent',
            opacity: disabled ? 0.45 : 1,
          },
          style,
        ]}
      >
        <Icon size={Math.round(size * 0.47)} color={hover ? (dark ? '#F5F4F0' : theme.text) : fg} />
        {badge ? <View style={[styles.dot, { backgroundColor: theme.danger, borderColor: dark ? '#111210' : theme.surface }]} /> : null}
      </Pressable>
      {/* A hover label on the web, where there is a pointer to hover with. */}
      {hover && Platform.OS === 'web' ? (
        <View pointerEvents="none" style={[styles.tooltip, { top: size + 6 }]}>
          <Text style={styles.tooltipText} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A quiet text-and-arrow link used for "View all" in card headers. */
export function LinkButton({
  label,
  onPress,
  icon: Icon,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: ComponentType<IconProps>;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.link,
        transition,
        {
          borderColor: theme.border,
          backgroundColor: hovered || pressed ? theme.surfaceRaised : theme.surface,
        },
      ]}
    >
      <Text style={[styles.linkText, { color: theme.text }]}>{label}</Text>
      {Icon ? <Icon size={14} color={theme.textSecondary} /> : null}
    </Pressable>
  );
}

export function ButtonRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: Radius.control,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  fullWidth: { alignSelf: 'stretch' },
  label: { fontWeight: '600', letterSpacing: -0.1 },
  iconWrap: { position: 'relative' },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  dot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
  },
  tooltip: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 50,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#171717',
  },
  tooltipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '500' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  linkText: { fontSize: 13, fontWeight: '500' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
});
