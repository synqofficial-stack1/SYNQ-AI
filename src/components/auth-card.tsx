import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { Spacing } from '@/constants/theme';

// Real frosted glass needs backdrop-filter, which only exists on web. Native
// keeps the translucent fill and border, which still reads as glass against a
// dark background — it just doesn't blur whatever sits behind it.
const frostedOnWeb = Platform.select({
  web: { backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' },
  default: null,
}) as ViewProps['style'];

export function AuthCard({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.card, frostedOnWeb, style]} />;
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    // Holds the form to a readable column and leaves the rest of the screen
    // free for background artwork.
    maxWidth: 420,
    alignSelf: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.six,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.45,
    shadowRadius: 48,
    elevation: 12,
  },
});
