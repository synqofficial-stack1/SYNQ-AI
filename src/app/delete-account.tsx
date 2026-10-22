import { Link } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { DeleteAccountPanel } from '@/components/delete-account-panel';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius } from '@/constants/theme';
import { LEGAL, legalValue } from '@/constants/legal';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';

// Google Play requires a web page where people can delete their account without
// the app installed. It lives outside every route group so it opens signed out;
// the delete control itself only appears once the visitor signs in.

export default function DeleteAccountScreen() {
  const theme = useTheme();
  const { session, isLoading } = useSession();
  return <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center', padding: 24, gap: 18 }}>
    <ThemedText type="pageTitle">Delete your Synq AI account</ThemedText>
    <ThemedText type="small" style={{ lineHeight: 22 }}>
      Sign in with the account you want to delete, type DELETE, and confirm. The account and its data are removed immediately. You can also do this in the app under Settings → Delete account.
    </ThemedText>

    <View style={{ borderWidth: 1, borderColor: AccentColors.error, borderRadius: Radius.card, padding: 18, gap: 12, backgroundColor: theme.surface }}>
      {isLoading ? <ThemedText type="caption" themeColor="textSecondary">Checking whether you are signed in…</ThemedText>
        : session ? <>
          <ThemedText type="caption" themeColor="textSecondary">Signed in as {session.user.email ?? 'this account'}</ThemedText>
          <DeleteAccountPanel />
        </> : <>
          <ThemedText type="small">Sign in first, then come back to this page.</ThemedText>
          <Link href="/(auth)/login" asChild><Pressable accessibilityRole="link"><ThemedText type="linkPrimary">Sign in to Synq</ThemedText></Pressable></Link>
        </>}
    </View>

    <ThemedText type="caption" themeColor="textSecondary" style={{ lineHeight: 20 }}>
      Can&apos;t sign in? Email {legalValue(LEGAL.contactEmail)} from the address on the account and we will delete it for you.
    </ThemedText>
    <Link href="/privacy" asChild><Pressable accessibilityRole="link"><ThemedText type="linkPrimary">Privacy policy</ThemedText></Pressable></Link>
  </ScrollView>;
}
