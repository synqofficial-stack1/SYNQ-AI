import { useState } from 'react';
import { Platform, StyleSheet, TextInput, type TextInputProps, type TextStyle } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// The border is the focus ring, so the browser's own outline goes. Not a React
// Native style, hence the cast.
const noWebOutline = Platform.select({
  web: { outlineStyle: 'none' } as unknown as TextStyle,
  default: null,
});

/**
 * The app's text input. A white field with a hairline border; focus turns the
 * border yellow and adds a soft ring, so keyboard users can always see where
 * they are. Pair it with `Field` from the UI kit for a visible label.
 */
export function TextField({ style, onFocus, onBlur, multiline, editable, ...props }: TextInputProps) {
  const theme = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const disabled = editable === false;

  return (
    <TextInput
      placeholderTextColor={theme.textTertiary}
      autoCapitalize="none"
      autoCorrect={false}
      selectionColor={theme.accentHover}
      multiline={multiline}
      editable={editable}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        onBlur?.(event);
      }}
      {...props}
      style={[
        styles.input,
        multiline && styles.multiline,
        noWebOutline,
        {
          color: disabled ? theme.textSecondary : theme.text,
          backgroundColor: disabled ? theme.surfaceRaised : theme.backgroundElement,
          borderColor: isFocused ? theme.accentHover : theme.border,
        },
        isFocused && Platform.OS === 'web'
          ? ({ boxShadow: `0 0 0 3px ${theme.accentSoft}` } as unknown as TextStyle)
          : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: Radius.control,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 44,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 },
});
