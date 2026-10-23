import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { DeleteAccountPanel } from '@/components/delete-account-panel';
import {
  AlertIcon,
  BuildingIcon,
  ChevronRightIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  HelpIcon,
  KeyIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  ShieldIcon,
  SunIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
  type IconProps,
} from '@/components/icons';
import { ModalSheet } from '@/components/modal-sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import {
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  Field,
  InlineAlert,
  ProgressBar,
  SectionHeader,
  StatusBadge,
  showToast,
  transition,
  useBreakpoint,
} from '@/components/ui';
import { PageMaxWidth, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { getAIUsage, type AIUsage } from '@/lib/ai-usage';
import {
  getAppearancePreference,
  setAppearancePreference,
  subscribeAppearance,
  type AppearancePreference,
} from '@/lib/appearance';
import { authErrorMessage } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { openWhatsAppSupport, SUPPORT_PHONE } from '@/lib/support';

// Settings is one scrolling page of cards; the list on the left jumps between
// them. Only settings Synq can actually store are shown — there is no
// notification, language or accent-colour backend, so those are left out
// rather than drawn as switches that do nothing. Account deletion is kept in a
// separate danger zone at the very end, away from routine profile controls.

type SectionKey = 'profile' | 'workspace' | 'security' | 'appearance' | 'billing' | 'help' | 'danger';

const SECTIONS: { key: SectionKey; label: string; icon: ComponentType<IconProps> }[] = [
  { key: 'profile', label: 'Profile', icon: UserIcon },
  { key: 'workspace', label: 'Workspace & Company', icon: BuildingIcon },
  { key: 'security', label: 'Security & Privacy', icon: ShieldIcon },
  { key: 'appearance', label: 'Appearance', icon: PaletteIcon },
  { key: 'billing', label: 'Plan & Credits', icon: CreditCardIcon },
  { key: 'help', label: 'Help & About', icon: HelpIcon },
  { key: 'danger', label: 'Delete account', icon: TrashIcon },
];

const THEMES: { value: AppearancePreference; label: string; icon: ComponentType<IconProps> }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
];

const MIN_PASSWORD = 6;
const NAME_MAX = 100;
const BUSINESS_MAX = 120;

