import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // With "Confirm email" turned OFF in the Supabase dashboard, signUp returns a
  // session immediately and the user lands straight in the app. With it ON,
  // Supabase sends a confirmation email and withholds the session until the user
  // clicks the link — the `else` branch below covers that case.
  //
  // TODO: non-blocking email verification. Supabase's single "Confirm email"
  // toggle is all-or-nothing (either it blocks login and sends the email, or it
  // sends nothing). To get instant access AND a verification email, send the
  // verification separately and show a dismissible "verify your email" banner in
  // the app instead of gating access on it.
  async function handleSignup() {
    setError(null);
    setInfo(null);
    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (data.session) {
      router.replace('/(app)');
      return;
    }
    setInfo('Account created. Check your email to confirm it, then log in.');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.form}
        >
          <ThemedText type="title" style={styles.title}>
            Synq AI
          </ThemedText>
          <ThemedText type="subtitle" style={styles.subtitle}>
            Create an account
          </ThemedText>

          <TextField
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextField
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password-new"
          />

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
          {info ? <ThemedText style={styles.info}>{info}</ThemedText> : null}

          <PrimaryButton title="Sign Up" onPress={handleSignup} loading={loading} />

          <Link href="/(auth)/login" style={styles.link}>
            <ThemedText type="link">Already have an account? Log in</ThemedText>
          </Link>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.four },
  form: { gap: Spacing.three },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: Spacing.three },
  error: { color: '#e5484d' },
  info: { color: '#3c87f7' },
  link: { alignSelf: 'center', marginTop: Spacing.two },
});
