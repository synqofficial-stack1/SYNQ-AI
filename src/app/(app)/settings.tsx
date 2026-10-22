import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Appearance, Linking, Pressable, ScrollView, View } from 'react-native';

import { DeleteAccountPanel } from '@/components/delete-account-panel';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { supabase } from '@/lib/supabase';

type ThemePreference = 'system' | 'light' | 'dark';
const THEME_KEY = 'synq-appearance';

export default function SettingsScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const { identity } = useWorkspace();
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [appearance, setAppearance] = useState<ThemePreference>('system');
  const [busy, setBusy] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (session?.user.id) {
      void supabase.from('profiles').select('full_name,business_name').eq('id', session.user.id).maybeSingle()
        .then(({ data, error: loadError }) => {
          if (!active) return;
          if (loadError) setError('Could not load your profile settings.');
          else {
            setName(data?.full_name ?? identity?.full_name ?? '');
            setBusinessName(data?.business_name ?? '');
          }
        });
    }
    void AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (!active) return;
      const choice = saved === 'light' || saved === 'dark' ? saved : 'system';
      setAppearance(choice);
      Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
    }).catch(() => {});
    return () => { active = false; };
  }, [identity?.full_name, session?.user.id]);

  async function save() {
    if (!session?.user.id) return;
    if (!name.trim() || name.trim().length > 100 || businessName.trim().length > 120) {
      setError('Enter a name (up to 100 characters) and a business name up to 120 characters.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    const { error: saveError } = await supabase.from('profiles').upsert({
      id: session.user.id,
      full_name: name.trim(),
      business_name: businessName.trim() || null,
    }, { onConflict: 'id' });
    setBusy(false);
    if (saveError) setError('Could not save your profile settings. Please try again.');
    else setMessage('Profile settings saved.');
  }

  async function chooseAppearance(choice: ThemePreference) {
    setAppearance(choice);
    Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
    try { await AsyncStorage.setItem(THEME_KEY, choice); }
    catch { setMessage('Theme changed for this session but could not be saved on this device.'); }
  }

  async function alertCEO() {
    setAlertBusy(true); setError(''); setMessage('');
    const { error: alertError } = await supabase.functions.invoke('request-ceo-alert', { body: {} });
    setAlertBusy(false);
    if (alertError) setError('Could not notify the CEO. Try again later.');
    else setMessage('Failure alert sent to the CEO Control Center.');
  }

  const card = { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: Radius.card, padding: 20, gap: 14 } as const;
  const muted = { color: theme.textSecondary } as const;
  const themeChoices: ThemePreference[] = ['light', 'dark', 'system'];

  return <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 860, alignSelf: 'center', padding: 24, gap: 16 }}>
    <ThemedText type="pageTitle">Settings</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">Manage your account, workspace, privacy, notifications, and app preferences.</ThemedText>

    <View style={card}>
      <ThemedText type="sectionTitle">1. Account &amp; Profile</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">Profile photo and account email</ThemedText>
      <ThemedText type="small">{session?.user.email ?? '—'}</ThemedText>
      <TextField accessibilityLabel="Your name" placeholder="Your name" value={name} onChangeText={setName} maxLength={100} />
      <TextField accessibilityLabel="Business name" placeholder="Business name (optional)" value={businessName} onChangeText={setBusinessName} maxLength={120} />
      <PrimaryButton title="Save profile" loading={busy} disabled={busy} onPress={() => void save()} />
      <ThemedText type="caption" themeColor="textSecondary">Language, timezone, date format, and profile picture are not available yet.</ThemedText>
    </View>

    <View style={card}>
      <ThemedText type="sectionTitle">2. Workspace &amp; Company</ThemedText>
      <ThemedText type="small">Workspace: {identity?.membership?.company_name || businessName || 'No company workspace selected'}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">Company profile, team members, invitations, and roles</ThemedText>
      <PrimaryButton title="Open workspace" onPress={() => router.push('/company')} />
      <ThemedText type="caption" themeColor="textSecondary">Company logo, industry, website, description, and workspace switching are not available yet.</ThemedText>
    </View>

    <View style={card}>
      <ThemedText type="sectionTitle">3. Security &amp; Privacy</ThemedText>
      <ThemedText type="small">Signed in with {session?.user.app_metadata?.provider || 'email'} · {session?.user.email || '—'}</ThemedText>
      <PrimaryButton title="Reset password by email" onPress={() => router.push('/(auth)/forgot-password')} />
      <ThemedText type="caption" themeColor="textSecondary">Two-factor authentication, active sessions, signing out other devices, provider management, and data export are not available yet.</ThemedText>
    </View>

    <View style={card}>
      <ThemedText type="sectionTitle">4. Notifications</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">Email, in-app, and push preferences for tasks, AI failures, leads, meetings, publishing, and weekly summaries.</ThemedText>
      <ThemedText type="small" style={muted}>Notification preferences are not available yet.</ThemedText>
    </View>

    <View style={card}>
      <ThemedText type="sectionTitle">5. Appearance &amp; Accessibility</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">Choose a theme for the app.</ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {themeChoices.map((choice) => <Pressable key={choice} accessibilityRole="button" accessibilityState={{ selected: appearance === choice }} onPress={() => void chooseAppearance(choice)} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radius.control, borderWidth: 1, borderColor: appearance === choice ? AccentColors.primary : theme.border, backgroundColor: appearance === choice ? 'rgba(232,197,71,0.14)' : theme.surfaceRaised }}><ThemedText type="smallBold" style={{ color: appearance === choice ? AccentColors.primaryLight : theme.text }}>{choice[0].toUpperCase() + choice.slice(1)}</ThemedText></Pressable>)}
      </View>
    </View>

    <View style={card}>
      <ThemedText type="sectionTitle">6. App Defaults</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">Send a failure alert to the CEO Control Center when something needs attention.</ThemedText>
      <PrimaryButton title="Send failure alert to CEO" loading={alertBusy} disabled={alertBusy} onPress={() => void alertCEO()} />
    </View>

    <View style={card}>
      <ThemedText type="sectionTitle">7. Help &amp; About</ThemedText>
      <ThemedText type="small">SYNQ AI</ThemedText>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('tel:6300840955')}><ThemedText type="linkPrimary">Contact support · 6300840955</ThemedText></Pressable>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('tel:6300840955')}><ThemedText type="linkPrimary">Report a bug</ThemedText></Pressable>
      <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')}><ThemedText type="linkPrimary">Privacy policy</ThemedText></Pressable>
    </View>

    <View style={[card, { borderColor: AccentColors.error }]}>
      <ThemedText type="sectionTitle">8. Delete account</ThemedText>
      <DeleteAccountPanel />
    </View>

    {error ? <ThemedText accessibilityRole="alert" style={{ color: AccentColors.error }}>{error}</ThemedText> : null}
    {message ? <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: AccentColors.success }}>{message}</ThemedText> : null}
  </ScrollView>;
}
