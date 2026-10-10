import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthBackdrop, BrandMark } from '@/components/auth-backdrop';
import { GoldButton, GoogleButton, OrDivider } from '@/components/auth-buttons';
import { AuthCard } from '@/components/auth-card';
import { AuthField } from '@/components/auth-field';
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '@/components/auth-icons';
import { AccentColors } from '@/constants/theme';
import { authErrorMessage, googleSignInIsEnabled, signInWithGoogle } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/** Which button is busy. Only one sign-in can be in flight at a time. */
type Busy = 'password' | 'google' | null;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    googleSignInIsEnabled().then((enabled) => {
      if (active) setGoogleEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleLogin() {
    setError(null);
    setBusy('password');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(authErrorMessage(signInError));
        return;
      }
      router.replace('/(app)');
    } catch {
      // signInWithPassword rejects (rather than returning an `error` field) when
      // the request never reaches Supabase at all, e.g. no internet connection.
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy('google');
    try {
      await signInWithGoogle();
      // On the web the browser has already left for Google by now. On a phone
      // the session is set, and the auth layout redirects on the next render.
    } catch (e) {
      setError(e instanceof Error ? e.message : authErrorMessage(null));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthBackdrop>
      <BrandMark />

      <AuthCard>
        {googleEnabled ? (
          <>
            <GoogleButton
              title="Continue with Google"
              onPress={handleGoogle}
              loading={busy === 'google'}
              disabled={busy !== null}
            />
            <OrDivider />
          </>
        ) : null}

        <AuthField
          icon={<MailIcon />}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          inputMode="email"
          returnKeyType="next"
        />

        <AuthField
          icon={<LockIcon />}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!reveal}
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={handleLogin}
          trailing={reveal ? <EyeIcon /> : <EyeOffIcon />}
          trailingLabel={reveal ? 'Hide password' : 'Show password'}
          onTrailingPress={() => setReveal((value) => !value)}
        />

        <Link href="/(auth)/forgot-password" asChild>
          <Pressable accessibilityRole="link" style={styles.forgotRow}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
        </Link>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GoldButton
          title="Log In"
          onPress={handleLogin}
          loading={busy === 'password'}
          disabled={busy !== null || !email.trim() || !password}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don&apos;t have an account? </Text>
          <Link href="/(auth)/signup" asChild>
            <Pressable accessibilityRole="link">
              <Text style={styles.footerLink}>Sign up</Text>
            </Pressable>
          </Link>
        </View>
      </AuthCard>
    </AuthBackdrop>
  );
}

const styles = StyleSheet.create({
  forgotRow: { alignSelf: 'flex-end', marginTop: -4 },
  forgot: { color: 'rgba(255, 255, 255, 0.85)', fontSize: 13, fontWeight: '600' },
  error: { color: AccentColors.error, fontSize: 13, lineHeight: 19 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  footerText: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 14 },
  footerLink: { color: AccentColors.primaryLight, fontSize: 14, fontWeight: '600' },
});
