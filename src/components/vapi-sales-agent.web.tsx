import Vapi from '@vapi-ai/web';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type SavedCall = { id: string; summary: string | null; outcome: string | null; error_message: string | null; status: string; created_at: string };
type CallPhase = 'idle' | 'confirm' | 'starting' | 'active' | 'ended' | 'failed';

const publicKey = process.env.EXPO_PUBLIC_VAPI_PUBLIC_KEY?.trim() ?? '';
const assistantId = process.env.EXPO_PUBLIC_VAPI_ASSISTANT_ID?.trim() ?? '';

export function VapiSalesAgent() {
  const theme = useTheme();
  const vapiRef = useRef<Vapi | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [savedCalls, setSavedCalls] = useState<SavedCall[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);

  const refreshCalls = useCallback(async () => {
    setLoadingCalls(true);
    const { data, error } = await supabase
      .from('vapi_calls')
      .select('id, summary, outcome, error_message, status, created_at')
      .order('created_at', { ascending: false })
      .limit(3);
    if (!error) setSavedCalls((data ?? []) as SavedCall[]);
    setLoadingCalls(false);
  }, []);

  useEffect(() => () => {
    if (vapiRef.current) void vapiRef.current.stop();
  }, []);

  const persistStart = useCallback(async (sessionId: string, callId?: string) => {
    const { error } = await supabase.from('vapi_calls').update({
      ...(callId ? { provider_call_id: callId } : {}),
      status: 'in-progress',
    }).eq('id', sessionId);
    if (error) setStatusMessage('The call is live, but Synq could not link its report. Apply the vapi_calls migration and try again.');
  }, []);

  const startCall = useCallback(async () => {
    if (!publicKey || !assistantId) return;
    setPhase('starting');
    setStatusMessage('Connecting to your saved Vapi assistant…');

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authError || !user) {
      setPhase('failed');
      setStatusMessage('Sign in to Synq before starting a Vapi session.');
      return;
    }

    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;
    const { error: insertError } = await supabase.from('vapi_calls').insert({
      id: sessionId,
      user_id: user.id,
      assistant_id: assistantId,
      status: 'starting',
    });
    if (insertError) {
      setPhase('failed');
      setStatusMessage(insertError.message.includes('vapi_calls')
        ? 'The Synq Vapi call table is not deployed yet. Apply the vapi_calls migration first.'
        : `Could not create the Synq call record: ${insertError.message}`);
      return;
    }

    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;
    vapi.on('call-start', () => {
      setPhase('active');
      setStatusMessage('Connected. Your saved assistant settings are in use.');
    });
    vapi.on('call-start-success', (event) => {
      if (sessionIdRef.current === sessionId) void persistStart(sessionId, event.callId);
    });
    vapi.on('call-start-failed', (event) => {
      setPhase('failed');
      setStatusMessage(event.error || 'Vapi could not start this session. Check the Vapi dashboard and browser microphone permission.');
      void supabase.from('vapi_calls').update({ status: 'failed', error_message: event.error.slice(0, 500) }).eq('id', sessionId);
    });
    vapi.on('error', (error) => {
      const detail = error instanceof Error ? error.message : 'Vapi reported a connection error.';
      setStatusMessage(detail);
    });
    vapi.on('call-end', () => {
      setPhase('ended');
      setStatusMessage('Session ended. The Vapi webhook will save the final transcript and summary.');
      void refreshCalls();
    });

    try {
      const call = await vapi.start(assistantId, {
        metadata: { synq_session_id: sessionId },
      });
      if (!call) throw new Error('Vapi did not return a call session.');
      await persistStart(sessionId, call.id);
    } catch (error) {
      setPhase('failed');
      const detail = error instanceof Error ? error.message : 'Vapi could not start this session.';
      setStatusMessage(detail);
      await supabase.from('vapi_calls').update({ status: 'failed', error_message: detail.slice(0, 500) }).eq('id', sessionId);
    }
  }, [persistStart, refreshCalls]);

  const stopCall = useCallback(async () => {
    await vapiRef.current?.stop();
    setPhase('ended');
  }, []);

  const unavailable = !publicKey || !assistantId;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <ThemedText type="smallBold">Vapi voice assistant</ThemedText>
      {unavailable ? (
        <ThemedText type="small" themeColor="textSecondary">
          Add EXPO_PUBLIC_VAPI_PUBLIC_KEY and EXPO_PUBLIC_VAPI_ASSISTANT_ID to .env.local, then restart Expo.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Starts a browser voice session with the saved assistant. Vapi and its configured model, voice, or transcription providers may bill for usage. This does not place a phone call.
          </ThemedText>
          {phase === 'confirm' ? (
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={() => setPhase('idle')} style={[styles.button, { borderColor: theme.borderStrong }]}>
                <ThemedText type="smallBold">Cancel</ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void startCall()} style={[styles.button, styles.primary]}>
                <ThemedText type="smallBold" style={styles.primaryText}>Start Vapi session</ThemedText>
              </Pressable>
            </View>
          ) : phase === 'active' ? (
            <Pressable accessibilityRole="button" onPress={() => void stopCall()} style={[styles.button, styles.danger]}>
              <ThemedText type="smallBold" style={styles.primaryText}>End session</ThemedText>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" disabled={phase === 'starting'} onPress={() => setPhase('confirm')} style={[styles.button, styles.primary, phase === 'starting' && styles.disabled]}>
              {phase === 'starting' ? <ActivityIndicator color="#141414" /> : <ThemedText type="smallBold" style={styles.primaryText}>Test voice assistant</ThemedText>}
            </Pressable>
          )}
          {statusMessage ? <ThemedText type="caption" themeColor="textSecondary">{statusMessage}</ThemedText> : null}
          <ThemedText type="caption" themeColor="textSecondary">
            Use HTTPS and allow microphone access in the browser. Vapi test sessions can use billable credits.
          </ThemedText>
        </>
      )}
      <View style={[styles.history, { borderTopColor: theme.border }]}>
        <ThemedText type="caption" themeColor="textSecondary">Recent Vapi sessions</ThemedText>
        <Pressable accessibilityRole="button" onPress={() => void refreshCalls()} disabled={loadingCalls}>
          <ThemedText type="caption" style={{ color: AccentColors.primary }}>{loadingCalls ? 'Refreshing…' : 'Refresh Vapi history'}</ThemedText>
        </Pressable>
        {loadingCalls ? <ActivityIndicator size="small" color={AccentColors.primary} /> : savedCalls.length ? savedCalls.map((call) => (
          <View key={call.id} style={styles.historyItem}>
          <ThemedText type="caption">{call.summary ?? call.error_message ?? (call.status === 'ended' ? 'Report is processing or unavailable.' : `Session ${call.status}`)}</ThemedText>
            {call.outcome ? <ThemedText type="caption" themeColor="textSecondary">{call.outcome}</ThemedText> : null}
          </View>
        )) : <ThemedText type="caption" themeColor="textSecondary">No saved sessions yet.</ThemedText>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.three, padding: Spacing.four, borderWidth: 1, borderRadius: Radius.card },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: Radius.control },
  primary: { backgroundColor: AccentColors.primary, borderColor: AccentColors.primary },
  primaryText: { color: '#141414' },
  danger: { backgroundColor: '#a33434', borderColor: '#a33434' },
  disabled: { opacity: 0.65 },
  history: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: 1 },
  historyItem: { gap: 2 },
});
