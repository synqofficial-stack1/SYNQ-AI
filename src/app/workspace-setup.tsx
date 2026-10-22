import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTheme } from '@/hooks/use-theme';
import { setupWorkspace } from '@/lib/organization';
import { supabase } from '@/lib/supabase';

function SetupForm({
  initialName,
  initialCompany,
  onSaved,
}: {
  initialName: string;
  initialCompany: string;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const { refresh } = useWorkspace();
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState(initialCompany);
  const [owner, setOwner] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await setupWorkspace(name, company, owner);
      await refresh();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <ThemedText type="pageTitle">Let’s set up your workspace</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Tell us your name and the company you work with.
      </ThemedText>
      <ThemedText type="smallBold">Your full name</ThemedText>
      <TextField
        accessibilityLabel="Your full name"
        placeholder="e.g. Yaswant Moduguru"
        value={name}
        onChangeText={setName}
        maxLength={100}
        autoComplete="name"
        autoCapitalize="words"
      />
      <ThemedText type="smallBold">Company / organization</ThemedText>
      <TextField
        accessibilityLabel="Company name"
        placeholder="Your company name"
        value={company}
        onChangeText={setCompany}
        maxLength={120}
        autoCapitalize="words"
      />
      <ThemedText type="smallBold">What’s your role?</ThemedText>
      {[
        {
          value: true,
          title: 'I’m the owner',
          detail:
            'Create a company workspace. If this name already exists, request approval from its current owner.',
        },
        {
          value: false,
          title: 'I’m joining the team',
          detail:
            'Your company’s owner must approve you before you can enter its workspace.',
        },
      ].map((option) => (
        <Pressable
          key={option.title}
          accessibilityRole="radio"
          accessibilityState={{ checked: owner === option.value }}
          onPress={() => setOwner(option.value)}
          style={{
            borderWidth: 1,
            borderColor:
              owner === option.value ? AccentColors.primary : theme.border,
            padding: 18,
            borderRadius: 12,
            gap: 5,
          }}
        >
          <ThemedText type="smallBold">
            {owner === option.value ? '◉' : '○'} {option.title}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {option.detail}
          </ThemedText>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agree }}
        onPress={() => setAgree((v) => !v)}
        style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
      >
        <ThemedText style={{ color: AccentColors.primary }}>
          {agree ? '☑' : '☐'}
        </ThemedText>
        <ThemedText type="caption" style={{ flex: 1 }}>
          I understand that approved company members share Sales work, replies,
          and reports. My existing leads and sales follow-ups will join this
          workspace once I’m approved. Personal Gmail connections and AI chats
          stay private.
        </ThemedText>
      </Pressable>
      {!!error && (
        <ThemedText
          accessibilityRole="alert"
          style={{ color: AccentColors.error }}
        >
          {error}
        </ThemedText>
      )}
      <PrimaryButton
        title={
          owner
            ? 'Create workspace / request approval'
            : 'Request to join company'
        }
        loading={busy}
        disabled={!name.trim() || company.trim().length < 2 || !agree}
        onPress={submit}
      />
    </View>
  );
}
export default function WorkspaceSetupScreen() {
  const theme = useTheme();
  const { session, isLoading } = useSession();
  const { identity, loading, error, refresh } = useWorkspace();
  const [edit, setEdit] = useState(false);
  if (!isLoading && !session) return <Redirect href="/(auth)/login" />;
  if (loading)
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator color={AccentColors.primary} />
      </View>
    );
  if (identity?.membership?.status === 'active' && identity.full_name)
    return <Redirect href="/(app)" />;
  const pending = identity?.membership?.status === 'pending' && !edit;
  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        backgroundColor: theme.background,
        padding: 24,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 680,
          padding: 28,
          gap: 20,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 20,
          backgroundColor: theme.surface,
        }}
      >
        {error ? (
          <>
            <ThemedText type="sectionTitle">
              Could not load company setup
            </ThemedText>
            <ThemedText type="small">{error}</ThemedText>
            <PrimaryButton title="Try again" onPress={() => refresh()} />
          </>
        ) : pending ? (
          <>
            <ThemedText type="pageTitle">
              Your request is with the owner
            </ThemedText>
            <ThemedText type="small">
              Hi {identity?.full_name}. Your request to join{' '}
              {identity?.membership?.company_name} is pending approval. You’ll
              enter the shared workspace after the owner approves it.
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              This page checks for approval automatically. You don’t have access
              to the company’s work yet.
            </ThemedText>
            <PrimaryButton
              title="Check approval status"
              onPress={() => refresh()}
            />
            <Pressable accessibilityRole="button" onPress={() => setEdit(true)}>
              <ThemedText type="linkPrimary">
                Change name or company request
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            {identity?.membership && (
              <ThemedText type="small" style={{ color: AccentColors.error }}>
                Your previous request was {identity.membership.status}. You can
                submit a new request below.
              </ThemedText>
            )}
            <SetupForm
              onSaved={() => setEdit(false)}
              initialName={
                identity?.full_name ||
                String(
                  session?.user.user_metadata?.full_name ||
                    session?.user.user_metadata?.name ||
                    '',
                )
              }
              initialCompany={identity?.membership?.company_name || ''}
            />
          </>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => supabase.auth.signOut()}
        >
          <ThemedText type="caption" themeColor="textSecondary">
            Sign out
          </ThemedText>
        </Pressable>
      </View>
    </ScrollView>
  );
}
