import { useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { AccentColors } from '@/constants/theme';

// The browser draws its own focus ring on top of the input; here the border is
// the ring, so the native one goes. Not a React Native style, hence the cast.
const noWebOutline = Platform.select({
  web: { outlineStyle: 'none' } as unknown as TextStyle,
  default: null,
});

// One input on the sign-in screens: a glass pill with a mark on the left and,
// on a password, the show/hide eye on the right.
//
// It keeps its own focus state so the border can pick up the gold — the only
// colour on the page that means "you are here".

type Props = TextInputProps & {
  icon: ReactNode;
  /** Sits at the trailing edge; the eye toggle on a password field. */
  trailing?: ReactNode;
  onTrailingPress?: () => void;
  trailingLabel?: string;
};

export function AuthField({
  icon,
  trailing,
  onTrailingPress,
  trailingLabel,
  style,
  onFocus,
  onBlur,
  ...props
}: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.row,
        focused && { borderColor: 'rgba(232, 197, 71, 0.55)', backgroundColor: 'rgba(255, 255, 255, 0.09)' },
      ]}
    >
      <View style={styles.icon}>{icon}</View>

      <TextInput
        placeholderTextColor="rgba(255, 255, 255, 0.45)"
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={AccentColors.primary}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
        style={[styles.input, noWebOutline, style]}
      />

      {trailing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={trailingLabel}
          onPress={onTrailingPress}
          disabled={!onTrailingPress}
          hitSlop={10}
          style={styles.trailing}
        >
          {trailing}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 58,
    paddingHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  icon: { width: 20, alignItems: 'center' },
  input: {
    flex: 1,
    height: '100%',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
  },
  trailing: { width: 22, alignItems: 'center' },
});
