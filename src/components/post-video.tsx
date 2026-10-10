import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ModalSheet } from '@/components/modal-sheet';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  CAPTION_LIMITS,
  checkPost,
  connectPlatform,
  listPosts,
  loadConnections,
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  SocialError,
  startPost,
  type Connection,
  type SocialPlatform,
  type SocialPost,
} from '@/lib/social';
import type { GeneratedVideo } from '@/lib/videos';

// Posting a finished video to a real account.
//
// The sheet is the confirmation. Nothing goes out until the user has picked a
// platform, seen which account it will post as, written or accepted the
// caption, and pressed Post. A login popup only appears if that platform is not
// connected yet, and only from a press, which is also what browsers require
// before they will open one.

const POLL_INTERVAL_MS = 5000;

const GLYPH: Record<SocialPlatform, string> = { youtube: '▶', instagram: 'IG', x: '𝕏', linkedin: 'in' };

function statusLine(post: SocialPost): string {
  const label = SOCIAL_LABELS[post.platform];
  if (post.status === 'posted') return `Posted to ${label}`;
  if (post.status === 'failed') return post.error ?? `Posting to ${label} failed.`;
  return `Posting to ${label}. The platform is processing the video.`;
}

export function PostVideo({ video }: { video: GeneratedVideo }) {
  const theme = useTheme();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [platform, setPlatform] = useState<SocialPlatform | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on cancel, so a login that finishes after the user gave up is ignored.
  const attempt = useRef(0);
  const pollingRef = useRef(false);

  useEffect(() => {
    listPosts(video.id)
      .then(setPosts)
      .catch(() => {});
  }, [video.id]);

  // The platforms process video on their side, so the only way to learn a post
  // went live is to ask. Polls only while something is in flight.
  const inFlightIds = posts
    .filter((p) => p.status !== 'posted' && p.status !== 'failed')
    .map((p) => p.id)
    .join(',');

  useEffect(() => {
    if (!inFlightIds) return;
    const ids = inFlightIds.split(',');

    const tick = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const results = await Promise.all(ids.map((id) => checkPost(id).catch(() => null)));
        const updated = results.filter(Boolean).map((r) => r!.post);
        if (updated.length > 0) {
          setPosts((current) => current.map((p) => updated.find((u) => u.id === p.id) ?? p));
        }
      } finally {
        pollingRef.current = false;
      }
    };

    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inFlightIds]);

  async function open(next: SocialPlatform) {
    setPlatform(next);
    setConnection(null);
    setError(null);
    setCaption(video.prompt.slice(0, CAPTION_LIMITS[next]));
    setLoadingConnection(true);
    try {
      const list = await loadConnections();
      setConnection(list.find((c) => c.platform === next) ?? null);
    } catch (e) {
      setError(e instanceof SocialError ? e.message : 'Could not check the connection.');
    } finally {
      setLoadingConnection(false);
    }
  }

  function connect() {
    if (!platform) return;
    const current = ++attempt.current;
    setConnecting(true);
    setError(null);

    // No await before this call: the popup has to open inside the press.
    connectPlatform(platform)
      .then(async () => {
        if (current !== attempt.current) return;
        const list = await loadConnections();
        setConnection(list.find((c) => c.platform === platform) ?? null);
      })
      .catch((e) => {
        if (current !== attempt.current) return;
        setError(e instanceof SocialError ? e.message : 'Connecting failed.');
      })
      .finally(() => {
        if (current === attempt.current) setConnecting(false);
      });
  }

  function cancelConnect() {
    attempt.current++;
    setConnecting(false);
  }

  function close() {
    cancelConnect();
    setPlatform(null);
  }

  async function post() {
    if (!platform) return;
    setPosting(true);
    setError(null);
    try {
      const { post: created } = await startPost({ videoId: video.id, platform, caption });
      setPosts((current) => [...current, created]);
      setPlatform(null);
    } catch (e) {
      if (e instanceof SocialError && e.needsConnection) {
        setConnection((c) => (c ? { ...c, connected: false } : c));
      }
      setError(e instanceof SocialError ? e.message : 'Posting failed.');
      // A post that failed after it was recorded still belongs in the list.
      listPosts(video.id)
        .then(setPosts)
        .catch(() => {});
    } finally {
      setPosting(false);
    }
  }

  const label = platform ? SOCIAL_LABELS[platform] : '';
  const limit = platform ? CAPTION_LIMITS[platform] : 0;
  const overLimit = caption.length > limit;

  let body: React.ReactNode = null;
  if (loadingConnection) {
    body = <ActivityIndicator color={AccentColors.primary} />;
  } else if (connection && !connection.configured) {
    body = (
      <ThemedText type="small" themeColor="textSecondary">
        {label} posting is not set up on the server yet.
      </ThemedText>
    );
  } else if (connection && !connection.connected) {
    body = (
      <>
        <ThemedText type="small" themeColor="textSecondary">
          Log in to {label} so Synq can post this video for you. You can disconnect any time.
        </ThemedText>
        {connecting ? (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={AccentColors.primary} />
            <ThemedText type="caption" themeColor="textSecondary" style={styles.grow}>
              Finish logging in in the window that opened.
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={cancelConnect}>
              <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                Cancel
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <PrimaryButton title={`Connect ${label}`} onPress={connect} />
        )}
      </>
    );
  } else if (connection) {
    body = (
      <>
        <ThemedText type="small">
          Posting as {connection.account_name ? `@${connection.account_name}` : `your ${label} account`}
        </ThemedText>
        <TextField
          value={caption}
          onChangeText={setCaption}
          multiline
          placeholder="Write a caption…"
          style={styles.captionInput}
        />
        <ThemedText
          type="caption"
          style={{ color: overLimit ? AccentColors.error : theme.textSecondary }}
        >
          {caption.length} / {limit}
        </ThemedText>
        {platform === 'youtube' ? (
          <ThemedText type="caption" themeColor="textSecondary">
            Synq will upload this as a public YouTube video. Vertical videos under three minutes are eligible to appear as Shorts.
          </ThemedText>
        ) : null}
        {platform === 'instagram' && video.duration_seconds < 5 ? (
          <ThemedText type="caption" themeColor="textSecondary">
            Instagram may keep reels under 5 seconds out of the Reels tab. A 6 or 8 second take
            avoids that.
          </ThemedText>
        ) : null}
        <PrimaryButton
          title={posting ? 'Posting…' : `Post to ${label}`}
          onPress={post}
          disabled={posting || overLimit}
        />
      </>
    );
  }

  return (
    <View style={styles.wrap}>
      {posts.map((p) => {
        const working = p.status !== 'posted' && p.status !== 'failed';
        return (
          <View key={p.id} style={styles.row}>
            {working ? <ActivityIndicator size="small" color={AccentColors.primary} /> : null}
            <ThemedText
              type="caption"
              style={[
                styles.grow,
                { color: p.status === 'failed' ? AccentColors.error : theme.textSecondary },
              ]}
            >
              {statusLine(p)}
            </ThemedText>
            {p.post_url ? (
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(p.post_url!)}>
                <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                  View post
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <View style={styles.row}>
        <ThemedText type="caption" themeColor="textSecondary">
          Post to
        </ThemedText>
        {SOCIAL_PLATFORMS.map((p) => (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={`Post to ${SOCIAL_LABELS[p]}`}
            onPress={() => open(p)}
            style={({ hovered }) => [
              styles.circle,
              {
                borderColor: theme.borderStrong,
                backgroundColor: hovered ? theme.surface : 'transparent',
              },
            ]}
          >
            <ThemedText type="caption" style={styles.glyph}>
              {GLYPH[p]}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ModalSheet
        visible={platform !== null}
        onClose={close}
        title={`Post to ${label}`}
        description="Nothing is posted until you press Post. It goes out publicly on the connected account."
      >
        {body}
        {error ? (
          <ThemedText type="caption" style={{ color: AccentColors.error }}>
            {error}
          </ThemedText>
        ) : null}
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flexShrink: 1 },
  circle: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontWeight: '600' },
  captionInput: { minHeight: 100, textAlignVertical: 'top' },
});
