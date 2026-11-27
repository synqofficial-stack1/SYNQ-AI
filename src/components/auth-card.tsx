import { StyleSheet, Text, View, type ViewProps } from 'react-native';

// The column a sign-in form lives in.
//
// There is deliberately no panel drawn around it: the glass is in the fields
// and the buttons themselves, so the form reads as floating in the room rather
// than as a card pasted over a photograph. All this does is hold the column to
// a readable width and keep the rhythm between rows.

export function AuthCard({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.column, style]} />;
}

/**
 * Error and success copy on the sign-in photograph. Bare red or white text
 * disappears into the city lights, so it sits on a dark chip.
 */
export function AuthNotice({ tone, children }: { tone: 'error' | 'info'; children: string }) {
  const error = tone === 'error';
  return (
    <View accessibilityRole={error ? 'alert' : undefined} style={[styles.notice, error ? styles.noticeError : styles.noticeInfo]}>
      <Text style={[styles.noticeText, { color: error ? '#FECACA' : '#ECFDF3' }]}>{children}</Text>
    </View>
  );
}

/** The title on the screens that need one. The login screen does not: the logo is the title. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: 16,
  },
  heading: { gap: 8, alignItems: 'center', marginBottom: 4 },
  title: {
    color: '#ffffff',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.62)',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  notice: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeError: {
    backgroundColor: 'rgba(69, 10, 10, 0.82)',
    borderColor: 'rgba(252, 165, 165, 0.45)',
  },
  noticeInfo: {
    backgroundColor: 'rgba(6, 32, 18, 0.78)',
    borderColor: 'rgba(187, 247, 208, 0.4)',
  },
  noticeText: { fontSize: 13, lineHeight: 19 },
});
