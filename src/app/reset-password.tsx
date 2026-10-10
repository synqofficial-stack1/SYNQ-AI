import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthBackdrop, BrandMark } from '@/components/auth-backdrop';
import { GoldButton } from '@/components/auth-buttons';
import { AuthCard, AuthHeading } from '@/components/auth-card';
import { AuthField } from '@/components/auth-field';
import { EyeIcon, EyeOffIcon, LockIcon } from '@/components/auth-icons';
import { AccentColors } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { authErrorMessage } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Where the link in the reset email lands.
//
// It sits outside the (auth) group on purpose. Opening that link signs the user
// in with a short-lived recovery session, and the auth group bounces anyone
// with a session straight into the app — which would skip the one screen they
// came here for.

const MIN_PASSWORD = 6;

export default function ResetPasswordScreen() {
  const { session, isLoading } = useSession();
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(authErrorMessage(updateError));
        return;
      }
      router.replace('/(app)');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const ready = !isLoading && Boolean(session);

  return (
    <AuthBackdrop>
      <BrandMark />

      <AuthCard>
        <AuthHeading
          title="Choose a new password"
          subtitle={
            ready
              ? 'Pick something you have not used here before. You will be signed in straight after.'
              : 'Open the link from the reset email on this device, and this page will let you set a new password.'
          }
        />

        {ready ? (
          <>
            <AuthField
              icon={<LockIcon />}
              placeholder="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!reveal}
              autoComplete="password-new"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={handleSave}
              trailing={reveal ? <EyeIcon /> : <EyeOffIcon />}
              trailingLabel={reveal ? 'Hide password' : 'Show password'}
              onTrailingPress={() => setReveal((value) => !value)}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <GoldButton
              title="Save password"
              onPress={handleSave}
              loading={busy}
              disabled={busy || !password}
            />
          </>
        ) : null}

        <View style={styles.footer}>
          <Link href="/(auth)/login" asChild>
            <Pressable accessibilityRole="link">
              <Text style={styles.footerLink}>Back to log in</Text>
            </Pressable>
          </Link>
        </View>
      </AuthCard>
    </AuthBackdrop>
  );
}

const styles = StyleSheet.create({
  error: { color: AccentColors.error, fontSize: 13, lineHeight: 19 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 2 },
  footerLink: { color: AccentColors.primaryLight, fontSize: 14, fontWeight: '600' },
});
