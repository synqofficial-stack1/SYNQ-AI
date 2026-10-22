import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/primary-button';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { callRecordingUrl, checkCall, loadCallReport, type CallReportDetails } from '@/lib/sales/runs';

export function SalesCallReport({ prospectId }: { prospectId: string }) {
  const theme = useTheme();
  const [details, setDetails] = useState<CallReportDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);

  const refresh = useCallback(async (retry = false) => {
    setBusy(true);
    try {
      // Recovers calls completed while Sales was closed, including older calls.
      await checkCall(prospectId);
      setDetails(await loadCallReport(prospectId, retry));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the report.'); }
    finally { setBusy(false); }
  }, [prospectId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await checkCall(prospectId);
        const next = await loadCallReport(prospectId);
        if (cancelled) return;
        setDetails(next);
        setError(null);
        if (next.status === 'pending' || next.status === 'processing') timer = setTimeout(poll, 5000);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the report.');
      }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [prospectId]);

  async function openRecording() {
    setAudioBusy(true);
    try {
      const url = await callRecordingUrl(prospectId);
      if (Platform.OS === 'web') setAudioUrl(url);
      else await Linking.openURL(url);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the recording.'); }
    finally { setAudioBusy(false); }
  }

  const report = details?.report;
  return (
    <View style={styles.stack}>
      <ThemedText type="sectionTitle">Call report</ThemedText>
      {details?.call_error ? <ThemedText type="small" style={{ color: AccentColors.error }}>{details.call_error}</ThemedText> : null}
      {details?.duration != null ? <ThemedText type="caption" themeColor="textSecondary">Duration: {Math.floor(details.duration / 60)}m {details.duration % 60}s</ThemedText> : null}
      <PrimaryButton title={audioBusy ? 'Opening recording…' : 'Listen to recording'} onPress={openRecording} disabled={audioBusy} />
      {audioUrl && Platform.OS === 'web' ? <audio controls src={audioUrl} style={{ width: '100%' }} /> : null}
      {details?.recording_error && !audioUrl ? <ThemedText type="caption" themeColor="textSecondary">{details.recording_error}</ThemedText> : null}
      {report ? (
        <>
          <ThemedText type="small">{report.summary}</ThemedText>
          <ThemedText type="smallBold">Outcome: {report.outcome}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">Customer sentiment: {report.sentiment}</ThemedText>
          <ThemedText type="smallBold">Questions and answers</ThemedText>
          {report.answers.length ? report.answers.map((answer, i) => (
            <View key={i} style={[styles.answer, { backgroundColor: theme.surfaceRaised }]}>
              <ThemedText type="smallBold">{answer.question}</ThemedText>
              <ThemedText type="small">{answer.answer}</ThemedText>
            </View>
          )) : <ThemedText type="caption">No questions were supplied.</ThemedText>}
          {([['Customer needs', report.needs], ['Objections', report.objections], ['Next steps', report.next_steps]] as const).map(([label, items]) => (
            <View key={label} style={styles.stack}>
              <ThemedText type="smallBold">{label}</ThemedText>
              {items.length ? items.map((item, i) => <ThemedText key={i} type="small">• {item}</ThemedText>) : <ThemedText type="caption" themeColor="textSecondary">None captured.</ThemedText>}
            </View>
          ))}
        </>
      ) : <ThemedText type="small" themeColor="textSecondary">{details?.status === 'failed' ? 'Analysis needs another try. Your transcript is saved.' : 'Preparing the transcript and AI report…'}</ThemedText>}
      {details?.error || error ? <ThemedText type="small" style={{ color: AccentColors.error }}>{error ?? details?.error}</ThemedText> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => refresh(details?.status === 'failed')}>
        <ThemedText type="small" themeColor="accentText">{busy ? 'Refreshing…' : details?.status === 'failed' ? 'Retry analysis' : 'Refresh report'}</ThemedText>
      </Pressable>
      {details?.transcript.length ? (
        <View style={[styles.answer, { backgroundColor: theme.surfaceRaised }]}>
          <ThemedText type="smallBold">Full transcript</ThemedText>
          {details.transcript.map((line, i) => <ThemedText key={i} type="caption">{line.speaker === 'agent' ? 'Synq' : 'Customer'}: {line.text}</ThemedText>)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.two },
  answer: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.control },
});
