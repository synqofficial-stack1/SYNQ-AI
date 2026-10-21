export const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
export function recipientsFrom(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 20000)
    throw new Error('Enter recipient email addresses.');
  const emails = [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!emails.length || emails.length > 50)
    throw new Error('Add between 1 and 50 unique recipients.');
  if (emails.some((e) => !EMAIL.test(e) || e.length > 254))
    throw new Error(
      'One or more email addresses are invalid. Use addresses without display names.',
    );
  return emails;
}
export function questionsFrom(value: unknown, allowEmpty = false): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && !value.length) ||
    value.length > 12 ||
    value.some((q) => typeof q !== 'string' || !q.trim() || q.length > 300)
  )
    throw new Error('Use up to 12 questions, at most 300 characters each.');
  return value.map((q) => q.trim());
}
export function namedRecipients(
  value: unknown,
): { email: string; name: string }[] {
  if (!Array.isArray(value) || !value.length || value.length > 50)
    throw new Error('Add 1–50 recipients.');
  const result = new Map<string, { email: string; name: string }>();
  for (const row of value) {
    if (
      !row ||
      typeof row.email !== 'string' ||
      (row.name != null && typeof row.name !== 'string') ||
      (row.name || '').length > 100 ||
      /[\r\n]/.test(row.name || '')
    )
      throw new Error(
        'Each recipient needs an email and an optional name up to 100 characters.',
      );
    const email = row.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254)
      throw new Error(`Invalid recipient email: ${email.slice(0, 80)}`);
    if (!result.has(email))
      result.set(email, { email, name: (row.name || '').trim() });
  }
  return [...result.values()];
}
export function personalizedBody(body: string, name: string) {
  return body.replace(/\{\{name\}\}/g, name || 'there');
}
export function base64url(value: string): string {
  return btoa(
    Array.from(new TextEncoder().encode(value), (b) =>
      String.fromCharCode(b),
    ).join(''),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function decode64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(
    Uint8Array.from(
      atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    ),
  );
}
export type Part = {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
};
export function header(part: Part, name: string): string {
  return (
    part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value || ''
  );
}
export function emailAddress(value: string): string {
  return (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase();
}
export function messageText(part: Part): string {
  const collect = (p: Part, mime: string): string =>
    [
      p.mimeType === mime && p.body?.data ? decode64(p.body.data) : '',
      ...(p.parts || []).map((child) => collect(child, mime)),
    ]
      .filter(Boolean)
      .join('\n');
  const text =
    collect(part, 'text/plain') ||
    collect(part, 'text/html')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?\s*>|<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  return text.slice(0, 40000);
}
export function originalReply(text: string): string {
  return text
    .split(
      /\n\s*(?:On .{0,300}wrote:|From: .+|_{5,}|-{5,}Original Message-{5,})\s*\n/i,
    )[0]
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .trim()
    .slice(0, 16000);
}
export function mimeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  messageId: string,
): string {
  if (
    ![from, to].every((e) => EMAIL.test(e)) ||
    /[\r\n]/.test(subject) ||
    !/^<[a-zA-Z0-9.-]+@synq\.local>$/.test(messageId)
  )
    throw new Error('Invalid email headers.');
  const encodedBody =
    btoa(
      Array.from(new TextEncoder().encode(body), (b) =>
        String.fromCharCode(b),
      ).join(''),
    )
      .match(/.{1,76}/g)
      ?.join('\r\n') || '';
  return base64url(
    `From: ${from}\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${btoa(Array.from(new TextEncoder().encode(subject), (b) => String.fromCharCode(b)).join(''))}?=\r\nMessage-ID: ${messageId}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`,
  );
}
export type ReplyAnalysis = {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  intent: 'interested' | 'not_interested' | 'needs_information' | 'unclear';
  answers: { question: string; answer: string | null }[];
  themes: string[];
  next_step: string;
  opted_out: boolean;
};
export function validateAnalysis(
  value: unknown,
  questions: string[],
): ReplyAnalysis {
  const v = value as ReplyAnalysis;
  if (
    !v ||
    typeof v.summary !== 'string' ||
    v.summary.length > 2000 ||
    !['positive', 'neutral', 'negative', 'mixed'].includes(v.sentiment) ||
    !['interested', 'not_interested', 'needs_information', 'unclear'].includes(
      v.intent,
    ) ||
    typeof v.next_step !== 'string' ||
    v.next_step.length > 1000 ||
    typeof v.opted_out !== 'boolean' ||
    !Array.isArray(v.themes) ||
    v.themes.length > 5 ||
    v.themes.some((t) => typeof t !== 'string' || t.length > 80) ||
    !Array.isArray(v.answers) ||
    v.answers.length !== questions.length ||
    v.answers.some(
      (a) =>
        !a ||
        (a.answer !== null &&
          (typeof a.answer !== 'string' || a.answer.length > 2000)),
    )
  )
    throw new Error('The reply analysis was incomplete. Retry analysis.');
  return {
    ...v,
    answers: v.answers.map((a, i) => ({
      question: questions[i],
      answer: a.answer,
    })),
    themes: [
      ...new Set(v.themes.map((t) => t.trim().toLowerCase()).filter(Boolean)),
    ],
  };
}
export type ReportRecipient = {
  email: string;
  status: string;
  sent_at: string | null;
  analysis: ReplyAnalysis | null;
};
export function campaignStats(rows: ReportRecipient[], inboundCount: number) {
  const sent = rows.filter((r) => r.sent_at).length;
  const replied = rows.filter((r) => r.status === 'replied').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const uncertain = rows.filter((r) =>
    ['sending', 'uncertain'].includes(r.status),
  ).length;
  const queued = rows.filter((r) => r.status === 'queued').length;
  const waiting = rows.filter((r) => r.status === 'sent').length;
  const sentiment: Record<string, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
    mixed: 0,
  };
  const themes: Record<string, number> = {};
  for (const row of rows)
    if (row.analysis) {
      sentiment[row.analysis.sentiment]++;
      for (const theme of new Set(row.analysis.themes))
        themes[theme] = (themes[theme] || 0) + 1;
    }
  return {
    total: rows.length,
    sent,
    received: inboundCount,
    replied,
    waiting,
    failed,
    uncertain,
    queued,
    response_rate: sent ? Math.round((replied / sent) * 100) : 0,
    analyzed: rows.filter((r) => r.analysis).length,
    sentiment,
    themes: Object.entries(themes)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    replied_to: rows.filter((r) => r.status === 'replied').map((r) => r.email),
    awaiting_reply: rows.filter((r) => r.status === 'sent').map((r) => r.email),
  };
}
