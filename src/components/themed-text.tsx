import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code'
    | 'pageTitle'
    | 'sectionTitle'
    | 'cardTitle'
    | 'label'
    | 'caption'
    | 'metric';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && [styles.linkPrimary, { color: theme.accentText }],
        type === 'code' && styles.code,
        type === 'pageTitle' && styles.pageTitle,
        type === 'sectionTitle' && styles.sectionTitle,
        type === 'cardTitle' && styles.cardTitle,
        type === 'label' && styles.label,
        type === 'caption' && styles.caption,
        type === 'metric' && styles.metric,
        style,
      ]}
      {...rest}
    />
  );
}

// The working scale: page titles ~30, section headings 18, card headings 16,
// body 14–15, labels 13, captions 12, metric values 30. Weights stay at
// 400/500/600/700 so headings separate from body without shouting.
const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 400,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 600,
  },
  default: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: 400,
  },
  // `title`/`subtitle` are display sizes kept from the original template.
  title: {
    fontSize: 40,
    fontWeight: 700,
    lineHeight: 46,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: 600,
  },
  link: {
    lineHeight: 20,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 20,
    fontSize: 14,
    fontWeight: 600,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
  pageTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: 700,
    letterSpacing: -0.6,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: 700,
    letterSpacing: -0.2,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
    letterSpacing: -0.1,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 500,
  },
  caption: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: 400,
  },
  metric: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: 700,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
});
