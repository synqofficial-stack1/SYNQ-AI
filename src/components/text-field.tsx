import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { AccentColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TextField({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const theme = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      autoCapitalize="none"
      autoCorrect={false}
      onFocus={(e) => {
        setIsFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setIsFocused(false);
        onBlur?.(e);
      }}
      {...props}
      // `style` last so a caller can adjust height or font without losing the
      // themed colors underneath.
      style={[
        styles.input,
        {
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          borderColor: isFocused ? AccentColors.primary : theme.backgroundSelected,
          borderWidth: isFocused ? 2 : 1,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
});
