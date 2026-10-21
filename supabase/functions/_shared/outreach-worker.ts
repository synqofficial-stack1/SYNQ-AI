import { type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  campaignStats,
  emailAddress,
  header,
  messageText,
  mimeMessage,
  originalReply,
  personalizedBody,
  type Part,
  type ReplyAnalysis,
} from './outreach-core.ts';
import { GmailError, gmail, mailboxAccess } from './outreach-gmail.ts';
import { analyzeReplies } from './outreach-ai.ts';

export type Campaign = {
  id: string;
  user_id: string;
  organization_id?: string | null;
  title: string;
  goal: string;
  questions: string[];
  subject: string;
  body: string;
  status: string;
  sender_email: string | null;
  report: unknown;
  report_at: string | null;
};
export type Recipient = {
  id: string;
  campaign_id: string;
  email: string;
  name: string;
  status: string;
  sent_at: string | null;
  outbound_message_id: string | null;
  thread_id: string | null;
  gmail_message_id: string | null;
  last_reply_at: string | null;
  analysis: ReplyAnalysis | null;
  analysis_message_count: number;
  analysis_error: string | null;
  error: string | null;
};
async function saveRecipient(
  db: SupabaseClient,
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await db
    .from('outreach_recipients')
    .update(values)
    .eq('id', id);
  if (error) throw new Error('Could not save recipient progress.');
}
export async function buildReport(db: SupabaseClient, campaign: Campaign) {
  const { data: recipients, error } = await db
    .from('outreach_recipients')
    .select('*')
    .eq('campaign_id', campaign.id)
    .order('email');
  if (error) throw new Error('Could not load report recipients.');
  const ids = (recipients || []).map((r: Recipient) => r.id);
  const { count, error: countError } = ids.length
    ? await db
        .from('outreach_messages')
        .select('id', { count: 'exact', head: true })
        .in('recipient_id', ids)
        .eq('is_auto_reply', false)
    : { count: 0, error: null };
  if (countError) throw new Error('Could not count saved replies.');
  const rows = recipients as Recipient[];
  const report = {
    ...campaignStats(rows, count || 0),
    questions: campaign.questions.map((question, index) => ({
      question,
      answered: rows.filter((r) => r.analysis?.answers[index]?.answer).length,
    })),
    next_steps: rows
      .filter((r) => r.analysis)
      .map((r) => ({
        email: r.email,
        name: r.name,
        summary: r.analysis!.summary,
        next_step: r.analysis!.next_step,
        intent: r.analysis!.intent,
        opted_out: r.analysis!.opted_out,
      })),
    generated_at: new Date().toISOString(),
  };
  const { error: saveError } = await db
    .from('outreach_campaigns')
    .update({ report, report_at: report.generated_at })
    .eq('id', campaign.id);
  if (saveError) throw new Error('Could not save the report.');
  return report;
}

async function reconcileSend(
  db: SupabaseClient,
  token: string,
  row: Recipient,
) {
  if (!row.outbound_message_id) return;
  const found = await gmail(
    token,
    `messages?q=${encodeURIComponent(`in:sent rfc822msgid:${row.outbound_message_id}`)}&maxResults=2`,
  );
  if (found.messages?.length === 1) {
    const metadata = await gmail(
      token,
      `messages/${encodeURIComponent(found.messages[0].id)}?format=metadata`,
    );
    const actualSentAt = metadata.internalDate
      ? new Date(Number(metadata.internalDate)).toISOString()
      : new Date().toISOString();
    await saveRecipient(db, row.id, {
      status: 'sent',
      gmail_message_id: found.messages[0].id,
      thread_id: found.messages[0].threadId,
      sent_at: actualSentAt,
      error: null,
    });
  } else {
    await saveRecipient(db, row.id, {
      status: 'uncertain',
      error:
        'Send confirmation is missing. Check Gmail Sent. SYNQ will not resend automatically.',
    });
  }
}

