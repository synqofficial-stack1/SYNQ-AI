import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { File as ExpoFile } from 'expo-file-system';

import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { checkPost, connectPlatform, loadConnections, SOCIAL_LABELS, SOCIAL_PLATFORMS, startPost, type Connection, type SocialPlatform, type SocialPost } from '@/lib/social';
import { createMedia, draftPreviewUrl, listDraftPosts, listDrafts, listUploadedMedia, saveDraft, uploadVideoFile, VIDEO_MIME, type MarketingDraftWithMedia, type MarketingMedia } from '@/lib/marketing-publishing';
import { supabase } from '@/lib/supabase';
import { composeMarketingCaption, MARKETING_CAPTION_LIMITS, validateMarketingDuration, validateMarketingVideo } from '@/lib/marketing-validation';
import { sendChatMessage } from '@/lib/chat';

type DraftWithMedia = MarketingDraftWithMedia;
const GLYPH: Record<SocialPlatform, string> = { youtube: '▶', instagram: 'IG', x: '𝕏', linkedin: 'in' };
const fileSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function readBrowserVideoDuration(source: File | string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
    const videoUrl = objectUrl ?? (typeof source === 'string' ? source : '');
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const seconds = video.duration;
      cleanup();
      if (Number.isFinite(seconds) && seconds > 0) resolve(seconds);
      else reject(new Error('Could not read this video’s duration. Try exporting it again as MP4.'));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Could not read this video’s details. Try exporting it again as MP4.'));
    };
    video.src = videoUrl;
  });
}

