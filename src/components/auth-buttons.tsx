import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ArrowRightIcon, ChevronRightIcon, GoogleMark } from '@/components/auth-icons';
import { AccentColors } from '@/constants/theme';

// The two buttons and the divider the sign-in screens share. Both buttons are
// the same height and shape so the column reads as one stack; only the fill
// differs, which is what says which one is the way forward.

type ActionProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

/** The gold one. There is exactly one per screen. */
export function GoldButton({ title, onPress, loading, disabled }: ActionProps) {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        styles.gold,
        { opacity: inactive ? 0.68 : pressed ? 0.88 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#0D0D0D" />
      ) : (
        <View style={styles.goldInner}>
          <Text style={styles.goldLabel}>{title}</Text>
          <ArrowRightIcon />
        </View>
      )}
    </Pressable>
  );
}

export function GoogleButton({ title, onPress, loading, disabled }: ActionProps) {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        styles.glass,
        {
          opacity: inactive ? 0.55 : 1,
          backgroundColor: pressed ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.07)',
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <>
          <View style={styles.leading}>
            <GoogleMark />
          </View>
          <Text style={styles.glassLabel}>{title}</Text>
          <View style={styles.trailing}>
            <ChevronRightIcon />
          </View>
        </>
      )}
    </Pressable>
  );
}

export function OrDivider() {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerLabel}>OR</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 58,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gold: { backgroundColor: AccentColors.primaryLight },
  goldInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goldLabel: { color: '#0D0D0D', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },

  glass: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  glassLabel: { color: '#ffffff', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
  // Absolute, so the label stays centred in the pill however wide the marks are.
  leading: { position: 'absolute', left: 22 },
  trailing: { position: 'absolute', right: 22 },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255, 255, 255, 0.14)' },
  dividerLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
  },
});