export async function processCampaign(db: SupabaseClient, campaign: Campaign) {
  const { data: claimed, error: claimError } = await db.rpc(
    'claim_outreach_campaign',
    { p_id: campaign.id },
  );
  if (claimError) throw new Error('Could not lock campaign progress.');
  if (!claimed) return { busy: true };
  const deadline = Date.now() + 90000;
  try {
    if (campaign.organization_id) {
      const { data: member, error } = await db
        .from('organization_members')
        .select('user_id')
        .eq('user_id', campaign.user_id)
        .eq('organization_id', campaign.organization_id)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw new Error('Could not verify company sender access.');
      if (!member) {
        await db
          .from('outreach_campaigns')
          .update({ status: 'paused' })
          .eq('id', campaign.id);
        return { paused: true };
      }
    }
    const { token, email } = await mailboxAccess(db, campaign.user_id);
    if (email !== campaign.sender_email)
      throw new Error(
        'Reconnect the Gmail account used to send this campaign.',
      );
    // Reconcile interrupted sends before considering queued messages. Never
    // retry an ambiguous send: Gmail does not offer an idempotency key.
    const { data: unknown, error: unknownError } = await db
      .from('outreach_recipients')
      .select('*')
      .eq('campaign_id', campaign.id)
      .in('status', ['sending', 'uncertain'])
      .limit(2);
    if (unknownError) throw new Error('Could not load pending confirmations.');
    for (const row of unknown || []) await reconcileSend(db, token, row);
    if (campaign.status === 'active') {
      const { data: queued, error: queueError } = await db
        .from('outreach_recipients')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('status', 'queued')
        .order('email')
        .limit(3);
      if (queueError) throw new Error('Could not load the send queue.');
      for (const row of queued || []) {
        if (Date.now() > deadline) break;
        const { data: current, error: statusError } = await db
          .from('outreach_campaigns')
          .select('status')
          .eq('id', campaign.id)
          .single();
        if (statusError || current.status !== 'active') break;
        const { data: suppressed, error: suppressionError } = await db
          .from('outreach_suppressions')
          .select('email')
          .eq('user_id', campaign.user_id)
          .eq('email', row.email)
          .maybeSingle();
        if (suppressionError)
          throw new Error('Could not check email opt-outs.');
        if (suppressed) {
          await saveRecipient(db, row.id, {
            status: 'failed',
            error: 'This recipient previously asked to stop receiving emails.',
          });
          continue;
        }
        const messageId = `<${row.id}@synq.local>`;
        await saveRecipient(db, row.id, {
          status: 'sending',
          outbound_message_id: messageId,
          error: null,
        });
        let sent;
        try {
          sent = await gmail(token, 'messages/send', {
            method: 'POST',
            body: JSON.stringify({
              raw: mimeMessage(
                email,
                row.email,
                campaign.subject,
                personalizedBody(campaign.body, row.name),
                messageId,
              ),
            }),
          });
        } catch (error) {
          const definitive =
            error instanceof GmailError &&
            error.status >= 400 &&
            error.status < 500;
          await saveRecipient(db, row.id, {
            status: definitive ? 'failed' : 'uncertain',
            error: definitive
              ? error.message
              : 'Gmail send confirmation was interrupted. Check Sent before retrying.',
          });
          if (
            error instanceof GmailError &&
            [401, 403, 429].includes(error.status)
          )
            break;
          continue;
        }
        // If persistence fails after Gmail accepts the email, leave 'sending'
        // for reconciliation instead of placing it back on the send queue.
        await saveRecipient(db, row.id, {
          status: 'sent',
          gmail_message_id: sent.id,
          thread_id: sent.threadId,
          sent_at: new Date().toISOString(),
        });
      }
    }
    const { data: rows, error: rowsError } = await db
      .from('outreach_recipients')
      .select('*')
      .eq('campaign_id', campaign.id)
      .in('status', ['sent', 'replied'])
      .order('last_checked_at', { nullsFirst: true })
      .limit(8);
    if (rowsError) throw new Error('Could not load email threads.');
    // Poll every sent thread; a campaign has at most 50 recipients. Analyze
    // at most two changed recipients per pass to bound runtime and AI spend.
    let analyzed = 0;
    let changed = false;
    for (const row of (rows || []) as Recipient[]) {
      if (Date.now() > deadline) break;
      if (!row.thread_id) continue;
      const thread = await gmail(
        token,
        `threads/${encodeURIComponent(row.thread_id)}?format=full`,
      );
      for (const msg of (thread.messages || []) as {
        id: string;
        internalDate: string;
        payload: Part;
        labelIds?: string[];
      }[]) {
        if (
          msg.id === row.gmail_message_id ||
          msg.labelIds?.includes('SENT') ||
          emailAddress(header(msg.payload, 'From')) !== row.email
        )
          continue;
        const receivedAt = new Date(Number(msg.internalDate)).toISOString();
        if (
          !row.sent_at ||
          Date.parse(receivedAt) < Date.parse(row.sent_at) - 60000
        )
          continue;
        const body = messageText(msg.payload);
        const auto =
          (!!header(msg.payload, 'Auto-Submitted') &&
            header(msg.payload, 'Auto-Submitted').toLowerCase() !== 'no') ||
          /auto_reply|autorespond/i.test(
            header(msg.payload, 'X-Autoreply') +
              ' ' +
              header(msg.payload, 'Precedence'),
          );
        const { data: inserted, error: insertError } = await db
          .from('outreach_messages')
          .upsert(
            {
              recipient_id: row.id,
              gmail_message_id: msg.id,
              sender: row.email,
              body,
              received_at: receivedAt,
              is_auto_reply: auto,
            },
            {
              onConflict: 'recipient_id,gmail_message_id',
              ignoreDuplicates: true,
            },
          )
          .select('id');
        if (insertError) throw new Error('Could not store a received email.');
        if (inserted?.length && !auto) changed = true;
      }
      const { data: messages, error: messagesError } = await db
        .from('outreach_messages')
        .select('body,received_at')
        .eq('recipient_id', row.id)
        .eq('is_auto_reply', false)
        .order('received_at');
      if (messagesError) throw new Error('Could not read saved replies.');
      await saveRecipient(db, row.id, {
        last_checked_at: new Date().toISOString(),
      });
      if (!messages?.length) continue;
      await saveRecipient(db, row.id, {
        status: 'replied',
        last_reply_at: messages[messages.length - 1].received_at,
        ...(messages.length !== row.analysis_message_count
          ? { analysis: null }
          : {}),
      });
      if (
        messages.some((m: { body: string }) =>
          /\b(unsubscribe|remove me|stop emailing|stop sending|do not email|don't email|do not contact)\b/i.test(
            originalReply(m.body),
          ),
        )
      ) {
        const { error: optOutError } = await db
          .from('outreach_suppressions')
          .upsert(
            { user_id: campaign.user_id, email: row.email },
            { onConflict: 'user_id,email' },
          );
        if (optOutError) throw new Error('Could not save an email opt-out.');
      }
      if (messages.length !== row.analysis_message_count && analyzed < 2) {
        analyzed++;
        try {
          const analysis = await analyzeReplies(
            campaign.user_id,
            campaign.questions,
            messages.map((m: { body: string }) => originalReply(m.body)),
            campaign.goal,
          );
          await saveRecipient(db, row.id, {
            analysis,
            analysis_message_count: messages.length,
            analysis_error: null,
          });
          if (analysis.opted_out) {
            const { error: suppressionError } = await db
              .from('outreach_suppressions')
              .upsert(
                { user_id: campaign.user_id, email: row.email },
                { onConflict: 'user_id,email' },
              );
            if (suppressionError)
              throw new Error('Could not save the opt-out.');
          }
          changed = true;
        } catch (error) {
          await saveRecipient(db, row.id, {
            analysis_error:
              error instanceof Error ? error.message : 'Reply analysis failed.',
          });
        }
      }
    }
    const { data: latest, error: latestError } = await db
      .from('outreach_recipients')
      .select('status,analysis_message_count,analysis_error')
      .eq('campaign_id', campaign.id);
    if (latestError) throw new Error('Could not check campaign completion.');
    const allReplied =
      !!latest?.length &&
      latest.every((r: { status: string }) => r.status === 'replied');
    const analysisComplete =
      allReplied &&
      latest!.every(
        (r: {
          analysis_message_count: number;
          analysis_error: string | null;
        }) => r.analysis_message_count > 0 && !r.analysis_error,
      );
    if (
      (allReplied && (!campaign.report || changed)) ||
      (changed && campaign.report)
    )
      await buildReport(db, campaign);
    const { error: saveError } = await db
      .from('outreach_campaigns')
      .update({
        ...(analysisComplete ? { status: 'completed' } : {}),
        last_synced_at: new Date().toISOString(),
        sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaign.id);
    if (saveError) throw new Error('Could not save campaign progress.');
    return { synced: true, all_replied: allReplied };
  } catch (error) {
    await db
      .from('outreach_campaigns')
      .update({
        sync_error:
          error instanceof Error ? error.message : 'Email sync failed.',
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', campaign.id);
    throw error;
  } finally {
    await db
      .from('outreach_campaigns')
      .update({ lease_until: null })
      .eq('id', campaign.id);
  }
}
