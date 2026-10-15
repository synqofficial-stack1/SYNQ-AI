type Attachment = { name?: unknown; data_url?: unknown };
type Prior = { role: 'user' | 'model'; content: string };

export function readAIModeInput(body: { attachments?: unknown; initial_history?: unknown; work_context?: unknown }) {
  const attachments = body.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > 7) throw new Error('Attach up to three PDFs and four photos.');
  let total = 0, pdfs = 0, images = 0;
  const parts = attachments.map((value: Attachment) => {
    if (!value || typeof value.data_url !== 'string' || typeof value.name !== 'string') throw new Error('An attached file could not be read. Please attach it again.');
    const match = value.data_url.match(/^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new Error('Only PDF, PNG, JPEG, and WebP files are supported.');
    total += match[2].length;
    if (match[1] === 'application/pdf') pdfs++; else images++;
    if (total > 8_388_608 || pdfs > 3 || images > 4) throw new Error('Keep attached files under 6 MB, with up to three PDFs and four photos.');
    return { inlineData: { mimeType: match[1], data: match[2] } };
  });
  const initial = body.initial_history ?? [];
  if (!Array.isArray(initial) || initial.length > 20) throw new Error('This revised chat is too long. Please start a new chat.');
  const history: Prior[] = initial.map((message) => {
    if (!message || !['user', 'model'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 8000) throw new Error('Invalid chat history.');
    return { role: message.role, content: message.content };
  });
  const context = typeof body.work_context === 'string' ? body.work_context.slice(0, 4000) : '';
  return { parts, history, context };
}
