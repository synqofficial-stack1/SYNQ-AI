import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

import { ModalSheet } from '@/components/modal-sheet';
import { PostVideo } from '@/components/post-video';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  checkVideo,
  downloadVideo,
  estimateCost,
  listVideos,
  playbackUrl,
  startVideo,
  VideoError,
  type GeneratedVideo,
} from '@/lib/videos';

// The video half of a marketing chat.
//
// Generation is never one tap. Every run is billed from the first second with
// no free tier, and a model that mishears the concept still charges for the
// take — so the button opens the prompt for editing, states the cost, and waits
// for a second, deliberate press.
//
// "Request changes" is not a separate feature: you keep talking to the chat,
// and the next generation picks up the newer concept. Regenerate reuses a
// prompt verbatim, which is the other thing people actually want.

const POLL_INTERVAL_MS = 10_000;
const DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

function VideoPlayer({ video }: { video: GeneratedVideo }) {
  const theme = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer(null);
  const storagePath = video.storage_path;

  useEffect(() => {
    let cancelled = false;
    playbackUrl(storagePath)
      .then((signed) => {
        if (cancelled) return;
        if (signed) setUrl(signed);
        else setError('Could not load the private video preview.');
      })
      .catch(() => { if (!cancelled) setError('Could not load the private video preview.'); });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  useEffect(() => {
    if (url) player.replaceAsync(url).catch(() => setError('This video could not be played on this device.'));
  }, [player, url]);

  if (error) return <ThemedText type="caption" style={{ color: AccentColors.error }}>{error}</ThemedText>;
  if (!url) {
    return (
      <ThemedText type="caption" themeColor="textSecondary">
        Loading the video…
      </ThemedText>
    );
  }

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      style={{
        width: '100%',
        maxWidth: video.aspect_ratio === '9:16' ? 320 : '100%',
        aspectRatio: video.aspect_ratio === '9:16' ? 9 / 16 : 16 / 9,
        borderRadius: Radius.control,
        backgroundColor: theme.background,
      }}
    />
  );
}

function VideoCard({
  video,
  onRegenerate,
}: {
  video: GeneratedVideo;
  onRegenerate: (video: GeneratedVideo) => void;
}) {
  const theme = useTheme();
  const working = video.status === 'pending' || video.status === 'generating';
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function saveVideo() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadVideo(video);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Could not download this video.');
    } finally {
      setDownloading(false);
    }
  }

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
          <Pressable accessibilityRole="button" onPress={() => onRegenerate(video)}>
            <ThemedText type="caption" themeColor="accentText">
              Edit prompt and try again
            </ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <VideoPlayer video={video} />
          <ThemedText type="caption" themeColor="textSecondary">
            {video.aspect_ratio} · {video.duration_seconds}s · {video.resolution} · Audio included
          </ThemedText>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" onPress={() => onRegenerate(video)}>
              <ThemedText type="caption" themeColor="accentText">
                Edit prompt / make another take
              </ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={saveVideo} disabled={downloading}>
              <ThemedText type="caption" style={{ color: downloading ? theme.textSecondary : AccentColors.primary }}>
                {downloading ? 'Preparing…' : 'Download / save video'}
              </ThemedText>
            </Pressable>
          </View>
          {downloadError ? <ThemedText type="caption" style={{ color: AccentColors.error }}>{downloadError}</ThemedText> : null}
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
  const resolution = '720p' as const;
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
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  // The provider runs this as a durable queue job; poll only while it is active.
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

  function openFor(text: string, previous?: GeneratedVideo) {
    setPrompt(previous?.prompt ?? text);
    setDuration(previous?.duration_seconds ?? 4);
    setVertical((previous?.aspect_ratio ?? '9:16') === '9:16');
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
        resolution,
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
            <VideoCard
              key={video.id}
              video={video}
              onRegenerate={(previous) => openFor(previous.prompt, previous)}
            />
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
        description="Check the concept before filming. Each take is billed by the second and cannot be undone."
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
                  onPress={() => {
                    setDuration(seconds);
                  }}
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

        <View style={styles.optionRow}>
          <ThemedText type="caption" themeColor="textSecondary">RESOLUTION</ThemedText>
          <View style={styles.chips}>
            <View
              style={[styles.chip, { backgroundColor: AccentColors.primary, borderColor: AccentColors.primary }]}
            >
              <ThemedText type="caption" style={{ color: '#0d0d0d' }}>720p · Seedance limit</ThemedText>
            </View>
          </View>
        </View>

        <ThemedText type="caption" themeColor="textSecondary">
          {duration}s at {resolution}: estimated {estimateCost(duration, resolution)} including fal video and token charges. Seedance generates audio;
          describe speech, sound effects, or ambience in your prompt. fal.ai usage is billed per generation.
        </ThemedText>

        {error ? (
          <ThemedText type="caption" style={{ color: AccentColors.error }}>
            {error}
          </ThemedText>
        ) : null}

        <PrimaryButton
          title={busy ? 'Sending…' : `Film it (${estimateCost(duration, resolution)})`}
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
