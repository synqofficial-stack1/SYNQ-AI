import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { accountDeletionBlockers, DELETE_CONFIRMATION, deleteAccount } from '@/lib/account';

/**
 * Used in Settings and on the public /delete-account page, so it assumes a
 * signed-in session and leaves sign-in prompts to its parent.
 */
export function DeleteAccountPanel() {
  const theme = useTheme();
  const [typed, setTyped] = useState('');
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    // A failed check is not fatal: the server checks again before deleting.
    accountDeletionBlockers().then((names) => { if (live) setBlockedBy(names); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const confirmed = typed.trim() === DELETE_CONFIRMATION;

  async function remove() {
    if (!confirmed || busy) return;
    setBusy(true); setError('');
    try {
      await deleteAccount(typed);
      router.replace('/(auth)/login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete your account. Try again.');
      setBusy(false);
    }
  }

  return <View style={{ gap: 12 }}>
    <ThemedText type="small">
      This permanently deletes your Synq account: your profile, chats, CRM contacts, email duties, generated images and videos, uploads, and connected social and Gmail accounts. It cannot be undone.
    </ThemedText>
    <ThemedText type="caption" themeColor="textSecondary">
      If you own a company workspace and you are its only active member, the workspace and its shared records are deleted too. Disconnecting Synq here does not remove the access you granted at Google, Instagram, X or LinkedIn; you can revoke that in each account&apos;s security settings.
    </ThemedText>
    {blockedBy.length ? <ThemedText type="small" style={{ color: AccentColors.warning }}>
      You own {blockedBy.join(', ')}, which still has other active members. Remove them in Company first, then come back here.
    </ThemedText> : null}
    <TextField
      accessibilityLabel={`Type ${DELETE_CONFIRMATION} to confirm`}
      placeholder={`Type ${DELETE_CONFIRMATION} to confirm`}
      value={typed}
      onChangeText={setTyped}
      autoCapitalize="characters"
      maxLength={12}
      editable={!busy}
    />
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !confirmed || busy }}
      disabled={!confirmed || busy}
      onPress={() => void remove()}
      style={({ pressed }) => [styles.button, { opacity: !confirmed || busy ? 0.45 : pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.label}>Delete my account permanently</Text>}
    </Pressable>
    {error ? <ThemedText accessibilityRole="alert" type="small" style={{ color: AccentColors.error }}>{error}</ThemedText> : null}
    <ThemedText type="caption" themeColor="textSecondary" style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}>
      Deletion happens immediately; there is no waiting period and no way to restore the account afterwards.
    </ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  button: { backgroundColor: AccentColors.error, borderRadius: Radius.control, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  label: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
