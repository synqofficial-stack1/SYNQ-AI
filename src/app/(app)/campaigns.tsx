import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ChatPanel } from '@/components/chat-panel';
import { MarketingTabs } from '@/components/marketing-tabs';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createCampaign, listCampaigns, updateCampaign } from '@/lib/marketing';
import {
  CAMPAIGN_STATUS_LABELS,
  MARKETING_CHANNELS,
  type Campaign,
  type CampaignStatus,
} from '@/types/database';

const STATUS_COLOR: Record<CampaignStatus, string> = {
  draft: '#b0b0b0',
  planning: AccentColors.warning,
  active: AccentColors.success,
  paused: AccentColors.warning,
  completed: '#b0b0b0',
};

export default function CampaignsScreen() {
  const theme = useTheme();

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [failed, setFailed] = useState(false);

  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [audience, setAudience] = useState('');
  const [channels, setChannels] = useState<string[]>([]);
  const [plan, setPlan] = useState('');

  const [seed, setSeed] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    listCampaigns()
      .then(setCampaigns)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  const resetForm = () => {
    setName('');
    setGoal('');
    setAudience('');
    setChannels([]);
    setPlan('');
    setSeed(undefined);
    setError(null);
  };

  const toggleChannel = (channel: string) =>
    setChannels((current) =>
      current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel]
    );

  function startPlanning() {
    if (!goal.trim()) {
      setError('Describe the goal first — that is what the plan is built from.');
      return;
    }
    setError(null);
    setSeed(
      [
        'Plan this campaign.',
        '',
        `Goal: ${goal.trim()}`,
        audience.trim() ? `Audience: ${audience.trim()}` : '',
        channels.length ? `Preferred channels: ${channels.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError('Give the campaign a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Always created as a draft. Launching is a separate, deliberate act —
      // the AI drafts the plan, a person decides it goes live.
      await createCampaign({ name, goal, audience, channels, plan, status: 'draft' });
      resetForm();
      setComposing(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that campaign.');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(campaign: Campaign, status: CampaignStatus) {
    await updateCampaign(campaign.id, { status });
    load();
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Campaigns</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Describe a goal and Marketing AI drafts the plan. You edit it and decide when it runs.
        </ThemedText>
      </View>

      <MarketingTabs />

      {composing ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="sectionTitle">New campaign</ThemedText>

          <ThemedText type="caption" themeColor="textSecondary">
            NAME
          </ThemedText>
          <TextField placeholder="Q4 Product Launch" value={name} onChangeText={setName} />

          <ThemedText type="caption" themeColor="textSecondary">
            GOAL
          </ThemedText>
          <TextField
            placeholder="Generate 500 qualified leads for our new product."
            value={goal}
            onChangeText={setGoal}
            multiline
            style={styles.multiline}
          />

          <ThemedText type="caption" themeColor="textSecondary">
            AUDIENCE (OPTIONAL)
          </ThemedText>
          <TextField
            placeholder="Small business owners in India"
            value={audience}
            onChangeText={setAudience}
          />

          <ThemedText type="caption" themeColor="textSecondary">
            CHANNELS
          </ThemedText>
          <View style={styles.chipRow}>
            {MARKETING_CHANNELS.map((channel) => {
              const active = channels.includes(channel);
              return (
                <Pressable
                  key={channel}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => toggleChannel(channel)}
                  style={({ hovered }) => [
                    styles.chip,
                    {
                      backgroundColor: active
                        ? AccentColors.primary
                        : hovered
                          ? theme.surfaceRaised
                          : 'transparent',
                      borderColor: active ? AccentColors.primary : theme.border,
                    },
                  ]}
                >
                  <ThemedText type="caption" style={{ color: active ? '#0d0d0d' : theme.text }}>
                    {channel}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {seed ? (
            <ChatPanel
              kind="campaign"
              placeholder="Push back — different channels, tighter timeline, another angle…"
              seedMessage={seed}
              saveLabel="Use this as the plan"
              onSaveReply={(reply) => setPlan(reply)}
              height={420}
              resume={false}
            />
          ) : (
            <PrimaryButton title="Plan it with AI" onPress={startPlanning} />
          )}

          {plan ? (
            <>
              <ThemedText type="caption" themeColor="textSecondary">
                PLAN — EDIT FREELY BEFORE SAVING
              </ThemedText>
              <TextField
                value={plan}
                onChangeText={setPlan}
                multiline
                style={styles.planInput}
              />
            </>
          ) : null}

          {error ? (
            <ThemedText type="small" style={{ color: AccentColors.error }}>
              {error}
            </ThemedText>
          ) : null}

          <PrimaryButton
            title={saving ? 'Saving…' : 'Save as draft'}
            onPress={handleCreate}
            loading={saving}
            disabled={saving}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setComposing(false);
              resetForm();
            }}
            style={styles.tertiary}
          >
            <ThemedText type="caption" themeColor="textSecondary">
              Cancel
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <PrimaryButton title="+ Create campaign with AI" onPress={() => setComposing(true)} />
      )}

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {failed ? (
          <>
            <ThemedText type="small">Something went wrong loading campaigns.</ThemedText>
            <Pressable accessibilityRole="button" onPress={load}>
              <ThemedText type="small" style={{ color: AccentColors.primary }}>
                Try again
              </ThemedText>
            </Pressable>
          </>
        ) : campaigns === null ? (
          <ThemedText type="small" themeColor="textSecondary">
            Loading…
          </ThemedText>
        ) : campaigns.length === 0 ? (
          <>
            <ThemedText type="sectionTitle">No campaigns yet</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Create your first campaign — a one-line goal is enough to get a full plan back.
            </ThemedText>
          </>
        ) : (
          campaigns.map((campaign) => (
            <View key={campaign.id} style={[styles.row, { borderColor: theme.border }]}>
              <View style={styles.rowMain}>
                <ThemedText type="small">{campaign.name}</ThemedText>
                {campaign.goal ? (
                  <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
                    {campaign.goal}
                  </ThemedText>
                ) : null}
                {campaign.channels.length > 0 ? (
                  <ThemedText type="caption" themeColor="textSecondary">
                    {campaign.channels.join(' · ')}
                  </ThemedText>
                ) : null}
                {campaign.plan ? (
                  <ThemedText type="caption" themeColor="textSecondary" numberOfLines={3}>
                    {campaign.plan}
                  </ThemedText>
                ) : null}
              </View>

              <View style={styles.rowSide}>
                <View style={[styles.badge, { borderColor: STATUS_COLOR[campaign.status] }]}>
                  <ThemedText type="caption" style={{ color: STATUS_COLOR[campaign.status] }}>
                    {CAMPAIGN_STATUS_LABELS[campaign.status]}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setStatus(campaign, campaign.status === 'active' ? 'paused' : 'active')
                  }
                >
                  <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                    {campaign.status === 'active' ? 'Pause' : 'Activate'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          Activating a campaign marks it live inside Synq. It does not publish anything — no
          social, email or ad channel is connected yet.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    padding: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: { gap: Spacing.one },
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.card,
    borderWidth: 1,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  planInput: { minHeight: 240, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  tertiary: { alignSelf: 'center', paddingVertical: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
  },
  rowMain: { flex: 1, gap: 2 },
  rowSide: { alignItems: 'flex-end', gap: Spacing.two },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
