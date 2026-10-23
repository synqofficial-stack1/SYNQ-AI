import { Link, router } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthBackdrop, BrandMark } from '@/components/auth-backdrop';
import { AppleSignInButton } from '@/components/apple-sign-in-button';
import { GoldButton, GoogleButton, OrDivider } from '@/components/auth-buttons';
import { AuthCard } from '@/components/auth-card';
import { AuthField } from '@/components/auth-field';
import {
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
} from '@/components/auth-icons';
import { AccentColors } from '@/constants/theme';
import {
  authErrorMessage,
  googleSignInIsEnabled,
  signInWithApple,
  signInWithGoogle,
  confirmationRedirect,
  resendConfirmation,
} from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type Busy = 'password' | 'google' | 'apple' | 'resend' | null;

export default function SignupScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    googleSignInIsEnabled().then((enabled) => {
      if (active) setGoogleEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  // New accounts must confirm their email (a Supabase Auth setting), which is
  // what stops made-up addresses getting in. Then signUp returns no session and
  // the person is asked to open the link. If the setting is ever off, a session
  // comes back and they go straight in. Supabase also returns no session for an
  // address that already has an account, so the wording covers both.
  async function handleSignup() {
    setError(null);
    setInfo(null);
    setBusy('password');
    try {
      if (!fullName.trim()) {
        setError('Enter your name to create your account.');
        return;
      }
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: confirmationRedirect() },
      });
      if (signUpError) {
        setError(authErrorMessage(signUpError));
        return;
      }
      if (data.session) {
        router.replace('/(app)');
        return;
      }
      setSentTo(email.trim());
      setInfo(
        `We sent a confirmation link to ${email.trim()}. Open it to finish creating your account, then log in. Check spam if it is not there in a minute.`,
      );
    } catch {
      // signUp rejects (rather than returning an `error` field) when the request
      // never reaches Supabase at all, e.g. no internet connection.
      setError(
        'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    if (!sentTo) return;
    setError(null);
    setBusy('resend');
    try {
      await resendConfirmation(sentTo);
      setInfo(`Sent again to ${sentTo}. Open the newest email.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : authErrorMessage(null));
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogle() {
    setError(null);
    setInfo(null);
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : authErrorMessage(null));
    } finally {
      setBusy(null);
    }
  }

  async function handleApple() {
    setError(null);
    setInfo(null);
    setBusy('apple');
    try {
      if (await signInWithApple()) router.replace('/(app)');
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
        {appleAvailable || googleEnabled ? (
          <>
            {appleAvailable ? <AppleSignInButton onPress={handleApple} disabled={busy !== null} /> : null}
            {googleEnabled ? <GoogleButton title="Continue with Google" onPress={handleGoogle} loading={busy === 'google'} disabled={busy !== null} /> : null}
            <OrDivider />
          </>
        ) : null}

        <AuthField
          icon={<MailIcon />}
          placeholder="Your full name"
          accessibilityLabel="Your full name"
          value={fullName}
          onChangeText={setFullName}
          maxLength={100}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
        />
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
          autoComplete="password-new"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleSignup}
          trailing={reveal ? <EyeIcon /> : <EyeOffIcon />}
          trailingLabel={reveal ? 'Hide password' : 'Show password'}
          onTrailingPress={() => setReveal((value) => !value)}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}
        {sentTo ? (
          <Pressable accessibilityRole="button" onPress={() => void resend()} disabled={busy !== null}>
            <Text style={styles.footerLink}>{busy === 'resend' ? 'Sending…' : 'Send the confirmation email again'}</Text>
          </Pressable>
        ) : null}

        <GoldButton
          title="Create account"
          onPress={handleSignup}
          loading={busy === 'password'}
          disabled={
            busy !== null || !fullName.trim() || !email.trim() || !password
          }
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/login" asChild>
            <Pressable accessibilityRole="link">
              <Text style={styles.footerLink}>Log in</Text>
            </Pressable>
          </Link>
        </View>
      </AuthCard>
    </AuthBackdrop>
  );
}

const styles = StyleSheet.create({
  error: { color: AccentColors.error, fontSize: 13, lineHeight: 19 },
  info: { color: AccentColors.primaryLight, fontSize: 13, lineHeight: 19 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  footerText: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 14 },
  footerLink: {
    color: AccentColors.primaryLight,
    fontSize: 14,
    fontWeight: '600',
  },
});