export function MarketingPublisher() {
  const theme = useTheme();
  const [drafts, setDrafts] = useState<DraftWithMedia[]>([]);
  const [uploadedMedia, setUploadedMedia] = useState<MarketingMedia[]>([]);
  const [draft, setDraft] = useState<DraftWithMedia | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const player = useVideoPlayer(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [generatedDescription, setGeneratedDescription] = useState('');
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [youtubeVisibility, setYoutubeVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);
  const [platformContent, setPlatformContent] = useState<Partial<Record<SocialPlatform, string>>>({});
  const [filename, setFilename] = useState('');
  const [size, setSize] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [media, setMedia] = useState<MarketingMedia | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [connecting, setConnecting] = useState<SocialPlatform | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [saved, uploads, linked] = await Promise.all([listDrafts(), listUploadedMedia(), loadConnections()]);
    setDrafts(saved as DraftWithMedia[]);
    setUploadedMedia(uploads);
    setConnections(linked);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void refresh().catch((e) => setError(e.message)); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => { if (previewUri) player.replaceAsync(previewUri).catch(() => setError('Could not preview this video.')); }, [player, previewUri]);
  const persistDuration = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const measured = Math.round(seconds * 10) / 10;
    setDuration(measured);
    setMedia((current) => {
      if (current && current.duration_seconds === null) {
        void supabase.from('marketing_media').update({ duration_seconds: measured }).eq('id', current.id);
        return { ...current, duration_seconds: measured };
      }
      return current;
    });
  }, []);
  useEffect(() => {
    // sourceLoad is Expo Video's authoritative metadata event. Polling the
    // duration property alone can miss it on web when the player mounts late.
    const subscription = player.addListener('sourceLoad', ({ duration: seconds }) => persistDuration(seconds));
    return () => subscription.remove();
  }, [player, persistDuration]);
  useEffect(() => {
    if (!previewUri || typeof document === 'undefined') return;
    let current = true;
    void readBrowserVideoDuration(previewUri).then((seconds) => {
      if (current) persistDuration(seconds);
    }).catch(() => {
      // Keep the preview usable; review/publish will explain that metadata is required.
    });
    return () => { current = false; };
  }, [persistDuration, previewUri]);
  const inFlightPosts = posts.filter((post) => post.status !== 'posted' && post.status !== 'failed').map((post) => post.id).join(',');
  const remainingPlatforms = platforms.filter((platform) => !posts.some((post) => post.platform === platform && post.status === 'posted'));
  useEffect(() => {
    if (!inFlightPosts) return;
    const timer = setInterval(() => {
      void Promise.all(inFlightPosts.split(',').map((id) => checkPost(id).catch(() => null))).then((results) => {
        const updated = results.filter((result): result is NonNullable<typeof result> => Boolean(result)).map((result) => result.post);
        if (updated.length) setPosts((current) => current.map((post) => updated.find((item) => item.id === post.id) ?? post));
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [inFlightPosts]);
  useEffect(() => {
    if (!previewUri) return;
    const timer = setInterval(() => {
      const seconds = Number(player.duration);
      if (Number.isFinite(seconds) && seconds > 0) {
        const measured = Math.round(seconds * 10) / 10;
        setDuration(measured);
        if (media && media.duration_seconds === null) {
          setMedia((current) => current?.id === media.id ? { ...current, duration_seconds: measured } : current);
          void supabase.from('marketing_media').update({ duration_seconds: measured }).eq('id', media.id);
        }
        clearInterval(timer);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [media, player, previewUri]);

  const selectedPlatforms = useMemo(() => platforms, [platforms]);
  const reset = () => {
    setDraft(null); setMedia(null); setPreviewUri(null); setFilename(''); setSize(0);
    setTitle(''); setDescription(''); setCaption(''); setHashtags(''); setPlatforms([]); setPlatformContent({}); setPosts([]); setDuration(null); setYoutubeVisibility('public');
  };

  async function chooseVideo() {
    setError(null); setNotice(null);
    let result: DocumentPicker.DocumentPickerResult;
    try { result = await DocumentPicker.getDocumentAsync({ type: ['video/mp4'], copyToCacheDirectory: true, multiple: false }); }
    catch { setError('Could not open the video picker. Check this device’s file permissions and try again.'); return; }
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const invalid = validateMarketingVideo(asset.name, asset.mimeType, asset.size);
    if (invalid) { setError(invalid); return; }
    const assetSize = asset.size ?? 0;
    setDraft(null); setMedia(null); setPosts([]); setDuration(null); setFilename(asset.name); setSize(assetSize); setPreviewUri(asset.uri);
    setBusy(true); setProgress(0);
    let durationSeconds: number | null = null;
    const pathName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'reel.mp4';
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error('Sign in again before uploading.');
      const path = `${userId}/${id}-${pathName}`;
      const file = asset.file ?? new ExpoFile(asset.uri);
      const blob = file instanceof Blob ? file : new Blob([await new ExpoFile(asset.uri).arrayBuffer()], { type: VIDEO_MIME });
      if (blob.size !== assetSize) throw new Error('The selected video could not be read completely.');
      // Expo's web picker provides the actual File. Read its metadata directly
      // as a fallback to the preview player, which may load after upload.
      if (typeof document !== 'undefined' && asset.file) {
        const measured = await readBrowserVideoDuration(asset.file);
        durationSeconds = Math.round(measured * 10) / 10;
        persistDuration(measured);
      }
      await uploadVideoFile(blob, path, setProgress);
      let saved: MarketingMedia;
      try {
        saved = await createMedia({ user_id: userId, filename: asset.name, content_type: VIDEO_MIME, size_bytes: assetSize, duration_seconds: durationSeconds, storage_path: path });
      } catch (e) {
        await supabase.storage.from('marketing-uploads').remove([path]).catch(() => ({ data: null, error: null }));
        throw e;
      }
      setMedia(saved);
      setNotice(saved.duration_seconds ? 'Video uploaded privately and ready for review. It is not published.' : 'Video uploaded privately. Waiting for video details before review.');
      void refresh().catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : 'Video upload failed.'); }
    finally { setBusy(false); setProgress(null); }
  }

  function editDraft(item: DraftWithMedia) {
    setDraft(item); setMedia(item.marketing_media); setFilename(item.marketing_media.filename); setSize(item.marketing_media.size_bytes);
    setTitle(item.title); setDescription(item.description); setCaption(item.caption); setHashtags(item.hashtags);
    setYoutubeVisibility(item.youtube_visibility ?? 'public');
    setPlatforms(item.platforms.filter((platform) => SOCIAL_PLATFORMS.includes(platform))); setPlatformContent(item.platform_content ?? {}); setError(null); setNotice(null);
    setPreviewUri(null); setPosts([]);
    void draftPreviewUrl(item.marketing_media.storage_path).then(setPreviewUri).catch((e) => setError(e.message));
    void listDraftPosts(item.id).then(setPosts).catch((e) => setError(e.message));
  }

  async function resumeUpload(item: MarketingMedia) {
    setError(null); setNotice(null); setDraft(null); setMedia(item); setFilename(item.filename);
    setSize(item.size_bytes); setDuration(item.duration_seconds); setTitle(item.filename.replace(/\.mp4$/i, ''));
    setDescription(''); setCaption(''); setHashtags(''); setPlatforms([]); setPosts([]);
    try { setPreviewUri(await draftPreviewUrl(item.storage_path)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load this uploaded video.'); }
  }

  function togglePlatform(platform: SocialPlatform) {
    setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
    setPlatformContent((current) => ({ ...current, [platform]: current[platform] ?? caption }));
  }

  async function connect(platform: SocialPlatform) {
    setConnecting(platform); setError(null);
    try { await connectPlatform(platform); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : `Could not connect ${SOCIAL_LABELS[platform]}.`); }
    finally { setConnecting(null); }
  }

  async function save(status: 'draft' | 'ready_for_review') {
    if (!media) { setError('Choose and upload a video first.'); return; }
    if (status === 'ready_for_review' && platforms.length === 0) { setError('Select at least one publishing destination before review.'); return; }
    const actualDuration = duration ?? media.duration_seconds;
    if (status === 'ready_for_review') {
      const durationError = platforms.map((p) => validateMarketingDuration(p, actualDuration)).find(Boolean);
      if (durationError) { setError(durationError); return; }
    }
    if (platforms.some((p) => composeMarketingCaption(platformContent[p] ?? caption, hashtags).length > MARKETING_CAPTION_LIMITS[p])) { setError('One or more platform captions including hashtags exceed that platform’s limit.'); return; }
    setBusy(true); setError(null);
    try {
      const saved = await saveDraft({ id: draft?.id, media_id: media.id, title, description, caption, hashtags, platforms, platform_content: platformContent, youtube_visibility: youtubeVisibility, status });
      setDraft(saved as DraftWithMedia); await refresh();
      setNotice(status === 'draft' ? 'Draft saved.' : 'Ready for review. Nothing has been posted.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this draft.'); }
    finally { setBusy(false); }
  }

  async function publishNow() {
    if (!draft || draft.status !== 'ready_for_review' || !media) { setError('Save the draft for review before publishing.'); return; }
    if (!platforms.length) { setError('Select a destination first.'); return; }
    if (!remainingPlatforms.length) {
      setNotice('This draft has already been published to every selected destination. Choose New post to publish another video.');
      return;
    }
    const durationError = platforms.map((p) => validateMarketingDuration(p, duration ?? media.duration_seconds)).find(Boolean);
    if (durationError) { setError(durationError); return; }
    setPublishing(true); setError(null); setNotice('Publishing separately to each selected connected account…');
    const results = await Promise.all(remainingPlatforms.map(async (platform) => {
      try {
        const text = composeMarketingCaption(platformContent[platform] ?? caption, hashtags);
        const { post } = await startPost({ mediaId: media.id, draftId: draft.id, title, description, youtubeVisibility, platform, caption: text });
        return post;
      } catch (e) { return { id: `${draft.id}-${platform}`, platform, status: 'failed', error: e instanceof Error ? e.message : 'Publishing failed.' } as SocialPost; }
    }));
    setPosts((current) => [...current.filter((p) => !results.some((result) => result.id === p.id)), ...results]);
    const failed = results.filter((p) => p.status === 'failed').length;
    setNotice(failed ? `${results.length - failed} posted or processing; ${failed} failed. Check each destination below.` : 'Submitted to all selected destinations. Processing may take a few minutes.');
    setPublishing(false);
    void refresh();
  }

  async function retry(platform: SocialPlatform) {
    if (!draft || !media) return;
    setPublishing(true); setError(null);
    try {
      const captionText = composeMarketingCaption(platformContent[platform] ?? caption, hashtags);
      const { post } = await startPost({ mediaId: media.id, draftId: draft.id, title, description, youtubeVisibility, platform, caption: captionText });
      setPosts((current) => current.map((item) => item.platform === platform ? post : item));
      setNotice(`${SOCIAL_LABELS[platform]} retry submitted.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Retry failed.'); }
    finally { setPublishing(false); }
  }

  async function generateYoutubeDescription() {
    if (!title.trim() && !caption.trim() && !description.trim()) {
      setError('Add a title or video context before generating a YouTube description.');
      return;
    }
    setGeneratingDescription(true); setError(null); setGeneratedDescription('');
    try {
      const context = [
        `Video title: ${title.trim() || '(not supplied)'}`,
        `Existing description draft: ${description.trim() || '(not supplied)'}`,
        `Supplied video context: ${caption.trim() || '(not supplied)'}`,
        `User hashtags: ${hashtags.trim() || '(none supplied)'}`,
      ].join('\n');
      const result = await sendChatMessage({
        kind: 'content',
        context: { task: 'youtube_description' },
        message: `Write a readable YouTube video description from only the supplied facts. Do not invent video details, factual claims, links, or timestamps. Include a concise opening hook and useful context. Add a call to action only if one is supported by the supplied content. Reuse supplied hashtags only when relevant. Return only the suggested description, without commentary.\n\n${context}`,
      });
      setGeneratedDescription(result.reply.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate a YouTube description.');
    } finally {
      setGeneratingDescription(false);
    }
  }

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.header}>
        <View style={styles.grow}>
          <ThemedText type="sectionTitle">Upload and publish a reel</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">Bring a finished MP4. Synq saves a private draft and only publishes after your confirmation.</ThemedText>
        </View>
        <Pressable accessibilityRole="button" onPress={reset}><ThemedText type="caption" style={{ color: AccentColors.primary }}>New post</ThemedText></Pressable>
      </View>

      {!media ? (
        <Pressable accessibilityRole="button" onPress={() => void chooseVideo()} disabled={busy} style={[styles.drop, { borderColor: theme.borderStrong }]}>
          {busy ? <ActivityIndicator color={AccentColors.primary} /> : <ThemedText type="smallBold" style={{ color: AccentColors.primary }}>＋ Choose a video (MP4, up to 100 MB)</ThemedText>}
          <ThemedText type="caption" themeColor="textSecondary">{progress !== null ? `Uploading ${progress}%` : 'Pick from this device. The file is stored privately in your account.'}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">Large video uploads can take 5–10 minutes, depending on file size and internet speed. This is an estimate, not a guarantee. Keep this page open until the upload finishes; an interrupted upload must be restarted.</ThemedText>
        </Pressable>
      ) : (
        <View style={styles.stack}>
          <View style={styles.header}>
            <ThemedText type="caption" themeColor="textSecondary">{filename} · {fileSize(size)} · {(duration ?? media.duration_seconds) ? `${duration ?? media.duration_seconds}s` : 'duration loading'}</ThemedText>
            <View style={styles.platforms}>
              <Pressable accessibilityRole="button" onPress={() => void chooseVideo()} disabled={busy}><ThemedText type="caption" style={{ color: AccentColors.primary }}>Replace</ThemedText></Pressable>
              <Pressable accessibilityRole="button" onPress={reset} disabled={busy}><ThemedText type="caption" style={{ color: AccentColors.error }}>Remove</ThemedText></Pressable>
            </View>
          </View>
          {previewUri ? <VideoView player={player} nativeControls contentFit="contain" style={styles.preview} /> : <ActivityIndicator color={AccentColors.primary} />}
          {progress !== null ? <ThemedText type="caption" themeColor="textSecondary">Uploading {progress}%… Large video uploads can take 5–10 minutes, depending on file size and internet speed. This is an estimate, not a guarantee. Keep this page open; an interrupted upload must be restarted.</ThemedText> : null}
          <TextField value={title} onChangeText={setTitle} placeholder="Post title (YouTube title)" maxLength={100} />
          {platforms.includes('youtube') ? <View style={styles.stack}>
            <View style={styles.header}>
              <ThemedText type="smallBold">YouTube description</ThemedText>
              <Pressable accessibilityRole="button" disabled={generatingDescription} onPress={() => void generateYoutubeDescription()}>
                <ThemedText type="caption" style={{ color: AccentColors.primary }}>{generatingDescription ? 'Generating…' : generatedDescription ? 'Regenerate with AI' : 'Generate with AI'}</ThemedText>
              </Pressable>
            </View>
            <TextField accessibilityLabel="YouTube description" value={description} onChangeText={setDescription} placeholder="Description (optional)" multiline maxLength={5000} style={styles.multiline} />
            {generatedDescription ? <View style={[styles.review, { borderColor: theme.border }]}>
              <ThemedText type="caption">AI suggestion · review before using</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">{generatedDescription}</ThemedText>
              <View style={styles.platforms}>
                <Pressable accessibilityRole="button" onPress={() => { setDescription(generatedDescription); setGeneratedDescription(''); }}><ThemedText type="caption" style={{ color: AccentColors.primary }}>Use suggestion</ThemedText></Pressable>
                <Pressable accessibilityRole="button" onPress={() => setGeneratedDescription('')}><ThemedText type="caption" themeColor="textSecondary">Discard</ThemedText></Pressable>
              </View>
            </View> : null}
          </View> : null}
          {!platforms.includes('youtube') ? <TextField value={description} onChangeText={setDescription} placeholder="Description (optional)" multiline maxLength={5000} style={styles.multiline} /> : null}
          <TextField value={caption} onChangeText={(text) => { setCaption(text); setPlatformContent((old) => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, value === caption ? text : value]))); }} placeholder="Shared caption" multiline style={styles.multiline} />
          <TextField value={hashtags} onChangeText={setHashtags} placeholder="Hashtags (optional)" />
          {platforms.includes('youtube') ? <View style={styles.stack}>
            <ThemedText type="caption" themeColor="textSecondary">YouTube visibility</ThemedText>
            <View style={styles.platforms}>{(['public', 'unlisted', 'private'] as const).map((visibility) => <Pressable key={visibility} accessibilityRole="radio" accessibilityState={{ checked: youtubeVisibility === visibility }} onPress={() => setYoutubeVisibility(visibility)} style={[styles.visibility, { borderColor: youtubeVisibility === visibility ? AccentColors.primary : theme.border }]}><ThemedText type="caption">{visibility}</ThemedText></Pressable>)}</View>
          </View> : null}
          <ThemedText type="smallBold">Choose destinations</ThemedText>
          <View style={styles.platforms}>
            {SOCIAL_PLATFORMS.map((p) => {
              const connection = connections.find((c) => c.platform === p);
              const active = selectedPlatforms.includes(p);
              const destinationDisabled = p === 'youtube' && Boolean(connection?.connected) && connection?.publishing_enabled === false;
              const disabledSelection = destinationDisabled && !active;
              return <Pressable key={p} accessibilityRole="checkbox" accessibilityState={{ checked: active, disabled: disabledSelection }} disabled={disabledSelection} onPress={() => togglePlatform(p)} style={[styles.platform, { borderColor: active ? AccentColors.primary : theme.border, backgroundColor: active ? 'rgba(232,197,71,0.08)' : 'transparent', opacity: disabledSelection ? 0.55 : 1 }]}>
                <ThemedText type="smallBold">{GLYPH[p]} {SOCIAL_LABELS[p]}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">{connection?.connected ? `Connected${connection.account_name ? ` · ${connection.account_name}` : ''}${destinationDisabled ? ' · publishing disabled in Integrations' : ''}` : connection?.configured === false ? 'Server setup needed' : 'Not connected'}</ThemedText>
              </Pressable>;
            })}
          </View>
          {platforms.map((p) => <View key={p} style={styles.stack}>
            <ThemedText type="caption" themeColor="textSecondary">{SOCIAL_LABELS[p]} caption · {composeMarketingCaption(platformContent[p] ?? caption, hashtags).length}/{MARKETING_CAPTION_LIMITS[p]}</ThemedText>
            <TextField value={platformContent[p] ?? caption} onChangeText={(value) => setPlatformContent((old) => ({ ...old, [p]: value }))} multiline style={styles.multiline} maxLength={MARKETING_CAPTION_LIMITS[p]} />
            {!connections.find((c) => c.platform === p)?.connected ? <PrimaryButton title={connecting === p ? `Connecting ${SOCIAL_LABELS[p]}…` : `Connect ${SOCIAL_LABELS[p]}`} onPress={() => void connect(p)} loading={connecting === p} disabled={connections.find((c) => c.platform === p)?.configured === false} /> : null}
          </View>)}
          <View style={styles.actions}>
            <PrimaryButton title={busy ? 'Saving…' : 'Save draft'} onPress={() => void save('draft')} loading={busy} />
            <PrimaryButton title={busy ? 'Saving…' : 'Review post'} onPress={() => void save('ready_for_review')} loading={busy} disabled={platforms.length === 0} />
          </View>
          {draft?.status === 'ready_for_review' ? <View style={[styles.review, { borderColor: AccentColors.primary }]}>
            <ThemedText type="smallBold">Review before publishing</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">{title || filename} · {platforms.map((p) => `${SOCIAL_LABELS[p]} (${connections.find((c) => c.platform === p)?.account_name ?? 'account'}${p === 'youtube' ? ` · ${youtubeVisibility}` : ''})`).join(', ')}. Each destination is submitted only after you press Publish.</ThemedText>
            <PrimaryButton title={publishing ? 'Publishing…' : remainingPlatforms.length ? `Publish to ${remainingPlatforms.length} remaining destination${remainingPlatforms.length === 1 ? '' : 's'}` : 'Already published'} onPress={() => void publishNow()} loading={publishing} disabled={publishing || remainingPlatforms.length === 0} />
            {platforms.map((p) => <ThemedText key={`review-${p}`} type="caption" themeColor="textSecondary">{SOCIAL_LABELS[p]} preview: {title ? `${title} · ` : ''}{composeMarketingCaption(platformContent[p] ?? caption, hashtags) || '(No caption)'}</ThemedText>)}
          </View> : null}
          {posts.map((p) => <View key={p.id} style={styles.resultRow}>
            <ThemedText type="caption" style={[styles.grow, { color: p.status === 'failed' ? AccentColors.error : theme.textSecondary }]}>{SOCIAL_LABELS[p.platform]}: {p.status}{p.error ? ` · ${p.error}` : ''}{p.post_url ? ` · ${p.post_url}` : ''}</ThemedText>
            {p.status === 'failed' ? <Pressable accessibilityRole="button" onPress={() => void retry(p.platform)} disabled={publishing}><ThemedText type="caption" style={{ color: AccentColors.primary }}>Retry</ThemedText></Pressable> : null}
          </View>)}
        </View>
      )}
      {error ? <ThemedText type="caption" style={{ color: AccentColors.error }}>{error}</ThemedText> : null}
      {notice ? <ThemedText type="caption" themeColor="textSecondary">{notice}</ThemedText> : null}
      {drafts.length ? <View style={styles.stack}>
        <ThemedText type="smallBold">Saved drafts and publishing</ThemedText>
        {drafts.map((item) => {
          const published = item.social_posts.filter((post) => post.status === 'posted');
          const allPublished = item.platforms.length > 0 && item.platforms.every((platform) => published.some((post) => post.platform === platform));
          const publishedLabel = published.length ? `Published to ${published.map((post) => SOCIAL_LABELS[post.platform]).join(', ')}` : null;
          return <Pressable key={item.id} accessibilityRole="button" onPress={() => editDraft(item)} style={[styles.savedDraft, { borderColor: theme.border }]}>
          <ThemedText type="smallBold">{item.title || item.marketing_media?.filename || 'Untitled reel'}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">{allPublished ? 'Published' : publishedLabel ?? (item.status === 'ready_for_review' ? 'Ready for review' : 'Draft')} · {item.platforms.map((p) => SOCIAL_LABELS[p]).join(', ') || 'No destinations yet'}</ThemedText>
          {published.map((post) => post.post_url ? <ThemedText key={post.id} type="caption" style={{ color: AccentColors.primary }}>{post.post_url}</ThemedText> : null)}
        </Pressable>;
        })}
      </View> : null}
      {uploadedMedia.filter((item) => !drafts.some((saved) => saved.media_id === item.id)).length ? <View style={styles.stack}>
        <ThemedText type="smallBold">Uploaded videos</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">Uploads are saved privately and remain available after refresh. Select one to continue its draft.</ThemedText>
        {uploadedMedia.filter((item) => !drafts.some((saved) => saved.media_id === item.id)).map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void resumeUpload(item)} style={[styles.savedDraft, { borderColor: theme.border }]}>
          <ThemedText type="smallBold">{item.filename}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">{fileSize(item.size_bytes)} · Uploaded {new Date(item.created_at).toLocaleString()}</ThemedText>
        </Pressable>)}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { width: '100%', borderWidth: 1, borderRadius: Radius.card, padding: Spacing.four, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three },
  grow: { flex: 1, gap: Spacing.one }, stack: { gap: Spacing.two },
  drop: { minHeight: 110, borderWidth: 1, borderStyle: 'dashed', borderRadius: Radius.card, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  preview: { width: '100%', maxHeight: 440, aspectRatio: 9 / 16, backgroundColor: '#000', borderRadius: Radius.control },
  multiline: { minHeight: 82, textAlignVertical: 'top' },
  platforms: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  platform: { flexGrow: 1, minWidth: 138, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.control, gap: Spacing.one },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  review: { borderWidth: 1, borderRadius: Radius.control, padding: Spacing.three, gap: Spacing.two },
  savedDraft: { padding: Spacing.three, borderWidth: 1, borderRadius: Radius.control, gap: Spacing.one },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  visibility: { borderWidth: 1, borderRadius: Radius.pill, paddingVertical: Spacing.one, paddingHorizontal: Spacing.three },
});
