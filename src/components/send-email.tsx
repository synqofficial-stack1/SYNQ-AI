import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { MailIcon, SendIcon } from '@/components/icons';
import { ModalSheet } from '@/components/modal-sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Button, ButtonRow, Field, InlineAlert, LoadingState, showToast } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { connectGmail, gmailStatus, sendDirectEmail, type GmailStatus } from '@/lib/outreach';

// Send one email to one person from the person's own connected Gmail. Nothing
// is sent until they press Send; the server checks the opt-out list and a daily
// cap, and Gmail sends it as them. Bulk outreach stays in Email duties.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendEmailSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const [mailbox, setMailbox] = useState<GmailStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<'send' | 'connect' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    let live = true;
    gmailStatus()
      .then((status) => {
        if (live) {
          setMailbox(status);
          setStatusError('');
        }
      })
      .catch((cause: unknown) => {
        if (live) setStatusError(cause instanceof Error ? cause.message : 'Could not check your Gmail connection.');
      });
    return () => {
      live = false;
    };
  }, [visible]);

  const toError = to.trim() && !EMAIL.test(to.trim()) ? 'Enter one valid email address.' : '';
  const ready = Boolean(mailbox?.connected && EMAIL.test(to.trim()) && subject.trim() && body.trim());

  function close() {
    if (busy === 'send') return;
    setError('');
    onClose();
  }

  async function connect() {
    if (Platform.OS !== 'web') {
      setError('Connect Gmail from the web app first.');
      return;
    }
    setBusy('connect');
    setError('');
    try {
      const { url } = await connectGmail(window.location.origin);
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the Gmail connection.');
      setBusy(null);
    }
  }

  async function send() {
    if (!ready || busy) return;
    setBusy('send');
    setError('');
    try {
      const { from } = await sendDirectEmail({ to, subject, body });
      showToast(`Sent to ${to.trim()} from ${from}.`, 'success');
      setTo('');
      setSubject('');
      setBody('');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The email was not sent. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ModalSheet visible={visible} onClose={close} title="Send an email" description="Sent from your own Gmail, one person at a time." width={560}>
      {statusError ? (
        <InlineAlert tone="danger" message={statusError} />
      ) : !mailbox ? (
        <LoadingState label="Checking your Gmail…" />
      ) : !mailbox.configured ? (
        <InlineAlert tone="warning" message="Gmail sending is not set up on the server yet. Ask the Synq team to finish the Gmail setup." />
      ) : !mailbox.connected ? (
        <View style={[styles.connect, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
          <MailIcon size={20} color={theme.textSecondary} />
          <View style={styles.connectText}>
            <ThemedText type="smallBold">Connect Gmail to send</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              Google asks you to approve sending from your account. You can disconnect it any time in Email duties.
            </ThemedText>
          </View>
          <Button label="Connect Gmail" size="sm" variant="primary" loading={busy === 'connect'} onPress={() => void connect()} />
        </View>
      ) : (
        <ThemedText type="caption" themeColor="textSecondary">
          From {mailbox.email}
        </ThemedText>
      )}
      <Field label="To" required error={toError || undefined}>
        <TextField
          accessibilityLabel="Recipient email"
          value={to}
          onChangeText={setTo}
          placeholder="name@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          maxLength={254}
        />
      </Field>
      <Field label="Subject" required count={{ value: subject.length, max: 200 }}>
        <TextField accessibilityLabel="Subject" value={subject} onChangeText={(value) => setSubject(value.replace(/[\r\n]/g, ' '))} maxLength={200} />
      </Field>
      <Field label="Message" required count={{ value: body.length, max: 10000 }}>
        <TextField accessibilityLabel="Message" value={body} onChangeText={setBody} multiline maxLength={10000} placeholder="Write your email…" />
      </Field>
      {error ? <InlineAlert tone="danger" message={error} /> : null}
      <ButtonRow>
        <Button label="Cancel" variant="ghost" disabled={busy === 'send'} onPress={close} />
        <Button label="Send" variant="primary" icon={SendIcon} loading={busy === 'send'} disabled={!ready} onPress={() => void send()} />
      </ButtonRow>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  connect: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderRadius: Radius.control + 2 },
  connectText: { flex: 1, minWidth: 180, gap: 2 },
});
