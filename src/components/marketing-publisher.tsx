import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { File as ExpoFile } from 'expo-file-system';

import { PlatformMark } from '@/components/brand-icons';
import { CheckCircleIcon, CircleIcon, FilmIcon, PlugIcon, PlusIcon, RefreshIcon, SendIcon, SparkIcon, TrashIcon, UploadIcon, VideoIcon } from '@/components/icons';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  ButtonRow,
  Card,
  ChoiceGroup,
  EmptyState,
  Field,
  InlineAlert,
  LinkButton,
  ListRow,
  ProgressBar,
  SectionHeader,
  Select,
  StatusBadge,
  transition,
  useBreakpoint,
  type Tone,
} from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { checkPost, connectPlatform, loadConnections, SOCIAL_LABELS, SOCIAL_PLATFORMS, startPost, type Connection, type SocialPlatform, type SocialPost } from '@/lib/social';
import { createMedia, draftPreviewUrl, listDraftPosts, listDrafts, listUploadedMedia, saveDraft, uploadVideoFile, VIDEO_MIME, type MarketingDraftWithMedia, type MarketingMedia } from '@/lib/marketing-publishing';
import { supabase } from '@/lib/supabase';
import { composeMarketingCaption, MARKETING_CAPTION_LIMITS, validateMarketingDuration, validateMarketingVideo } from '@/lib/marketing-validation';
import { sendChatMessage } from '@/lib/chat';

// Create Reel: upload a finished MP4, add a caption, and publish. A post goes to
// every connected plugin (whose publishing is on); which plugins those are is
// managed on the Plugins page, so this screen only shows them. Every step saves
// a private draft, and nothing is published until the person presses Publish
// in the review panel, which names every destination first.

type DraftWithMedia = MarketingDraftWithMedia;
const fileSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const POST_TONE: Record<string, Tone> = {
  pending: 'neutral',
  processing: 'info',
  publishing: 'info',
  posted: 'success',
  failed: 'danger',
};
const POST_LABEL: Record<string, string> = {
  pending: 'Queued',
  processing: 'Processing',
  publishing: 'Publishing',
  posted: 'Published',
  failed: 'Failed',
};

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

