import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ChatPanel } from '@/components/chat-panel';
import { MarketingTabs } from '@/components/marketing-tabs';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createContentItem, listContent, updateContentItem } from '@/lib/marketing';
import {
  CONTENT_STATUS_LABELS,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  MARKETING_CHANNELS,
  type ContentItem,
  type ContentType,
} from '@/types/database';

export default function ContentScreen() {
  const theme = useTheme();

  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<ContentType>('social_post');
  const [channel, setChannel] = useState<string>('LinkedIn');
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    listContent()
      .then(setItems)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  async function handleSave(reply: string) {
    setSaveError(null);
    try {
      await createContentItem({
        title: title.trim() || `${CONTENT_TYPE_LABELS[contentType]} for ${channel}`,
        body: reply,
        contentType,
        channel,
        status: 'draft',
      });
      setTitle('');
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save that.');
    }
  }

  async function approve(item: ContentItem) {
    await updateContentItem(item.id, { status: 'approved' });
    load();
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Content</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Brainstorm with Marketing AI, then save what you like as a draft.
        </ThemedText>
      </View>

      <MarketingTabs />

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          FORMAT
        </ThemedText>
        <View style={styles.chipRow}>
          {CONTENT_TYPES.map((type) => {
            const active = type === contentType;
            return (
              <Pressable
                key={type}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setContentType(type)}
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
                  {CONTENT_TYPE_LABELS[type]}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ThemedText type="caption" themeColor="textSecondary">
          CHANNEL
        </ThemedText>
        <View style={styles.chipRow}>
          {MARKETING_CHANNELS.map((name) => {
            const active = name === channel;
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setChannel(name)}
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
                  {name}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ThemedText type="caption" themeColor="textSecondary">
          TITLE (OPTIONAL)
        </ThemedText>
        <TextField placeholder="Named automatically if left blank" value={title} onChangeText={setTitle} />
      </View>

      <ChatPanel
        kind="content"
        context={{ content_type: contentType, channel }}
        placeholder="Ask for a draft, then refine it…"
        emptyHint={`Ask for a ${CONTENT_TYPE_LABELS[contentType].toLowerCase()} for ${channel}, then keep talking — "shorter", "less salesy", "give me three openers" — until it's right.`}
        suggestions={[
          `Write a ${CONTENT_TYPE_LABELS[contentType].toLowerCase()} for ${channel}`,
          'Give me 10 content ideas',
          'Repurpose this for other channels',
        ]}
        saveLabel="Save as draft"
        onSaveReply={handleSave}
        height={400}
      />

      {saveError ? (
        <ThemedText type="small" style={{ color: AccentColors.error }}>
          {saveError}
        </ThemedText>
      ) : null}

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ThemedText type="sectionTitle">Your content</ThemedText>
        {failed ? (
          <>
            <ThemedText type="small">Something went wrong loading your content.</ThemedText>
            <Pressable accessibilityRole="button" onPress={load}>
              <ThemedText type="small" style={{ color: AccentColors.primary }}>
                Try again
              </ThemedText>
            </Pressable>
          </>
        ) : items === null ? (
          <ThemedText type="small" themeColor="textSecondary">
            Loading…
          </ThemedText>
        ) : items.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No content yet. Ask above for a draft and save the one you like.
          </ThemedText>
        ) : (
          items.map((item) => (
            <View key={item.id} style={[styles.row, { borderColor: theme.border }]}>
              <View style={styles.rowMain}>
                <ThemedText type="small">{item.title}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {CONTENT_TYPE_LABELS[item.content_type] ?? item.content_type}
                  {item.channel ? ` · ${item.channel}` : ''}
                </ThemedText>
                {item.body ? (
                  <ThemedText type="caption" themeColor="textSecondary" numberOfLines={3}>
                    {item.body}
                  </ThemedText>
                ) : null}
              </View>
              <View style={styles.rowSide}>
                <View style={[styles.badge, { borderColor: theme.borderStrong }]}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {CONTENT_STATUS_LABELS[item.status]}
                  </ThemedText>
                </View>
                {item.status === 'draft' ? (
                  <Pressable accessibilityRole="button" onPress={() => approve(item)}>
                    <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                      Approve
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))
        )}
        <ThemedText type="caption" themeColor="textSecondary" style={styles.footnote}>
          Approving marks it ready inside Synq. Nothing is published — no social or email channel
          is connected.
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
  card: { gap: Spacing.two, padding: Spacing.four, borderRadius: Radius.card, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
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
  footnote: { paddingTop: Spacing.two },
});
