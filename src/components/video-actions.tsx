import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ModalSheet } from '@/components/modal-sheet';
import { PostVideo } from '@/components/post-video';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  checkVideo,
  listVideos,
  playbackUrl,
  startVideo,
  VideoError,
  type GeneratedVideo,
} from '@/lib/videos';

// The video half of a marketing chat.
//
// Free for the person using the app: the workspace's server key pays Google, so
// no price is shown here. It is still never one tap. Every take is billed to the
// workspace from the first second, and a model that mishears the concept still
// charges for it, so the button opens the prompt for editing and waits for a
// second, deliberate press.
//
// "Request changes" is not a separate feature: you keep talking to the chat,
// and the next generation picks up the newer concept. Regenerate reuses a
// prompt verbatim, which is the other thing people actually want.

const POLL_INTERVAL_MS = 10_000;
const DURATIONS = [4, 6, 8];

function VideoPlayer({ video }: { video: GeneratedVideo }) {
  const theme = useTheme();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    playbackUrl(video).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [video]);

  if (!url) {
    return (
      <ThemedText type="caption" themeColor="textSecondary">
        Loading the video…
      </ThemedText>
    );
  }

  // React Native has no video primitive and expo-av is not installed, so on web
  // this is a real <video> element and on a phone it is a link out.
  if (Platform.OS !== 'web') {
    return (
      <ThemedText type="caption" style={{ color: AccentColors.primary }}>
        Open Synq on a computer to play this.
      </ThemedText>
    );
  }

  return createElement('video', {
    src: url,
    controls: true,
    playsInline: true,
    style: {
      width: '100%',
      maxWidth: video.aspect_ratio === '9:16' ? 260 : '100%',
      borderRadius: Radius.control,
      backgroundColor: theme.background,
      display: 'block',
    },
  });
}

function VideoCard({
  video,
  onRegenerate,
}: {
  video: GeneratedVideo;
  onRegenerate: (prompt: string) => void;
}) {
  const theme = useTheme();
  const working = video.status === 'pending' || video.status === 'generating';

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
        {video.prompt}
      </ThemedText>

      {working ? (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={AccentColors.primary} />
          <ThemedText type="caption" themeColor="textSecondary">
            Filming. This usually takes a couple of minutes.
          </ThemedText>
        </View>
      ) : video.status === 'failed' ? (
        <>
          <ThemedText type="caption" style={{ color: AccentColors.error }}>
            {video.error ?? 'That did not work.'}
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={() => onRegenerate(video.prompt)}>
            <ThemedText type="caption" style={{ color: AccentColors.primary }}>
              Try again
            </ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <VideoPlayer video={video} />
          <Pressable accessibilityRole="button" onPress={() => onRegenerate(video.prompt)}>
            <ThemedText type="caption" style={{ color: AccentColors.primary }}>
              Make another take
            </ThemedText>
          </Pressable>
          <PostVideo video={video} />
        </>
      )}
    </View>
  );
}

export function VideoActions({
  conversationId,
  suggestedPrompt,
}: {
  /** Null until the thread exists — there is nothing to attach a video to yet. */
  conversationId?: string;
  /** The latest thing the agent said, used as the opening draft of the concept. */
  suggestedPrompt?: string;
}) {
  const theme = useTheme();
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(4);
  const [vertical, setVertical] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    try {
      setVideos(await listVideos(conversationId));
    } catch {
      // A listing failure should not stop the chat working.
    }
  }, [conversationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Generation happens on Google's side, so the only way to learn it finished is
  // to ask. Polls only while something is actually in flight.
  const pending = videos.filter((v) => v.status === 'pending' || v.status === 'generating');
  const pendingIds = pending.map((v) => v.id).join(',');
  const pollingRef = useRef(false);

  useEffect(() => {
    if (!pendingIds) return;
    const ids = pendingIds.split(',');

    const tick = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const results = await Promise.all(
          ids.map((id) => checkVideo(id).catch(() => null))
        );
        const updated = results.filter(Boolean).map((r) => r!.video);
        if (updated.length > 0) {
          setVideos((current) =>
            current.map((video) => updated.find((u) => u.id === video.id) ?? video)
          );
        }
      } finally {
        pollingRef.current = false;
      }
    };

    const timer = setInterval(tick, POLL_INTERVAL_MS);
    tick();
    return () => clearInterval(timer);
  }, [pendingIds]);

  function openFor(text: string) {
    setPrompt(text);
    setError(null);
    setOpen(true);
  }

  async function confirm() {
    if (!conversationId || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { video } = await startVideo({
        conversationId,
        prompt: prompt.trim(),
        aspectRatio: vertical ? '9:16' : '16:9',
        durationSeconds: duration,
      });
      setVideos((current) => [...current, video]);
      setOpen(false);
    } catch (e) {
      setError(e instanceof VideoError ? e.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  const canGenerate = Boolean(conversationId && suggestedPrompt);

  return (
    <>
      {videos.length > 0 ? (
        <View style={styles.list}>
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} onRegenerate={openFor} />
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canGenerate }}
        disabled={!canGenerate}
        onPress={() => openFor(suggestedPrompt ?? '')}
        style={({ hovered }) => [
          styles.generate,
          {
            borderColor: canGenerate ? AccentColors.primary : theme.border,
            backgroundColor: hovered && canGenerate ? theme.surfaceRaised : 'transparent',
          },
        ]}
      >
        <ThemedText
          type="caption"
          style={{ color: canGenerate ? AccentColors.primary : theme.textSecondary }}
        >
          {canGenerate
            ? '✦ Generate video from this'
            : 'Agree on an idea first, then you can film it'}
        </ThemedText>
      </Pressable>

      <ModalSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Generate video"
        description="Check the concept before filming. You can change it and make another take any time."
      >
        <TextField
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder="Describe the shot, the mood, and what is on screen."
          style={styles.promptInput}
        />

        <View style={styles.optionRow}>
          <ThemedText type="caption" themeColor="textSecondary">
            LENGTH
          </ThemedText>
          <View style={styles.chips}>
            {DURATIONS.map((seconds) => {
              const active = seconds === duration;
              return (
                <Pressable
                  key={seconds}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setDuration(seconds)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? AccentColors.primary : 'transparent',
                      borderColor: active ? AccentColors.primary : theme.border,
                    },
                  ]}
                >
                  <ThemedText type="caption" style={{ color: active ? '#0d0d0d' : theme.text }}>
                    {seconds}s
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.optionRow}>
          <ThemedText type="caption" themeColor="textSecondary">
            SHAPE
          </ThemedText>
          <View style={styles.chips}>
            {[
              { label: 'Reel (9:16)', value: true },
              { label: 'Wide (16:9)', value: false },
            ].map((option) => {
              const active = option.value === vertical;
              return (
                <Pressable
                  key={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setVertical(option.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? AccentColors.primary : 'transparent',
                      borderColor: active ? AccentColors.primary : theme.border,
                    },
                  ]}
                >
                  <ThemedText type="caption" style={{ color: active ? '#0d0d0d' : theme.text }}>
                    {option.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error ? (
          <ThemedText type="caption" style={{ color: AccentColors.error }}>
            {error}
          </ThemedText>
        ) : null}

        <PrimaryButton
          title={busy ? 'Sending…' : 'Film it'}
          onPress={confirm}
          disabled={busy || prompt.trim().length === 0}
        />
      </ModalSheet>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two, paddingBottom: Spacing.two },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.control,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  generate: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderWidth: 1,
    borderRadius: Radius.pill,
  },
  promptInput: { minHeight: 120, textAlignVertical: 'top' },
  optionRow: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
});
