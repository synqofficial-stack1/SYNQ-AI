import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AssignWork,
  CollaborationError,
  TaskList,
  TeamChat,
  useCompanyCollaboration,
} from '@/components/company-collaboration';
import { BuildingIcon, CrownIcon, GearIcon, InfoIcon, ShieldIcon, TrashIcon, UserPlusIcon, UsersIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import {
  Avatar,
  Button,
  ButtonRow,
  Card,
  ConfirmDialog,
  EmptyState,
  IconTile,
  InlineAlert,
  LinkButton,
  ListRow,
  Page,
  PageHeader,
  SectionHeader,
  SkeletonList,
  Split,
  StatusBadge,
  Tabs,
  showToast,
} from '@/components/ui';
import { DataColors, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { organizationPeople, reviewOrganizationMember, type OrganizationPerson } from '@/lib/organization';

type Tab = 'overview' | 'team' | 'tasks';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'team', label: 'Team' },
  { key: 'tasks', label: 'Tasks' },
];

export default function CompanyScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = params.tab === 'team' || params.tab === 'tasks' ? params.tab : 'overview';
  const { identity, refresh } = useWorkspace();
  const team = useCompanyCollaboration();
  const owner = identity?.membership?.role === 'owner';
  const companyName = identity?.membership?.company_name || 'Your company';
  const [people, setPeople] = useState<OrganizationPerson[] | null>(null);
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

  async function decide(person: OrganizationPerson, decision: 'approve' | 'reject' | 'remove') {
    setBusy(person.user_id);
    setError('');
    try {
      await reviewOrganizationMember(person.user_id, decision);
      setRemove(null);
      await Promise.all([load(), refresh()]);
      showToast(
        decision === 'approve'
          ? `${person.name || person.email} can now access the company workspace.`
          : decision === 'reject'
            ? 'Request declined.'
            : 'Company access removed.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const pending = (people ?? []).filter((p) => p.status === 'pending');
  const active = (people ?? []).filter((p) => p.status === 'active');
  const memberCount = owner ? active.length : team.members.length;
  const setTab = (next: Tab) => router.setParams({ tab: next === 'overview' ? undefined : next });

  const profile = (
    <Card>
      <View style={styles.profileHead}>
        <View style={[styles.logo, { backgroundColor: '#171717' }]}>
          <BuildingIcon size={30} color="#FFD45A" />
        </View>
        <View style={styles.profileText}>
          <ThemedText type="sectionTitle" numberOfLines={2}>
            {companyName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Company workspace · You are {owner ? 'the owner' : 'an approved team member'}
          </ThemedText>
        </View>
      </View>
      <View style={styles.facts}>
        {[
          { label: 'Your role', value: owner ? 'Owner' : 'Member', icon: owner ? CrownIcon : UsersIcon, color: DataColors.sales },
          { label: 'Team members', value: team.loaded || people ? String(memberCount) : '—', icon: UsersIcon, color: DataColors.company },
          ...(owner ? [{ label: 'Join requests', value: people ? String(pending.length) : '—', icon: UserPlusIcon, color: DataColors.marketing }] : []),
        ].map((fact) => (
          <View key={fact.label} style={[styles.fact, { borderColor: theme.border }]}>
            <IconTile icon={fact.icon} color={fact.color} size={36} />
            <View>
              <ThemedText type="caption" themeColor="textSecondary">
                {fact.label}
              </ThemedText>
              <ThemedText type="cardTitle">{fact.value}</ThemedText>
            </View>
          </View>
        ))}
      </View>
      <View style={[styles.note, { backgroundColor: theme.surfaceRaised }]}>
        <InfoIcon size={16} color={theme.textSecondary} />
        <ThemedText type="caption" themeColor="textSecondary" style={styles.noteText}>
          Approved teammates share Sales work, replies and reports. Personal Gmail connections and AI chats stay private. The workspace record stores the company name only.
        </ThemedText>
      </View>
    </Card>
  );

  const memberRows = owner ? (
    people === null ? (
      <SkeletonList rows={2} />
    ) : (
      <View>
        {active.map((person, index) => (
          <ListRow
            key={person.user_id}
            title={person.name || person.email}
            subtitle={person.email}
            leading={<Avatar name={person.name || person.email} size={38} tone={person.role === 'owner' ? 'accent' : 'neutral'} />}
            trailing={
              <View style={styles.memberActions}>
                <StatusBadge label={person.role === 'owner' ? 'Owner' : 'Member'} tone={person.role === 'owner' ? 'accent' : 'neutral'} dot={false} />
                {person.role !== 'owner' ? (
                  <Button label="Remove" size="sm" variant="dangerOutline" disabled={!!busy} onPress={() => setRemove(person)} accessibilityLabel={`Remove ${person.name || person.email} from the company`} />
                ) : null}
              </View>
            }
            divider={index < active.length - 1}
          />
        ))}
      </View>
    )
  ) : !team.loaded ? (
    <SkeletonList rows={2} />
  ) : team.members.length ? (
    <View>
      {team.members.map((person, index) => (
        <ListRow
          key={person.user_id}
          title={`${person.display_name}${person.is_current_user ? ' (you)' : ''}`}
          leading={<Avatar name={person.display_name} size={38} tone="neutral" />}
          divider={index < team.members.length - 1}
        />
      ))}
    </View>
  ) : (
    <EmptyState icon={UsersIcon} title="No teammates yet" compact />
  );

  const teamCard = (limit?: number) => (
    <Card>
      <SectionHeader
        title="Team"
        subtitle={owner ? 'Manage who can access this company.' : 'People in this company workspace.'}
        action={limit && tab === 'overview' ? <LinkButton label="Manage" onPress={() => setTab('team')} /> : undefined}
      />
      {memberRows}
      <ThemedText type="caption" themeColor="textSecondary">
        Teammates join by choosing “{companyName}” when they set up Synq. {owner ? 'You approve each request below.' : 'Your company owner approves each request.'}
      </ThemedText>
    </Card>
  );

  const joinRequests = owner ? (
    <Card>
      <SectionHeader
        title="Join requests"
        subtitle={people ? `${pending.length} pending ${pending.length === 1 ? 'request' : 'requests'}` : 'Checking…'}
        action={<Button label="Refresh" size="sm" variant="ghost" onPress={() => void load()} />}
      />
      {people === null ? (
        <SkeletonList rows={1} />
      ) : !pending.length ? (
        <EmptyState icon={UserPlusIcon} title="No requests right now" description="When someone asks to join, they'll appear here." compact />
      ) : (
        <View style={styles.requests}>
          {pending.map((person) => (
            <View key={person.user_id} style={[styles.request, { borderColor: theme.border }]}>
              <View style={styles.requestHead}>
                <Avatar name={person.name || person.email} size={38} tone="neutral" />
                <View style={styles.requestText}>
                  <ThemedText type="smallBold">{person.name || 'Name not provided'}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {person.email} · requested {new Date(person.requested_at).toLocaleString()}
                  </ThemedText>
                </View>
              </View>
              <ThemedText type="caption" themeColor="textSecondary">
                Approving grants access to shared company work and adds their existing leads and sales follow-ups to it.
              </ThemedText>
              <ButtonRow>
                <Button label="Approve" variant="primary" size="sm" disabled={!!busy} loading={busy === person.user_id} onPress={() => void decide(person, 'approve')} />
                <Button label="Decline" size="sm" disabled={!!busy} onPress={() => void decide(person, 'reject')} />
              </ButtonRow>
            </View>
          ))}
        </View>
      )}
    </Card>
  ) : null;

  const controls = (
    <Card>
      <SectionHeader title="Workspace controls" subtitle="Settings that apply to your account in this workspace." />
      <View>
        <ListRow title="Profile & workspace settings" leading={<GearIcon size={18} color={theme.textSecondary} />} onPress={() => router.push('/settings')} />
        <ListRow title="Data & privacy" leading={<ShieldIcon size={18} color={theme.textSecondary} />} onPress={() => router.push('/privacy')} />
        <ListRow
          title="Delete account"
          leading={<TrashIcon size={18} color={theme.danger} />}
          onPress={() => router.push('/settings?section=account' as Parameters<typeof router.push>[0])}
          danger
          divider={false}
        />
      </View>
    </Card>
  );

  return (
    <Page>
      <PageHeader title="Company" description="Manage your company workspace, team, chat and assigned work." />
      <Tabs label="Company sections" items={TABS} value={tab} onChange={setTab} />
      {error ? <InlineAlert tone="danger" message={error} /> : null}
      <CollaborationError team={team} />

      {tab === 'overview' ? (
        <>
          <Split ratio={1.4} main={profile} side={joinRequests ?? controls} />
          <Split ratio={1} main={teamCard(5)} side={<TeamChat team={team} />} />
          <Split ratio={1} main={<AssignWork team={team} />} side={<TaskList team={team} limit={4} />} />
          {joinRequests ? controls : null}
        </>
      ) : null}

      {tab === 'team' ? <Split ratio={1.3} main={teamCard()} side={joinRequests ?? controls} /> : null}

      {tab === 'tasks' ? <Split ratio={1} main={<AssignWork team={team} />} side={<TaskList team={team} />} /> : null}

      <ConfirmDialog
        visible={!!remove}
        onClose={() => setRemove(null)}
        title="Remove company access?"
        description={`${remove?.name || remove?.email || 'This person'} will lose access to shared leads, replies and reports. Their active company sales follow-ups will pause. Existing company records are kept.`}
        confirmLabel="Remove access"
        busy={!!busy}
        onConfirm={() => remove && void decide(remove, 'remove')}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  logo: { width: 64, height: 64, borderRadius: Radius.card - 2, alignItems: 'center', justifyContent: 'center' },
  profileText: { flex: 1, gap: 2 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fact: {
    flexGrow: 1,
    flexBasis: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: Radius.control + 2,
  },
  note: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: Radius.control },
  noteText: { flex: 1 },
  memberActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  requests: { gap: 12 },
  request: { gap: 10, padding: 14, borderWidth: 1, borderRadius: Radius.control + 2 },
  requestHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  requestText: { flex: 1, gap: 2 },
});