/** A row in a settings list: icon, label, optional detail, chevron. */
function ActionRow({
  icon: Icon,
  label,
  detail,
  onPress,
  tone = 'default',
  divider = true,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  detail?: ReactNode;
  onPress: () => void;
  tone?: 'default' | 'danger';
  divider?: boolean;
}) {
  const theme = useTheme();
  const color = tone === 'danger' ? theme.danger : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.actionRow,
        transition,
        divider && { borderBottomWidth: 1, borderBottomColor: theme.border },
        (hovered || pressed) && { backgroundColor: theme.surfaceRaised },
      ]}
    >
      <Icon size={18} color={tone === 'danger' ? theme.danger : theme.textSecondary} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
      {detail}
      <ChevronRightIcon size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const { width } = useBreakpoint();
  const { session } = useSession();
  const { identity, refresh: refreshWorkspace } = useWorkspace();
  const params = useLocalSearchParams<{ section?: string }>();
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearancePreference, getAppearancePreference);

  // Room for the section list beside the cards, then for two card columns.
  const sideNav = width >= 1100;
  const twoColumns = width >= 1400;

  const scrollRef = useRef<ScrollView>(null);
  // Card positions are measured inside their column; these two lift them into
  // the scroll view's coordinates.
  const bodyY = useRef(0);
  const contentY = useRef(0);
  const sectionY = useRef<Partial<Record<SectionKey, number>>>({});
  const [active, setActive] = useState<SectionKey>('profile');

  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [savedProfile, setSavedProfile] = useState({ name: '', business: '' });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [usageError, setUsageError] = useState('');

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [signOutAllOpen, setSignOutAllOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);

  const userId = session?.user.id;
  const email = session?.user.email ?? '';
  const provider = String(session?.user.app_metadata?.provider ?? 'email');
  const membership = identity?.membership ?? null;
  const owner = membership?.role === 'owner';

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void supabase
      .from('profiles')
      .select('full_name,business_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setProfileError('Could not load your profile. Refresh the page to try again.');
        const loaded = { name: data?.full_name ?? identity?.full_name ?? '', business: data?.business_name ?? '' };
        setName(loaded.name);
        setBusinessName(loaded.business);
        setSavedProfile(loaded);
        setProfileLoaded(true);
      });
    return () => {
      live = false;
    };
    // Load once per account; later identity changes come from this screen's own save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    let live = true;
    getAIUsage()
      .then((next) => {
        if (live) setUsage(next);
      })
      .catch((cause: unknown) => {
        if (live) setUsageError(cause instanceof Error ? cause.message : 'Could not load your credits.');
      });
    return () => {
      live = false;
    };
  }, []);

  const jump = (key: SectionKey) => {
    setActive(key);
    const y = sectionY.current[key];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, bodyY.current + contentY.current + y - 16), animated: true });
  };

  // `/settings?section=security` (from the account menu or a link) opens at that card.
  const requested = SECTIONS.find((section) => section.key === params.section)?.key;
  const jumped = useRef(false);
  function onCardLayout(key: SectionKey, event: LayoutChangeEvent) {
    sectionY.current[key] = event.nativeEvent.layout.y;
    if (requested === key && !jumped.current) {
      jumped.current = true;
      setTimeout(() => jump(key), 0);
    }
  }

  const nameError = !name.trim() ? 'Enter your name.' : name.trim().length > NAME_MAX ? `Use ${NAME_MAX} characters or fewer.` : null;
  const profileDirty = name.trim() !== savedProfile.name.trim() || businessName.trim() !== savedProfile.business.trim();

  async function saveProfile() {
    if (!userId || nameError || businessName.trim().length > BUSINESS_MAX) return;
    setProfileBusy(true);
    setProfileError('');
    const next = { name: name.trim(), business: businessName.trim() };
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, full_name: next.name, business_name: next.business || null }, { onConflict: 'id' });
    setProfileBusy(false);
    if (error) {
      setProfileError('Could not save your profile. Please try again.');
      return;
    }
    setSavedProfile(next);
    showToast('Profile saved.');
    void refreshWorkspace();
  }

  async function chooseTheme(next: AppearancePreference) {
    if (next === appearance) return;
    const saved = await setAppearancePreference(next);
    if (!saved) showToast('Theme changed for now, but this device could not remember it.', 'info');
  }

  function closePassword() {
    if (passwordBusy) return;
    setPasswordOpen(false);
    setPassword('');
    setConfirmPassword('');
    setPasswordError('');
  }

  async function changePassword() {
    if (password.length < MIN_PASSWORD) {
      setPasswordError(`Use a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('The two passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    setPasswordError('');
    const { error } = await supabase.auth.updateUser({ password });
    setPasswordBusy(false);
    if (error) {
      setPasswordError(authErrorMessage(error));
      return;
    }
    setPasswordOpen(false);
    setPassword('');
    setConfirmPassword('');
    showToast('Password updated.');
  }

  async function signOutEverywhere() {
    setSignOutBusy(true);
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    setSignOutBusy(false);
    if (error) {
      setSignOutAllOpen(false);
      showToast('Could not sign out of your other devices. Please try again.', 'danger');
    }
    // On success the session listener sends this device to the sign-in screen.
  }

  async function sendFailureAlert() {
    setAlertBusy(true);
    const { error } = await supabase.functions.invoke('request-ceo-alert', { body: {} });
    setAlertBusy(false);
    showToast(error ? 'Could not send the alert. Please try again later.' : 'Thanks — the Synq team has been alerted.', error ? 'danger' : 'success');
  }

  const contactSupport = async () => {
    if (!(await openWhatsAppSupport())) showToast('Your device could not open WhatsApp.', 'danger');
  };

  // ---------------------------------------------------------------- cards

  const profileCard = (
    <View key="profile" onLayout={(event) => onCardLayout('profile', event)}>
      <Card>
        <SectionHeader title="Profile" subtitle="Your name as your team sees it." />
        <View style={styles.identity}>
          <Avatar name={name || email || 'You'} size={64} />
          <View style={styles.identityText}>
            <ThemedText type="sectionTitle" numberOfLines={1}>
              {savedProfile.name || 'Add your name'}
            </ThemedText>
            {membership ? <StatusBadge label={owner ? 'Owner' : 'Member'} tone={owner ? 'accent' : 'neutral'} /> : null}
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {email}
            </ThemedText>
          </View>
        </View>
        <Field label="Full name" required error={profileLoaded && name !== savedProfile.name ? nameError : null} count={{ value: name.length, max: NAME_MAX }}>
          <TextField accessibilityLabel="Full name" value={name} onChangeText={setName} maxLength={NAME_MAX} editable={profileLoaded} autoComplete="name" />
        </Field>
        <Field label="Email address" helper="Your sign-in email. It cannot be changed here.">
          <TextField accessibilityLabel="Email address" value={email} editable={false} style={{ backgroundColor: theme.surfaceRaised, color: theme.textSecondary }} />
        </Field>
        <Field label="Business name" helper="Optional. Shown to the AI so it can tailor its suggestions." count={{ value: businessName.length, max: BUSINESS_MAX }}>
          <TextField accessibilityLabel="Business name" value={businessName} onChangeText={setBusinessName} maxLength={BUSINESS_MAX} editable={profileLoaded} placeholder="e.g. Kaapi House" />
        </Field>
        {profileError ? <InlineAlert tone="danger" message={profileError} /> : null}
        <View style={styles.cardFooter}>
          {profileDirty ? (
            <Button
              label="Discard"
              variant="ghost"
              onPress={() => {
                setName(savedProfile.name);
                setBusinessName(savedProfile.business);
              }}
            />
          ) : null}
          <Button label="Save changes" variant="primary" loading={profileBusy} disabled={!profileDirty || !!nameError || profileBusy} onPress={() => void saveProfile()} />
        </View>
      </Card>
    </View>
  );

  const workspaceCard = (
    <View key="workspace" onLayout={(event) => onCardLayout('workspace', event)}>
      <Card>
        <SectionHeader title="Workspace & Company" subtitle="The company you work in on Synq." />
        {membership ? (
          <>
            <View style={styles.identity}>
              <View style={[styles.logoTile, { backgroundColor: '#111210' }]}>
                <BuildingIcon size={26} color="#FFD45A" />
              </View>
              <View style={styles.identityText}>
                <ThemedText type="sectionTitle" numberOfLines={1}>
                  {membership.company_name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {owner ? 'You own this workspace' : membership.status === 'active' ? 'You are a member' : 'Your request to join is waiting for approval'}
                </ThemedText>
              </View>
            </View>
            <View style={[styles.list, { borderColor: theme.border }]}>
              <ActionRow icon={BuildingIcon} label="Open company workspace" onPress={() => router.push('/company')} />
              <ActionRow
                icon={UsersIcon}
                label={owner ? 'Manage team & join requests' : 'See your team'}
                detail={owner && membership.pending_count > 0 ? <StatusBadge label={`${membership.pending_count} waiting`} tone="warning" /> : undefined}
                onPress={() => router.push('/company?tab=team' as Parameters<typeof router.push>[0])}
                divider={false}
              />
            </View>
          </>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              You are working on your own. Create a company workspace, or ask to join your company&apos;s, to share leads and chat with your team.
            </ThemedText>
            <View style={styles.cardFooter}>
              <Button label="Set up a company workspace" variant="primary" icon={BuildingIcon} onPress={() => router.push('/workspace-setup')} />
            </View>
          </>
        )}
      </Card>
    </View>
  );

  const securityCard = (
    <View key="security" onLayout={(event) => onCardLayout('security', event)}>
      <Card>
        <SectionHeader title="Security & Privacy" subtitle="Keep your account secure." />
        <View style={[styles.list, { borderColor: theme.border }]}>
          <ActionRow
            icon={KeyIcon}
            label={provider === 'email' ? 'Change password' : 'Set a password'}
            detail={provider !== 'email' ? <StatusBadge label={`Signed in with ${provider[0].toUpperCase()}${provider.slice(1)}`} dot={false} /> : undefined}
            onPress={() => setPasswordOpen(true)}
          />
          <ActionRow icon={LogOutIcon} label="Sign out of this device" onPress={() => void supabase.auth.signOut()} />
          <ActionRow icon={ShieldIcon} label="Sign out of all devices" onPress={() => setSignOutAllOpen(true)} />
          <ActionRow icon={ExternalLinkIcon} label="Privacy policy" onPress={() => router.push('/privacy')} divider={false} />
        </View>
      </Card>
    </View>
  );

  const appearanceCard = (
    <View key="appearance" onLayout={(event) => onCardLayout('appearance', event)}>
      <Card>
        <SectionHeader title="Appearance" subtitle="Choose how Synq looks for you. Saved on this device." />
        <View style={styles.themes} accessibilityRole="radiogroup" accessibilityLabel="Theme">
          {THEMES.map((option) => {
            const selected = appearance === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${option.label} theme`}
                onPress={() => void chooseTheme(option.value)}
                style={({ hovered }) => [
                  styles.themeOption,
                  transition,
                  {
                    borderColor: selected ? theme.accent : theme.border,
                    borderWidth: selected ? 2 : 1,
                    backgroundColor: selected ? theme.accentSoft : hovered ? theme.surfaceRaised : theme.surface,
                  },
                ]}
              >
                <option.icon size={20} color={selected ? theme.accentText : theme.textSecondary} />
                <Text style={[styles.themeLabel, { color: selected ? theme.text : theme.textSecondary, fontWeight: selected ? '700' : '500' }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <ThemedText type="caption" themeColor="textSecondary">
          System follows your device&apos;s light or dark setting. The sidebar stays dark in every theme.
        </ThemedText>
      </Card>
    </View>
  );

  const remainingShare = usage && usage.limit > 0 ? usage.remaining / usage.limit : 0;
  const billingCard = (
    <View key="billing" onLayout={(event) => onCardLayout('billing', event)}>
      <Card>
        <SectionHeader title="Plan & Credits" subtitle="Your plan and today's AI credits." />
        <View style={styles.planRow}>
          <View style={styles.identityText}>
            <ThemedText type="cardTitle">Free plan</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Paid plans are not available yet.
            </ThemedText>
          </View>
          <Button label="See plans" onPress={() => router.push('/upgrade')} />
        </View>
        {usageError ? (
          <InlineAlert tone="warning" message={usageError} />
        ) : usage ? (
          <View style={styles.usage}>
            <View style={styles.usageHead}>
              <ThemedText type="small">AI credits left today</ThemedText>
              <ThemedText type="smallBold">
                {usage.remaining} / {usage.limit}
              </ThemedText>
            </View>
            <ProgressBar value={remainingShare} label="AI credits remaining" />
            <ThemedText type="caption" themeColor="textSecondary">
              A chat message costs {usage.chat_cost} credit, an image {usage.image_cost}.
              {usage.resets_at ? ` Resets ${new Date(usage.resets_at).toLocaleString()}.` : ' Your 24-hour window starts with your next AI request.'}
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="caption" themeColor="textSecondary">
            Loading your credits…
          </ThemedText>
        )}
      </Card>
    </View>
  );

  const helpCard = (
    <View key="help" onLayout={(event) => onCardLayout('help', event)}>
      <Card>
        <SectionHeader title="Help & About" subtitle="Get help, or tell us when something breaks." />
        <View style={[styles.list, { borderColor: theme.border }]}>
          <ActionRow icon={HelpIcon} label={`Chat with support on WhatsApp · ${SUPPORT_PHONE}`} onPress={() => void contactSupport()} />
          <ActionRow icon={AlertIcon} label={alertBusy ? 'Sending alert…' : 'Report a problem to the Synq team'} onPress={() => void (alertBusy ? undefined : sendFailureAlert())} />
          <ActionRow icon={ExternalLinkIcon} label="Privacy policy" onPress={() => router.push('/privacy')} divider={false} />
        </View>
        <ThemedText type="caption" themeColor="textSecondary">
          Synq AI · your AI workforce for business
        </ThemedText>
      </Card>
    </View>
  );

  const dangerCard = (
    <View key="danger" onLayout={(event) => onCardLayout('danger', event)}>
      <Card tone="danger">
        <SectionHeader title="Delete account" subtitle="Permanently remove your account and everything in it." />
        <DeleteAccountPanel />
      </Card>
    </View>
  );

  const columns = twoColumns
    ? [
        [profileCard, securityCard, helpCard],
        [workspaceCard, appearanceCard, billingCard],
      ]
    : [[profileCard, workspaceCard, securityCard, appearanceCard, billingCard, helpCard]];

  const nav = (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Settings sections"
      style={sideNav ? [styles.sideNav, { backgroundColor: theme.surface, borderColor: theme.border }] : styles.chipNav}
    >
      {SECTIONS.map((section) => {
        const selected = active === section.key;
        const danger = section.key === 'danger';
        return (
          <Pressable
            key={section.key}
            accessibilityRole="tab"
            accessibilityLabel={section.label}
            accessibilityState={{ selected }}
            onPress={() => jump(section.key)}
            style={({ hovered }) => [
              sideNav ? styles.navItem : styles.chip,
              transition,
              !sideNav && { borderColor: selected ? theme.accentBorder : theme.border },
              { backgroundColor: selected ? theme.accentSoft : hovered ? theme.surfaceRaised : sideNav ? 'transparent' : theme.surface },
              sideNav && danger && styles.navDanger,
              sideNav && danger && { borderTopColor: theme.border },
            ]}
          >
            <section.icon size={18} color={danger ? theme.danger : selected ? theme.accentText : theme.textSecondary} />
            <Text style={[styles.navLabel, { color: danger ? theme.danger : theme.text, fontWeight: selected ? '700' : '500' }]}>{section.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <>
      <ScrollView ref={scrollRef} style={styles.fill} contentContainerStyle={[styles.page, { padding: width < 640 ? Spacing.three : 28 }]}>
        <View style={styles.header}>
          <ThemedText type="pageTitle" accessibilityRole="header">
            Settings
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Manage your account, workspace and preferences.
          </ThemedText>
        </View>

        <View
          style={[styles.body, sideNav && styles.bodyRow]}
          onLayout={(event) => {
            bodyY.current = event.nativeEvent.layout.y;
          }}
        >
          {sideNav ? <View style={styles.navColumn}>{nav}</View> : nav}
          <View
            style={styles.content}
            onLayout={(event) => {
              contentY.current = event.nativeEvent.layout.y;
            }}
          >
            <View style={styles.columns}>
              {columns.map((column, index) => (
                <View key={index} style={styles.column}>
                  {column}
                </View>
              ))}
            </View>
            {dangerCard}
          </View>
        </View>
      </ScrollView>

      <ModalSheet
        visible={passwordOpen}
        onClose={closePassword}
        title={provider === 'email' ? 'Change password' : 'Set a password'}
        description={provider === 'email' ? 'Choose a new password for signing in with your email.' : `You can keep signing in with ${provider}; a password adds email sign-in as well.`}
      >
        <Field label="New password" helper={`At least ${MIN_PASSWORD} characters.`}>
          <TextField accessibilityLabel="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password-new" textContentType="newPassword" />
        </Field>
        <Field label="Confirm new password">
          <TextField
            accessibilityLabel="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="password-new"
            onSubmitEditing={() => void changePassword()}
          />
        </Field>
        {passwordError ? <InlineAlert tone="danger" message={passwordError} /> : null}
        <View style={styles.cardFooter}>
          <Button label="Cancel" variant="ghost" onPress={closePassword} disabled={passwordBusy} />
          <Button label="Update password" variant="primary" loading={passwordBusy} disabled={!password || !confirmPassword || passwordBusy} onPress={() => void changePassword()} />
        </View>
      </ModalSheet>

      <ConfirmDialog
        visible={signOutAllOpen}
        title="Sign out of all devices?"
        description="Every phone and browser signed in to your account, including this one, will need to sign in again."
        confirmLabel="Sign out everywhere"
        busy={signOutBusy}
        onConfirm={() => void signOutEverywhere()}
        onClose={() => setSignOutAllOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { width: '100%', maxWidth: PageMaxWidth, alignSelf: 'center', gap: Spacing.four },
  header: { gap: 4 },
  body: { gap: Spacing.three },
  bodyRow: { flexDirection: 'row', alignItems: 'flex-start' },
  navColumn: { width: 248 },
  sideNav: { padding: 8, borderWidth: 1, borderRadius: Radius.card, gap: 2 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: Radius.control },
  navDanger: { marginTop: 6, borderTopWidth: 1, borderTopLeftRadius: 0, borderTopRightRadius: 0, paddingTop: 13 },
  chipNav: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1 },
  navLabel: { fontSize: 14 },
  content: { flex: 1, minWidth: 0, gap: Spacing.three },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  column: { flex: 1, minWidth: 0, gap: Spacing.three },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  identityText: { flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' },
  logoTile: { width: 64, height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  list: { borderWidth: 1, borderRadius: Radius.control + 2, overflow: 'hidden' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 48 },
  actionLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  themes: { flexDirection: 'row', gap: 10 },
  themeOption: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: Radius.control + 2 },
  themeLabel: { fontSize: 13 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  usage: { gap: 8 },
  usageHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
