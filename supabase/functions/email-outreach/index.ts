import { createClient } from 'jsr:@supabase/supabase-js@2';
import { EMAIL, mimeMessage, namedRecipients, questionsFrom } from '../_shared/outreach-core.ts';
import { aiJson, chargedAI } from '../_shared/outreach-ai.ts';
import { gmail, mailboxAccess } from '../_shared/outreach-gmail.ts';
import {
  buildReport,
  processCampaign,
  type Campaign,
} from '../_shared/outreach-worker.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: CORS });
/** Single emails (Send email) per person per 24 hours. */
const DIRECT_DAILY_LIMIT = 50;
function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label} is required (up to ${max} characters).`);
  return value.trim();
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Sign in first.' }, 401);
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(token);
    if (authError || !user)
      return json({ error: 'Your session expired. Sign in again.' }, 401);
    const body = await req.json();
    if (!body || typeof body !== 'object') throw new Error('Invalid request.');
    if (body.action === 'suggest' || body.action === 'draft') {
      const goal = text(body.goal, 'Campaign goal', 2000);
      const instructions =
        typeof body.instructions === 'string'
          ? body.instructions.slice(0, 2000)
          : '';
      if (body.action === 'suggest') {
        const result = await chargedAI(user.id, async () => {
          const value = (await aiJson(
            'Suggest 3 to 6 short, useful customer research or sales questions tailored to the goal. Return {questions:string[]}. Each question must be under 300 characters. Do not promise products or facts not supplied.',
            { goal, instructions },
          )) as { questions: unknown };
          return { questions: questionsFrom(value.questions) };
        });
        return json(result);
      }
      const questions = questionsFrom(body.questions, true);
      const tone = ['friendly', 'professional', 'concise'].includes(body.tone)
        ? body.tone
        : 'friendly';
      const result = await chargedAI(user.id, async () => {
        const value = (await aiJson(
          'Write a short email tailored to the supplied goal, tone, and instructions. Include all supplied questions in a single email. Start with Hello {{name}}, for optional personalization. Ask the recipient to reply directly. Include a simple sentence offering to stop future emails if requested. No invented claims, links, prices, urgency, or promises. Do not mention internal AI analysis. Return {subject:string,body:string}. Subject max 200 characters, body max 12000 characters. No Markdown code fences.',
          { goal, questions, tone, instructions },
        )) as { subject: unknown; body: unknown };
        const subject = text(value.subject, 'Subject', 200);
        if (/[\r\n]/.test(subject))
          throw new Error('AI returned an invalid subject. Try again.');
        return { subject, body: text(value.body, 'Email', 12000) };
      });
      return json(result);
    }
    if (body.action === 'send_one') {
      // One email to one person from the caller's own connected Gmail. Sent
      // only when the person pressed Send (confirmed), never to an address that
      // opted out, and at most DIRECT_DAILY_LIMIT a day so a mistake or a script
      // cannot spam from someone's account.
      if (body.confirmed !== true)
        throw new Error('Review the email and press Send to confirm.');
      const to = text(body.to, 'Recipient', 254).toLowerCase();
      if (!EMAIL.test(to)) throw new Error('Enter one valid email address.');
      const subject = text(body.subject, 'Subject', 200);
      if (/[\r\n]/.test(subject)) throw new Error('Subject must be one line.');
      const message = text(body.body, 'Message', 10000);
      const { data: optedOut } = await db
        .from('outreach_suppressions')
        .select('email')
        .eq('user_id', user.id)
        .eq('email', to)
        .maybeSingle();
      if (optedOut)
        throw new Error('This person asked not to be emailed, so Synq will not send to them.');
      const { count } = await db
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('kind', 'email.direct_sent')
        .gt('created_at', new Date(Date.now() - 86_400_000).toISOString());
      if ((count ?? 0) >= DIRECT_DAILY_LIMIT)
        throw new Error(`You have sent ${DIRECT_DAILY_LIMIT} emails from Synq today. Try again tomorrow.`);
      const mailbox = await mailboxAccess(db, user.id);
      const sent = await gmail(mailbox.token, 'messages/send', {
        method: 'POST',
        body: JSON.stringify({
          raw: mimeMessage(mailbox.email, to, subject, message, `<${crypto.randomUUID()}@synq.local>`),
        }),
      });
      // Activity only: no recipient, subject or text, like every other event.
      await db.from('events').insert({
        user_id: user.id,
        source: 'outreach',
        kind: 'email.direct_sent',
        severity: 'info',
        summary: 'Sent an email from Gmail',
        meta: {},
      });
      return json({ sent: true, from: mailbox.email, id: sent?.id ?? null });
    }
    if (body.action === 'create') {
      const title = text(body.title, 'Campaign name', 120);
      const goal = text(body.goal, 'Campaign goal', 2000);
      const questions = questionsFrom(body.questions, true);
      const subject = text(body.subject, 'Subject', 200);
      if (/[\r\n]/.test(subject)) throw new Error('Subject must be one line.');
      const message = text(body.body, 'Email', 12000);
      const recipients = namedRecipients(body.recipients);
      const { data, error } = await db.rpc('create_outreach_campaign', {
        p_user: user.id,
        p_title: title,
        p_goal: goal,
        p_questions: questions,
        p_subject: subject,
        p_body: message,
        p_recipients: recipients,
      });
      if (error)
        throw new Error(
          'Could not save your campaign. Check email outreach storage setup.',
        );
      return json({ id: data });
    }
    if (
      typeof body.campaign_id !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(body.campaign_id)
    )
      throw new Error('Choose a saved campaign.');
    // Caller RLS also revokes access to old asset IDs after company removal.
    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    const { data: campaign, error: campaignError } = await caller
      .from('outreach_campaigns')
      .select('*')
      .eq('id', body.campaign_id)
      .maybeSingle();
    if (campaignError || !campaign)
      return json({ error: 'Campaign not found.' }, 404);
    if (body.action !== 'report' && campaign.user_id !== user.id)
      return json(
        { error: 'Only the original sender can manage this email duty.' },
        403,
      );
    const selected = campaign as Campaign;
    if (body.action === 'send') {
      if (body.confirmed !== true)
        throw new Error('Review the email and confirm sending first.');
      if (!['draft', 'paused'].includes(campaign.status))
        throw new Error('This campaign is already active or completed.');
      const mailbox = await mailboxAccess(db, user.id);
      if (campaign.sender_email && campaign.sender_email !== mailbox.email)
        throw new Error(
          'Reconnect the Gmail account that started this campaign.',
        );
      const { data, error } = await db
        .from('outreach_campaigns')
        .update({
          status: 'active',
          sender_email: mailbox.email,
          sync_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id)
        .eq('status', campaign.status)
        .select('id');
      if (error || !data?.length)
        throw new Error('Campaign changed. Refresh and try again.');
      // The UI/worker performs the actual queued send separately, so network
      // retries of this approval cannot send duplicates.
      return json({ approved: true });
    }
    if (body.action === 'pause') {
      const { error } = await db
        .from('outreach_campaigns')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', campaign.id)
        .eq('status', 'active');
      if (error) throw new Error('Could not pause campaign.');
      return json({ paused: true });
    }
    if (body.action === 'sync') {
      if (!['active', 'completed'].includes(campaign.status))
        throw new Error('Send or resume this campaign before syncing.');
      return json(await processCampaign(db, selected));
    }
    if (body.action === 'report')
      return json({ report: await buildReport(db, selected) });
    return json({ error: 'Unknown campaign action.' }, 400);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Email outreach is unavailable.',
      },
      400,
    );
  }
});
