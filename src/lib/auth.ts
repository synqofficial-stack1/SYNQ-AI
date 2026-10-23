import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Everything the sign-in screens need that is not a plain email and password.
//
// Google sign-in takes two different roads. On the web the browser leaves for
// Google and comes back to the same address, where supabase-js reads the
// session out of the URL. On a phone there is nowhere to "come back" to, so the
// login opens in a system browser sheet and hands the tokens back through a
// deep link, which is why this file has to read them out by hand.

/**
 * Supabase's own wording, except where it is jargon. Anything not listed is
 * passed through: a real message from the server beats a vague one from us.
 */
export function authErrorMessage(
  error: { message?: string } | null | undefined,
  fallback = 'That did not go through. Try again.'
): string {
  const message = error?.message?.trim();
  if (!message) return fallback;

  if (/provider is not enabled|Unsupported provider/i.test(message)) {
    return 'This sign-in option is not enabled for this project yet.';
  }
  if (/Invalid login credentials/i.test(message)) {
    return 'That email and password do not match an account.';
  }
  if (/Email not confirmed/i.test(message)) {
    return 'This account is not enabled for sign-in yet. Contact the app administrator.';
  }
  if (/User already registered/i.test(message)) {
    return 'There is already an account with that email. Log in instead.';
  }
  if (/Password should be at least/i.test(message)) {
    return 'Use a password of at least 6 characters.';
  }
  if (/rate limit|too many requests/i.test(message)) {
    return 'Too many tries. Wait a minute and try again.';
  }
  if (/fetch|network/i.test(message)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return message;
}

/**
 * Native Sign in with Apple. Apple receives the SHA-256 nonce; Supabase gets
 * the raw nonce and verifies it against the signed identity token.
 * Returns false when the person closes Apple's sheet without signing in.
 */
export async function signInWithApple(): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    throw new Error('Sign in with Apple is available in the iOS app.');
  }

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_REQUEST_CANCELED'
    ) {
      return false;
    }
    throw error;
  }

  if (!credential.identityToken) {
    throw new Error('Apple did not return a sign-in token. Try again.');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw new Error(authErrorMessage(error));

  // Apple sends the name only on the first consent. Preserve it in Auth
  // metadata so the existing profile trigger and workspace setup can use it.
  const fullName = [
    credential.fullName?.givenName,
    credential.fullName?.middleName,
    credential.fullName?.familyName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (fullName) {
    const { error: profileError } = await supabase.auth.updateUser({
      data: { full_name: fullName },
    });
    if (profileError) {
      throw new Error(
        'Signed in with Apple, but your name did not save. Add it in workspace setup.',
      );
    }
  }

  return true;
}

/** Where Supabase should send the browser back to once it is done. */
function returnAddress(path: string): string {
  if (Platform.OS === 'web') return new URL(path, window.location.origin).toString();
  return Linking.createURL(path);
}

/**
 * Whether the Google provider is switched on for this project.
 *
 * `signInWithOAuth` builds the Google URL locally and navigates straight to it
 * — it never asks the server first, so a disabled provider does not come back
 * as an error we can phrase nicely. It comes back as a page of raw JSON, in the
 * browser or inside the sign-in sheet. One cheap read of the public settings
 * endpoint turns that into a sentence.
 *
 * It fails open on purpose: if the check itself cannot run, the sign-in goes
 * ahead and the real flow reports whatever actually happens. A diagnostic must
 * never be the thing that blocks a working login.
 */
export async function googleSignInIsEnabled(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return true;

  try {
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } });
    if (!response.ok) return true;
    const settings = (await response.json()) as { external?: Record<string, boolean> };
    return settings.external?.google !== false;
  } catch {
    return true;
  }
}

/** Auth data arrives in the query string or the fragment, depending on the flow. */
function paramsOf(url: string): Record<string, string> {
  const result: Record<string, string> = {};
  const [beforeHash, afterHash] = url.split('#');
  for (const part of [beforeHash.split('?')[1], afterHash]) {
    if (!part) continue;
    for (const [key, value] of new URLSearchParams(part)) result[key] = value;
  }
  return result;
}

/**
 * Sends the user to Google. On web this never returns — the page navigates —
 * so callers should leave their spinner running.
 */
export async function signInWithGoogle(): Promise<void> {
  const redirectTo = returnAddress('/');

  if (!(await googleSignInIsEnabled())) {
    throw new Error(authErrorMessage({ message: 'provider is not enabled' }));
  }

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw new Error(authErrorMessage(error));
    return;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw new Error(authErrorMessage(error));
  if (!data?.url) throw new Error('Google sign-in did not start. Try again.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  // Closing the sheet is a choice, not a failure: leave the screen as it was.
  if (result.type !== 'success') return;

  const params = paramsOf(result.url);
  if (params.error_description) throw new Error(params.error_description);

  if (params.code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
    if (exchangeError) throw new Error(authErrorMessage(exchangeError));
    return;
  }

  if (params.access_token && params.refresh_token) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (sessionError) throw new Error(authErrorMessage(sessionError));
    return;
  }

  throw new Error('Google sent us back without a session. Try again.');
}

/** Emails a link that opens the app on the reset-password screen. */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: returnAddress('/reset-password'),
  });
  if (error) throw new Error(authErrorMessage(error));
}