export function MarketingPublisher({ initialDraftId }: { initialDraftId?: string } = {}) {
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
  const [libraryView, setLibraryView] = useState<'drafts' | 'uploads'>('drafts');
  // Destinations follow the Plugins page: every connected account with publishing on.
  const platforms = useMemo(
    () =>
      SOCIAL_PLATFORMS.filter((p) => {
        const connection = connections.find((c) => c.platform === p);
        return Boolean(connection?.connected) && connection?.publishing_enabled !== false;
      }),
    [connections],
  );

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

  const reset = () => {
    setDraft(null); setMedia(null); setPreviewUri(null); setFilename(''); setSize(0);
    setTitle(''); setDescription(''); setCaption(''); setHashtags(''); setPlatformContent({}); setPosts([]); setDuration(null); setYoutubeVisibility('public');
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
    setPlatformContent(item.platform_content ?? {}); setError(null); setNotice(null);
    setPreviewUri(null); setPosts([]);
    void draftPreviewUrl(item.marketing_media.storage_path).then(setPreviewUri).catch((e) => setError(e.message));
    void listDraftPosts(item.id).then(setPosts).catch((e) => setError(e.message));
  }

  async function resumeUpload(item: MarketingMedia) {
    setError(null); setNotice(null); setDraft(null); setMedia(item); setFilename(item.filename);
    setSize(item.size_bytes); setDuration(item.duration_seconds); setTitle(item.filename.replace(/\.mp4$/i, ''));
    setDescription(''); setCaption(''); setHashtags(''); setPosts([]);
    try { setPreviewUri(await draftPreviewUrl(item.storage_path)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load this uploaded video.'); }
  }

  async function connect(platform: SocialPlatform) {
    setConnecting(platform); setError(null);
    try { await connectPlatform(platform); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : `Could not connect ${SOCIAL_LABELS[platform]}.`); }
    finally { setConnecting(null); }
  }

  async function save(status: 'draft' | 'ready_for_review') {
    if (!media) { setError('Choose and upload a video first.'); return; }
    if (status === 'ready_for_review' && platforms.length === 0) { setError('Connect at least one plugin before review. Publishing goes to every connected plugin.'); return; }
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
    if (!platforms.length) { setError('Connect a plugin first. Publishing goes to every connected plugin.'); return; }
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

  // A draft opened from the Marketing overview or library arrives as an id in
  // the URL; open it once the saved drafts have loaded. editDraft is a new
  // function every render, so the effect reads the latest one through a ref.
  const openedDraft = useRef<string | null>(null);
  const editDraftRef = useRef(editDraft);
  useEffect(() => {
    editDraftRef.current = editDraft;
  });
  useEffect(() => {
    if (!initialDraftId || openedDraft.current === initialDraftId) return;
    const item = drafts.find((saved) => saved.id === initialDraftId);
    if (!item) return;
    openedDraft.current = initialDraftId;
    const timer = setTimeout(() => editDraftRef.current(item), 0);
    return () => clearTimeout(timer);
  }, [drafts, initialDraftId]);

  const { width } = useBreakpoint();
  const columns = width >= 1320 ? 3 : width >= 900 ? 2 : 1;
  const currentDuration = duration ?? media?.duration_seconds ?? null;
  const unsavedUploads = uploadedMedia.filter((item) => !drafts.some((saved) => saved.media_id === item.id));

  const content = (
    <Card>
      <SectionHeader title="1. Your content" subtitle="Bring a finished MP4. It is stored privately until you publish." />
      {!media ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose a video to upload"
          onPress={() => void chooseVideo()}
          disabled={busy}
          style={({ hovered }) => [
            styles.drop,
            transition,
            { borderColor: hovered ? theme.accentHover : theme.borderStrong, backgroundColor: hovered ? theme.accentSoft : theme.surfaceRaised },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <View style={[styles.dropIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <UploadIcon size={20} color={theme.text} />
            </View>
          )}
          <ThemedText type="smallBold">{progress !== null ? `Uploading ${progress}%` : 'Choose a video to upload'}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            MP4 only, up to 100 MB
          </ThemedText>
          {!busy ? (
            <View pointerEvents="none" style={[styles.fakeButton, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <ThemedText type="smallBold">Browse files</ThemedText>
            </View>
          ) : null}
        </Pressable>
      ) : (
        <View style={[styles.fileRow, { borderColor: theme.border }]}>
          <View style={[styles.fileThumb, { backgroundColor: '#171717' }]}>
            <FilmIcon size={20} color="#FFD45A" />
          </View>
          <View style={styles.fileText}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {filename}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {fileSize(size)} · {currentDuration ? `${currentDuration}s` : 'reading duration…'}
            </ThemedText>
          </View>
          <StatusBadge
            label={progress !== null ? `Uploading ${progress}%` : draft ? (draft.status === 'ready_for_review' ? 'Ready for review' : 'Saved as draft') : 'Uploaded · private'}
            tone={progress !== null || draft?.status === 'ready_for_review' ? 'info' : 'success'}
          />
          <ButtonRow>
            <Button label="Replace" size="sm" icon={RefreshIcon} disabled={busy} onPress={() => void chooseVideo()} />
            <Button label="Remove" size="sm" variant="dangerOutline" icon={TrashIcon} disabled={busy} onPress={reset} accessibilityLabel="Remove this video from the post" />
          </ButtonRow>
        </View>
      )}
      {media && progress === null ? (
        <View style={[styles.nextSteps, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
          <ThemedText type="smallBold">Next steps</ThemedText>
          {[
            { done: Boolean(title.trim() || caption.trim()), label: 'Add a title and caption in Caption & details.' },
            {
              done: platforms.length > 0,
              label: platforms.length
                ? `Publishes to ${platforms.map((p) => SOCIAL_LABELS[p]).join(', ')}.`
                : 'Connect a plugin so the post has somewhere to go.',
            },
            { done: draft?.status === 'ready_for_review', label: 'Press Review post, check everything, then Publish.' },
          ].map((step, index) => (
            <View key={index} style={styles.nextStep}>
              {step.done ? <CheckCircleIcon size={16} color={theme.success} /> : <CircleIcon size={16} color={theme.textSecondary} />}
              <ThemedText type="caption" themeColor={step.done ? 'textSecondary' : 'text'} style={styles.nextStepText}>
                {step.label}
              </ThemedText>
            </View>
          ))}
          {!platforms.length ? <Button label="Open Plugins" size="sm" icon={PlugIcon} onPress={() => router.push('/plugins')} /> : null}
        </View>
      ) : null}
      {progress !== null ? <ProgressBar value={progress / 100} label="Upload progress" /> : null}
      <ThemedText type="caption" themeColor="textSecondary">
        Large uploads can take 5–10 minutes depending on file size and connection — an estimate, not a guarantee. Keep this page open until the upload finishes; an interrupted upload must be restarted.
      </ThemedText>
    </Card>
  );

  const details = (
    <Card>
      <SectionHeader title="2. Caption & details" subtitle="The shared caption is copied to each destination, where you can adjust it." />
      <Field label="Title" helper="Used as the YouTube title." count={{ value: title.length, max: 100 }}>
        <TextField accessibilityLabel="Post title" value={title} onChangeText={setTitle} placeholder="e.g. Turn your café into a brand" maxLength={100} editable={!!media} />
      </Field>
      <Field label={platforms.includes('youtube') ? 'YouTube description' : 'Description'} helper="Optional." count={{ value: description.length, max: 5000 }}>
        <TextField accessibilityLabel={platforms.includes('youtube') ? 'YouTube description' : 'Description'} value={description} onChangeText={setDescription} placeholder="What is this video about?" multiline maxLength={5000} editable={!!media} />
      </Field>
      {platforms.includes('youtube') ? (
        <View style={styles.aiRow}>
          <Button
            label={generatingDescription ? 'Generating…' : generatedDescription ? 'Regenerate with AI' : 'Write description with AI'}
            size="sm"
            icon={SparkIcon}
            loading={generatingDescription}
            disabled={generatingDescription}
            onPress={() => void generateYoutubeDescription()}
          />
          <ThemedText type="caption" themeColor="textSecondary">
            Uses 1 AI credit. Built only from the facts you supplied.
          </ThemedText>
        </View>
      ) : null}
      {generatedDescription ? (
        <Card tone="accent" padded>
          <ThemedText type="smallBold">AI suggestion · review before using</ThemedText>
          <ThemedText type="small" selectable>
            {generatedDescription}
          </ThemedText>
          <ButtonRow>
            <Button
              label="Use suggestion"
              size="sm"
              variant="primary"
              onPress={() => {
                setDescription(generatedDescription);
                setGeneratedDescription('');
              }}
            />
            <Button label="Discard" size="sm" onPress={() => setGeneratedDescription('')} />
          </ButtonRow>
        </Card>
      ) : null}
      <Field label="Caption" helper="Shared across destinations.">
        <TextField
          accessibilityLabel="Shared caption"
          value={caption}
          onChangeText={(text) => {
            setCaption(text);
            setPlatformContent((old) => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, value === caption ? text : value])));
          }}
          placeholder="From great coffee to happy customers…"
          multiline
          editable={!!media}
        />
      </Field>
      <Field label="Hashtags" helper="Optional. Added after the caption on every destination.">
        <TextField accessibilityLabel="Hashtags" value={hashtags} onChangeText={setHashtags} placeholder="#smallbusiness #cafe" editable={!!media} />
      </Field>
      {platforms.includes('youtube') ? (
        <Field label="YouTube visibility">
          <ChoiceGroup
            label="YouTube visibility"
            value={youtubeVisibility}
            onChange={setYoutubeVisibility}
            options={[
              { value: 'public', label: 'Public' },
              { value: 'unlisted', label: 'Unlisted' },
              { value: 'private', label: 'Private' },
            ]}
          />
        </Field>
      ) : null}
    </Card>
  );

  const preview = (
    <Card>
      <SectionHeader title="Video preview" subtitle={media ? `${filename}` : 'Shown here once a video is chosen.'} />
      <View style={[styles.previewFrame, { backgroundColor: '#111210' }]}>
        {previewUri ? (
          <VideoView player={player} nativeControls contentFit="contain" style={styles.preview} />
        ) : media ? (
          <ActivityIndicator color="#FFD45A" />
        ) : (
          <View style={styles.previewEmpty}>
            <VideoIcon size={28} color="#8C887F" />
            <ThemedText type="caption" style={styles.previewEmptyText}>
              No video yet
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        9:16 vertical videos suit Reels and Shorts. The preview plays your private upload.
      </ThemedText>
    </Card>
  );

  const destinations = (
    <Card>
      <SectionHeader
        title="3. Publish settings"
        subtitle="This post goes to every connected plugin. Connections are managed on the Plugins page."
      />
      <View>
        {SOCIAL_PLATFORMS.map((p, index) => {
          const connection = connections.find((c) => c.platform === p);
          const active = platforms.includes(p);
          const publishingOff = Boolean(connection?.connected) && connection?.publishing_enabled === false;
          const status = connection?.connected
            ? `Connected${connection.account_name ? ` · ${connection.account_name}` : ''}${publishingOff ? ' · publishing turned off in Plugins' : ''}`
            : connection?.configured === false
              ? 'Server setup needed'
              : 'Not connected';
          return (
            <View key={p} style={[styles.destination, index < SOCIAL_PLATFORMS.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
              <View style={styles.destinationHead}>
                <PlatformMark platform={p} size={38} />
                <View style={styles.destinationText}>
                  <ThemedText type="smallBold">{SOCIAL_LABELS[p]}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {status}
                  </ThemedText>
                </View>
                <StatusBadge label={active ? 'Will publish' : publishingOff ? 'Off' : 'Not connected'} tone={active ? 'success' : 'neutral'} />
              </View>
              {active && media ? (
                <View style={styles.destinationBody}>
                  <Field
                    label={`${SOCIAL_LABELS[p]} caption`}
                    count={{ value: composeMarketingCaption(platformContent[p] ?? caption, hashtags).length, max: MARKETING_CAPTION_LIMITS[p] }}
                  >
                    <TextField
                      accessibilityLabel={`${SOCIAL_LABELS[p]} caption`}
                      value={platformContent[p] ?? caption}
                      onChangeText={(value) => setPlatformContent((old) => ({ ...old, [p]: value }))}
                      multiline
                      maxLength={MARKETING_CAPTION_LIMITS[p]}
                    />
                  </Field>
                </View>
              ) : !connection?.connected ? (
                <View style={styles.destinationBody}>
                  <Button
                    label={connecting === p ? `Connecting ${SOCIAL_LABELS[p]}…` : `Connect ${SOCIAL_LABELS[p]}`}
                    size="sm"
                    loading={connecting === p}
                    disabled={connection?.configured === false}
                    onPress={() => void connect(p)}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <LinkButton label="Manage plugins" icon={PlugIcon} onPress={() => router.push('/plugins')} />
      <ButtonRow>
        <Button label={busy ? 'Saving…' : 'Save draft'} disabled={busy || !media} onPress={() => void save('draft')} />
        <Button label="Review post" variant="primary" disabled={busy || !media || platforms.length === 0} loading={busy} onPress={() => void save('ready_for_review')} />
      </ButtonRow>
      {draft?.status === 'ready_for_review' ? (
        <Card tone="accent">
          <SectionHeader title="Review before publishing" size="card" />
          <ThemedText type="small">
            {title || filename} ·{' '}
            {platforms
              .map((p) => `${SOCIAL_LABELS[p]} (${connections.find((c) => c.platform === p)?.account_name ?? 'account'}${p === 'youtube' ? ` · ${youtubeVisibility}` : ''})`)
              .join(', ')}
            . Each destination is submitted only after you press Publish.
          </ThemedText>
          {platforms.map((p) => (
            <ThemedText key={`review-${p}`} type="caption" themeColor="textSecondary">
              {SOCIAL_LABELS[p]}: {title ? `${title} · ` : ''}
              {composeMarketingCaption(platformContent[p] ?? caption, hashtags) || '(No caption)'}
            </ThemedText>
          ))}
          <Button
            label={
              publishing
                ? 'Publishing…'
                : remainingPlatforms.length
                  ? `Publish to ${remainingPlatforms.length} ${remainingPlatforms.length === 1 ? 'destination' : 'destinations'}`
                  : 'Already published'
            }
            variant="primary"
            size="lg"
            fullWidth
            icon={SendIcon}
            loading={publishing}
            disabled={publishing || remainingPlatforms.length === 0}
            onPress={() => void publishNow()}
          />
        </Card>
      ) : null}
      {posts.length ? (
        <View style={styles.results}>
          {posts.map((p) => (
            <View key={p.id} style={styles.result}>
              <PlatformMark platform={p.platform} size={28} />
              <View style={styles.destinationText}>
                <ThemedText type="small">{SOCIAL_LABELS[p.platform]}</ThemedText>
                {p.error ? (
                  <ThemedText type="caption" style={{ color: theme.danger }}>
                    {p.error}
                  </ThemedText>
                ) : null}
                {p.post_url ? (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(p.post_url!)}>
                    <ThemedText type="caption" style={{ color: theme.accentText }} numberOfLines={1}>
                      {p.post_url}
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
              <StatusBadge label={POST_LABEL[p.status] ?? p.status} tone={POST_TONE[p.status] ?? 'neutral'} />
              {p.status === 'failed' ? <Button label="Retry" size="sm" disabled={publishing} onPress={() => void retry(p.platform)} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );

  const library = (
    <Card>
      <SectionHeader
        title={libraryView === 'drafts' ? 'Saved drafts' : 'Uploads'}
        subtitle={libraryView === 'drafts' ? 'Drafts stay private. Select one to keep working on it.' : 'Videos uploaded but not saved in a draft yet.'}
        action={
          <Select
            label="Show"
            size="sm"
            value={libraryView}
            onChange={setLibraryView}
            options={[
              { value: 'drafts', label: `Saved drafts (${drafts.length})` },
              { value: 'uploads', label: `Uploads (${unsavedUploads.length})` },
            ]}
          />
        }
      />
      {libraryView === 'drafts' && !drafts.length ? (
        <EmptyState icon={FilmIcon} title="No drafts yet" description="Upload a video and press Save draft to see it here." compact />
      ) : libraryView === 'uploads' && !unsavedUploads.length ? (
        <EmptyState icon={UploadIcon} title="No loose uploads" description="Every uploaded video is already in a draft." compact />
      ) : libraryView === 'drafts' ? (
        <View>
          {drafts.map((item, index) => {
            const published = item.social_posts.filter((post) => post.status === 'posted');
            const allPublished = item.platforms.length > 0 && item.platforms.every((platform) => published.some((post) => post.platform === platform));
            const label = allPublished
              ? 'Published'
              : published.length
                ? `Published to ${published.map((post) => SOCIAL_LABELS[post.platform]).join(', ')}`
                : item.status === 'ready_for_review'
                  ? 'Ready for review'
                  : 'Draft';
            return (
              <ListRow
                key={item.id}
                title={item.title || item.marketing_media?.filename || 'Untitled reel'}
                subtitle={`${item.platforms.map((p) => SOCIAL_LABELS[p]).join(', ') || 'No destinations yet'} · edited ${new Date(item.updated_at).toLocaleDateString()}`}
                leading={<View style={[styles.libThumb, { backgroundColor: '#171717' }]}><FilmIcon size={16} color="#FFD45A" /></View>}
                trailing={<StatusBadge label={label} tone={allPublished ? 'success' : item.status === 'ready_for_review' ? 'info' : 'neutral'} />}
                onPress={() => editDraft(item)}
                chevron={false}
                divider={index < drafts.length - 1}
              />
            );
          })}
        </View>
      ) : (
        <View>
          {unsavedUploads.map((item, index) => (
            <ListRow
              key={item.id}
              title={item.filename}
              subtitle={`${fileSize(item.size_bytes)} · uploaded ${new Date(item.created_at).toLocaleString()} · open it to add a caption`}
              leading={<View style={[styles.libThumb, { backgroundColor: theme.surfaceRaised }]}><UploadIcon size={16} color={theme.textSecondary} /></View>}
              trailing={<StatusBadge label="Not in a draft" tone="neutral" />}
              onPress={() => void resumeUpload(item)}
              chevron={false}
              divider={index < unsavedUploads.length - 1}
            />
          ))}
        </View>
      )}
    </Card>
  );

  const messagesBlock = (
    <>
      {error ? <InlineAlert tone="danger" message={error} /> : null}
      {notice ? <InlineAlert tone="info" message={notice} /> : null}
    </>
  );

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.toolbarText}>
          {draft ? `Editing “${draft.title || filename || 'Untitled reel'}”` : media ? 'New post — not saved yet' : 'Start a new post'}
        </ThemedText>
        <ButtonRow>
          <Button label="New post" size="sm" icon={PlusIcon} onPress={reset} />
        </ButtonRow>
      </View>
      {messagesBlock}
      {columns === 3 ? (
        <View style={styles.columns}>
          <View style={[styles.column, { flex: 1.15 }]}>
            {content}
            {details}
          </View>
          <View style={[styles.column, { flex: 0.85 }]}>{preview}</View>
          <View style={[styles.column, { flex: 1.1 }]}>
            {destinations}
            {library}
          </View>
        </View>
      ) : columns === 2 ? (
        <View style={styles.columns}>
          <View style={[styles.column, { flex: 1.1 }]}>
            {content}
            {details}
            {library}
          </View>
          <View style={[styles.column, { flex: 1 }]}>
            {preview}
            {destinations}
          </View>
        </View>
      ) : (
        <View style={styles.column}>
          {content}
          {preview}
          {details}
          {destinations}
          {library}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  toolbarText: { flexShrink: 1 },
  columns: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  column: { gap: 16, minWidth: 0 },
  drop: {
    minHeight: 190,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: Radius.card - 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 20,
  },
  dropIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  fakeButton: { marginTop: 8, paddingHorizontal: 16, height: 36, justifyContent: 'center', borderRadius: Radius.control, borderWidth: 1 },
  fileRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderRadius: Radius.control + 2 },
  fileThumb: { width: 56, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fileText: { flex: 1, minWidth: 140, gap: 2 },
  aiRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: -6 },
  previewFrame: { width: '100%', aspectRatio: 9 / 16, maxHeight: 560, borderRadius: Radius.control + 4, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  preview: { width: '100%', height: '100%' },
  previewEmpty: { alignItems: 'center', gap: 8 },
  previewEmptyText: { color: '#A9A59C' },
  destination: { gap: 12, paddingVertical: 12 },
  destinationHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  destinationText: { flex: 1, minWidth: 0, gap: 1 },
  destinationBody: { gap: 10, paddingLeft: 50 },
  results: { gap: 10 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextSteps: { gap: 8, padding: 12, borderWidth: 1, borderRadius: Radius.control + 2 },
  nextStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nextStepText: { flex: 1 },
  libThumb: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
