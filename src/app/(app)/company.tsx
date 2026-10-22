import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ModalSheet } from '@/components/modal-sheet';
import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { AccentColors } from '@/constants/theme';
import { CompanyCollaboration } from '@/components/company-collaboration';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTheme } from '@/hooks/use-theme';
import {
  organizationPeople,
  reviewOrganizationMember,
  type OrganizationPerson,
} from '@/lib/organization';

export default function CompanyScreen() {
  const theme = useTheme();
  const { identity, refresh } = useWorkspace();
  const owner = identity?.membership?.role === 'owner';
  const [people, setPeople] = useState<OrganizationPerson[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [remove, setRemove] = useState<OrganizationPerson | null>(null);
  const load = useCallback(async () => {
    if (!owner) return;
    try {
      setPeople(await organizationPeople());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [owner]);
  useEffect(() => {
    Promise.resolve().then(load);
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [load]);
  async function decide(
    person: OrganizationPerson,
    decision: 'approve' | 'reject' | 'remove',
  ) {
    setBusy(person.user_id);
    setError('');
    try {
      await reviewOrganizationMember(person.user_id, decision);
      setRemove(null);
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const pending = people.filter((p) => p.status === 'pending');
  const active = people.filter((p) => p.status === 'active');
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 28,
        gap: 24,
        maxWidth: 1100,
        width: '100%',
        alignSelf: 'center',
        paddingBottom: 60,
      }}
    >
      <ThemedText type="pageTitle">
        {identity?.membership?.company_name}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Company workspace · You are{' '}
        {owner ? 'the owner' : 'an approved team member'}.
      </ThemedText>
      <View style={{ padding: 20, gap: 8, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
        <ThemedText type="sectionTitle">Company details</ThemedText>
        <ThemedText type="smallBold">Company name</ThemedText>
        <ThemedText type="small">{identity?.membership?.company_name || '—'}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">The current workspace record stores the company name only. No owner visibility controls are shown for private or unsupported fields.</ThemedText>
      </View>
      <View
        style={{
          padding: 22,
          gap: 10,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
        }}
      >
        <ThemedText type="sectionTitle">
          Welcome to the team! Work together, support one another, and help each other succeed.
        </ThemedText>
        <ThemedText type="small">
          Approved teammates can collaborate on shared Sales work, replies, and
          reports. Personal Gmail connections and AI chats remain private.
        </ThemedText>
      </View>
      <CompanyCollaboration />
      {!!error && (
        <ThemedText
          accessibilityRole="alert"
          style={{ color: AccentColors.error }}
        >
          {error}
        </ThemedText>
      )}
      {owner ? (
        <>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <ThemedText type="sectionTitle">
              Join requests · {pending.length}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={load}>
              <ThemedText type="linkPrimary">Refresh</ThemedText>
            </Pressable>
          </View>
          {!pending.length && (
            <ThemedText type="small" themeColor="textSecondary">
              No requests awaiting your approval.
            </ThemedText>
          )}
          {pending.map((person) => (
            <View
              key={person.user_id}
              style={{
                padding: 20,
                gap: 12,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 14,
                backgroundColor: theme.surface,
              }}
            >
              <ThemedText type="smallBold">
                {person.name || 'Name not provided'}
              </ThemedText>
              <ThemedText type="small">{person.email}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                Requested {new Date(person.requested_at).toLocaleString()}.
                Approving grants access to the shared company work and adds
                their existing leads and sales follow-ups to it.
              </ThemedText>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    title="Approve"
                    disabled={!!busy}
                    loading={busy === person.user_id}
                    onPress={() => decide(person, 'approve')}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!!busy}
                  onPress={() => decide(person, 'reject')}
                  style={{ padding: 14 }}
                >
                  <ThemedText type="smallBold">Reject</ThemedText>
                </Pressable>
              </View>
            </View>
          ))}
          <ThemedText type="sectionTitle">
            Approved team · {active.length}
          </ThemedText>
          {active.map((person) => (
            <View
              key={person.user_id}
              style={{
                padding: 18,
                gap: 6,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 12,
              }}
            >
              <ThemedText type="smallBold">
                {person.name || person.email} · {person.role}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {person.email}
              </ThemedText>
              {person.role !== 'owner' && (
                <Pressable
                  accessibilityRole="button"
                  disabled={!!busy}
                  onPress={() => setRemove(person)}
                >
                  <ThemedText
                    type="caption"
                    style={{ color: AccentColors.error }}
                  >
                    Remove company access
                  </ThemedText>
                </Pressable>
              )}
            </View>
          ))}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Your company owner manages join requests and team access.
        </ThemedText>
      )}
      <ModalSheet
        visible={!!remove}
        onClose={() => setRemove(null)}
        title="Remove company access?"
        description={`${remove?.name || remove?.email || 'This person'} will lose access to shared leads, replies, and reports. Their active company sales follow-ups will pause. Existing company records are retained.`}
      >
        <PrimaryButton
          title="Remove access"
          loading={!!busy}
          onPress={() => remove && decide(remove, 'remove')}
        />
      </ModalSheet>
    </ScrollView>
  );
}
