import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthBackdrop, BrandMark } from '@/components/auth-backdrop';
import { GoldButton } from '@/components/auth-buttons';
import { AuthCard, AuthHeading } from '@/components/auth-card';
import { AuthField } from '@/components/auth-field';
import { MailIcon } from '@/components/auth-icons';
import { AccentColors } from '@/constants/theme';
import { sendPasswordReset } from '@/lib/auth';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    setError(null);
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the email. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthBackdrop>
      <BrandMark />

      <AuthCard>
        <AuthHeading
          title="Forgot your password?"
          subtitle="Enter the email you signed up with and we will send you a link to set a new one."
        />

        <AuthField
          icon={<MailIcon />}
          placeholder="Email"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setSent(false);
          }}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          inputMode="email"
          returnKeyType="go"
          onSubmitEditing={handleSend}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sent ? (
          // Deliberately not "we found your account": whether an address is
          // registered is not something a sign-in page should confirm.
          <Text style={styles.info}>
            If that email has an account, a reset link is on its way. Check the inbox and the spam
            folder.
          </Text>
        ) : null}

        <GoldButton
          title={sent ? 'Send it again' : 'Send reset link'}
          onPress={handleSend}
          loading={busy}
          disabled={busy || !email.trim()}
        />

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
  info: { color: 'rgba(255, 255, 255, 0.78)', fontSize: 13, lineHeight: 19 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 2 },
  footerLink: { color: AccentColors.primaryLight, fontSize: 14, fontWeight: '600' },
});
