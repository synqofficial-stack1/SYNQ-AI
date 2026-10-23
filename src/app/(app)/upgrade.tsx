import { StyleSheet, View } from 'react-native';

import { CrownIcon, MessageIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Page, showToast } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openWhatsAppSupport, SUPPORT_PHONE } from '@/lib/support';

// Paid plans are not built yet, so this page says so plainly instead of listing
// prices nobody can pay. Anyone interested talks to the Synq team on WhatsApp.

export default function UpgradeScreen() {
  const theme = useTheme();

  const contact = async () => {
    const opened = await openWhatsAppSupport('Hi! I would like to know about Synq Pro.');
    if (!opened) showToast('Your device could not open WhatsApp.', 'danger');
  };

  return (
    <Page maxWidth={720}>
      <Card style={styles.card}>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft, borderColor: theme.accentBorder }]}>
          <CrownIcon size={30} color={theme.accentText} />
        </View>
        <ThemedText type="pageTitle" accessibilityRole="header" style={styles.center}>
          Synq Pro is coming soon
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={[styles.center, styles.body]}>
          Paid plans with more departments and advanced features are on their way. Until then, Synq stays free with your daily AI credits.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          Want early access or have a question? Message us.
        </ThemedText>
        <View style={styles.contact}>
          <Button label="Contact us on WhatsApp" variant="primary" size="lg" icon={MessageIcon} onPress={() => void contact()} style={styles.centered} />
          <ThemedText type="caption" themeColor="textSecondary">
            WhatsApp · {SUPPORT_PHONE}
          </ThemedText>
        </View>
      </Card>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: 16, paddingVertical: 40, marginTop: 24 },
  badge: { width: 72, height: 72, borderRadius: Radius.card + 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  body: { maxWidth: 480, lineHeight: 22 },
  contact: { alignSelf: 'stretch', alignItems: 'center', gap: 8 },
  // Button pins itself to the start of its row; this page is centered.
  centered: { alignSelf: 'center' },
});
