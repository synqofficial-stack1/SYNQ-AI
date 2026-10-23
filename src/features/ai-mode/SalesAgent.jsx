import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './SalesAgent.css';
import { PosterForm, composePoster, POSTER_INTENT, guessOccasion } from './Poster.jsx';
import { createBridge, loadHistory, storageFor, removeCloudChats, refreshImages, moveCloudChat } from './bridge';
import { DEPARTMENTS, DEPT_KEYS, detectDept, buildWorkContext } from './departments.js';
import { ChatPanel, HistoryView, HistoryIcons, exportChats } from './ChatHistory.jsx';
import { readAttachment, kindOf, MAX_PDFS, MAX_IMAGES, MAX_TOTAL_BYTES, LIMIT_MSG, fmtMB } from './attachments.js';

const SUGGESTIONS = [
  { title: 'Plan my week', text: 'What should my sales team focus on this week? Ask me for any numbers you need.' },
  { title: 'Market trends', text: 'What are the current buying trends for small businesses adopting AI tools?' },
  { title: 'Cold email', text: 'Write a short cold email to a small business owner for our product.' },
  { title: 'Create a poster', text: 'Make a festive poster for my shop' },
];

// Detect "make/generate/draw ... poster/image/photo..." so users don't have to press the Image button.
const IMAGE_INTENT = /\b(generate|create|make|draw|design|give me|show me)\b[\s\S]{0,60}\b(image|images|photo|photos|picture|pic|poster|banner|logo|flyer|thumbnail|illustration|graphic|visual|wallpaper)\b/i;
const looksLikeImageRequest = (t) => IMAGE_INTENT.test(t) || /^(image|photo|poster|picture)\s*(of|for)\b/i.test(t.trim());

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
// Tiny, safe markdown renderer (escapes HTML first, then formats).
function renderMarkdown(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  const parts = esc(src).split(/```/);
  let html = '';
  parts.forEach((part, i) => {
    if (i % 2 === 1) { html += `<pre><code>${part.replace(/^\w*\n/, '')}</code></pre>`; return; }
    let list = null;
    let table = null; // rows of a markdown table being collected
    const flushTable = () => {
      if (!table) return;
      const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => inline(c.trim()));
      html += '<div class="sa-table"><table><thead><tr>' + cells(rows[0]).map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
        + rows.slice(1).map((r) => '<tr>' + cells(r).map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
      table = null;
    };
    const close = () => { if (list) { html += `</${list}>`; list = null; } flushTable(); };
    for (const raw of part.split('\n')) {
      const line = raw.trimEnd();
      let m;
      if (/^\s*\|.*\|\s*$/.test(line)) { if (list) { html += `</${list}>`; list = null; } (table ||= []).push(line); continue; }
      flushTable();
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) { close(); html += `<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`; }
      else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
      else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { close(); html += '<hr>'; }
      else if (line.trim() === '') { close(); }
      else { close(); html += `<p>${inline(line)}</p>`; }
    }
    close();
  });
  return html;
}

function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--sa-accent)" />
      <rect x="8" y="17" width="4" height="7" rx="1.5" style={{ fill: "var(--sa-on-accent)" }} />
      <rect x="14" y="12" width="4" height="12" rx="1.5" style={{ fill: "var(--sa-on-accent)" }} />
      <rect x="20" y="8" width="4" height="16" rx="1.5" style={{ fill: "var(--sa-on-accent)" }} />
    </svg>
  );
}

const Icon = {
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  menu: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  close: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></svg>,
  image: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>,
};

export default function SalesAgent({
  userId,
  onOpenCalls,
  agentName = 'Sales Manager',
  companyName = 'Synq',
  apiUrl = '/api/chat',
  imageApiUrl = '/api/image',
  usageUrl = '/api/usage',
  upgradeUrl = '/upgrade',
  embedded = false,       // true = shown inside the Synq dashboard (its own sidebar is hidden)
  dept: deptProp,         // department chosen by the dashboard page (e.g. 'sales', 'general')
  onDeptChange,           // tell the dashboard when the user switches department inside the AI
  onClose,                // "Exit AI mode"
  theme,                  // 'synq' = dark dashboard theme, 'synq-light' = light dashboard theme
  initialPrompt,          // a message handed over from the dashboard's Ask Synq box
  onPromptSent,           // tells the dashboard the handed-over message has been sent
}) {
  const clientId = userId;
  const store = useMemo(() => storageFor(userId), [userId]);
  const fetch = useMemo(() => createBridge(userId), [userId]);
  const [syncError, setSyncError] = useState('');
  const [chats, setChats] = useState(() => store.get('sa_chats', []));
  useEffect(() => {
    let live = true;
    loadHistory(userId).then((items) => { if (live) setChats((current) => { const seen = new Set(current.map(c => c.id)); return [...current, ...items.filter(c => !seen.has(c.id))]; }); }).catch(() => { if (live) setSyncError('Could not load older account chats. Your saved chats on this browser are still available.'); });
    return () => { live = false; };
  }, [userId]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [usage, setUsage] = useState(null); // { used, limit, remaining }
  const [usageError, setUsageError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [deptMode, setDeptMode] = useState(() => deptProp || 'sales'); // 'auto' or a department key
  const [lastDept, setLastDept] = useState(() => deptProp || 'sales');
  const [askOpen, setAskOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyView, setHistoryView] = useState(false); // full-screen chat history
  const [pending, setPending] = useState([]); // attachments waiting to be sent: { id, kind, name, status, ... }
  const [attachError, setAttachError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);            // lets the Stop button cancel the reply
  const [streaming, setStreaming] = useState(false);
  const [editing, setEditing] = useState(null); // { index, attachments } when changing an earlier message
  const [panelOpen, setPanelOpen] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 860 ? false : store.get('sa_chat_panel', true)));
  const askRef = useRef(null);
  const historyRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const active = chats.find((c) => c.id === activeId) || null;
  const messages = useMemo(() => active?.messages || [], [active]);
  const limitReached = usage && usage.remaining <= 0;
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  // Department shown right now: the open chat's department, else the chosen/last one
  const currentDept = active?.dept || (deptMode !== 'auto' ? deptMode : lastDept) || 'sales';
  const D = DEPARTMENTS[currentDept];
  agentName = D.role;

  // Storage failure is an external-system result that must be shown to the user.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!store.set('sa_chats', chats)) setSyncError('Browser storage is full. Export important chats from History before closing this page.'); }, [chats, store]);
  useEffect(() => { let live = true; refreshImages(store.get('sa_chats', [])).then(items => { if (live) setChats(current => current.map(chat => { const fresh = items.find(item => item.id === chat.id && item.updatedAt === chat.updatedAt); return fresh || chat; })); }); return () => { live = false; }; }, [store]);
  useEffect(() => { store.set('sa_dept_mode', deptMode); }, [deptMode, store]);
  useEffect(() => { store.set('sa_chat_panel', panelOpen); }, [panelOpen, store]);
  useEffect(() => { store.set('sa_last_dept', lastDept); }, [lastDept, store]);
  useEffect(() => {
    if (!askOpen && !historyOpen) return;
    const close = (e) => {
      if (askRef.current && !askRef.current.contains(e.target)) setAskOpen(false);
      if (historyRef.current && !historyRef.current.contains(e.target)) setHistoryOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') { setAskOpen(false); setHistoryOpen(false); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [askOpen, historyOpen]);

  // A navigation change resets the composer to that page's assistant while keeping history.
  const [previousDept, setPreviousDept] = useState(deptProp);
  if (deptProp && previousDept !== deptProp && DEPARTMENTS[deptProp]) {
    setPreviousDept(deptProp);
    setDeptMode(deptProp);
    setLastDept(deptProp);
    if (active && active.dept !== deptProp) setActiveId(null);
  }

  function chooseDept(mode) {
    setDeptMode(mode);
    if (mode !== 'auto') {
      setLastDept(mode);
      if (active && active.messages?.length && (active.dept || 'sales') !== mode) setActiveId(null); // new dept → fresh chat
      onDeptChange?.(mode);
    }
    setAskOpen(false);
    inputRef.current?.focus();
  }
  const recentCount = (key) => chats.filter((c) => (key === 'general' || (c.dept || 'sales') === key) && c.messages?.length).length;
  function continueWork() {
    setAskOpen(false);
    const dept = currentDept;
    setActiveId(null);
    setTimeout(() => send(`Catch me up on my ongoing ${DEPARTMENTS[dept].label} work and tell me what to do next.`, false, dept, true), 0);
  }

  const refreshUsage = useCallback(() => fetch(`${usageUrl}?clientId=${clientId}`)
    .then(async response => {
      const u = await response.json();
      if (!response.ok || typeof u.remaining !== 'number') throw new Error(u.error || 'Could not load your credits.');
      return u;
    })
    .then(u => { setUsage(u); setUsageError(''); })
    .catch(e => setUsageError(e.message || 'Could not load your credits.')), [fetch, usageUrl, clientId]);
  useEffect(() => {
    refreshUsage();
    const interval = setInterval(refreshUsage, 60_000);
    window.addEventListener('focus', refreshUsage);
    return () => { clearInterval(interval); window.removeEventListener('focus', refreshUsage); };
  }, [refreshUsage]);
  useEffect(() => {
    if (!usage?.resets_at) return;
    const delay = Date.parse(usage.resets_at) - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(refreshUsage, delay + 100);
    return () => clearTimeout(timer);
  }, [usage?.resets_at, refreshUsage]);
  const resetLabel = usage?.resets_at ? `Resets ${new Date(usage.resets_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Resets 24 hours after your first request';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const updateChat = (id, msgs) =>
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, messages: msgs, updatedAt: Date.now() } : c)));

  // ---- Chat management (used by the Chats panel and the full history view) ----
  const togglePin = (id) => setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
  const renameChat = (id, title) => setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  const moveChat = async (id, dept) => {
    try {
      await moveCloudChat(userId, id, dept);
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, dept } : c)));
      if (id === activeId) {
        setDeptMode(dept);
        setLastDept(dept);
        onDeptChange?.(dept);
      }
      setSyncError('');
    } catch {
      setSyncError('Could not move this chat between departments. Please try again.');
    }
  };
  const deleteChats = async (ids) => { try { await removeCloudChats(userId, ids); } catch { setSyncError('Could not delete these chats. Please try again.'); return; } setChats((prev) => prev.filter((c) => !ids.includes(c.id))); if (ids.includes(activeId)) setActiveId(null); };
  function openFromList(id) {
    const c = chats.find((x) => x.id === id);
    setActiveId(id); setHistoryView(false);
    if (embedded && window.innerWidth < 860) setPanelOpen(false);
    if (c?.dept && deptProp && c.dept !== deptProp) onDeptChange?.(c.dept);
  }

  // A prompt handed over from the dashboard's Ask Synq box is sent once, in a
  // fresh chat, exactly as if it had been typed here. `send` is a new
  // function every render, so the effect reads the latest one through a ref.
  const sendRef = useRef(null);
  const sentPrompt = useRef(null);
  useEffect(() => { sendRef.current = send; });
  useEffect(() => {
    if (!initialPrompt || sentPrompt.current === initialPrompt) return;
    sentPrompt.current = initialPrompt;
    sendRef.current?.(initialPrompt, undefined, undefined, true);
    onPromptSent?.();
  }, [initialPrompt, onPromptSent]);

  function newChat() { setPending([]); setEditing(null); setHistoryView(false); setActiveId(null); setInput(''); setSidebarOpen(false); inputRef.current?.focus(); }
  function openChat(id) { setActiveId(id); setSidebarOpen(false); }
  function deleteChat(id, e) {
    e.stopPropagation();
    deleteChats([id]);
  }

  // ---- Attachments (PDFs + photos) ----
  async function addFiles(fileList) {
    setAttachError('');
    const files = [...fileList];
    const pdfs = pending.filter((a) => a.kind === 'pdf').length;
    const imgs = pending.filter((a) => a.kind === 'image').length;
    let p = 0; let i = 0;
    let total = pending.reduce((n, a) => n + (a.size || 0), 0);
    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) { setAttachError(`${file.name}: only PDFs and photos are supported.`); continue; }
      if (total + file.size > MAX_TOTAL_BYTES) {
        setAttachError(file.size > MAX_TOTAL_BYTES ? `${file.name} is ${fmtMB(file.size)}. ${LIMIT_MSG}` : `Adding ${file.name} would go over 6 MB for this message. ${LIMIT_MSG}`);
        continue;
      }
      total += file.size;
      if (kind === 'pdf' && pdfs + ++p > MAX_PDFS) { setAttachError(`Max ${MAX_PDFS} PDFs per message.`); continue; }
      if (kind === 'image' && imgs + ++i > MAX_IMAGES) { setAttachError(`Max ${MAX_IMAGES} photos per message.`); continue; }
      const id = newId();
      setPending((prev) => [...prev, { id, kind, name: file.name, status: 'loading', size: file.size }]);
      readAttachment(file, clientId)
        .then((a) => setPending((prev) => prev.map((x) => (x.id === id ? { ...x, ...a, status: 'ready' } : x))))
        .catch((err) => { setPending((prev) => prev.filter((x) => x.id !== id)); setAttachError(err.message); });
    }
    inputRef.current?.focus();
  }
  const removePending = (id) => setPending((prev) => prev.filter((x) => x.id !== id));
  const readyAttachments = pending.filter((a) => a.status === 'ready');
  const stillLoading = pending.some((a) => a.status === 'loading');

  // ---- Stop / edit ----
  function stopReply() { abortRef.current?.abort(); }
  function startEdit(index) {
    if (loading) return;
    const m = messages[index];
    if (!m || m.role !== 'user') return;
    setEditing({ index, attachments: m.attachments || [] });
    setInput(m.content || '');
    setHistoryView(false);
    setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0);
  }
  function addToPrompt() {
    // Stop the current reply and reopen the last message so the user can add what they forgot
    const idx = messages.map((m) => m.role).lastIndexOf('user');
    if (loading) stopReply();
    setTimeout(() => startEdit(idx), 60);
  }
  function cancelEdit() { setEditing(null); setInput(''); }

  async function copyMessage(text, key) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
  }
  function downloadMessage(m, i) {
    const title = (active?.title || 'synq-ai') + (i ? ` - reply ${i}` : '');
    exportChats([{ title, dept: active?.dept, updatedAt: active?.updatedAt || 0, messages: [m] }]);
  }

  async function send(text, forceImage, forceDept, freshChat = false) {
    const attachments = text === undefined ? [...(editing?.attachments || []), ...readyAttachments.map(({ id, status, ...a }) => a)] : [];
    const content = (text ?? input).trim();
    if ((!content && !attachments.length) || loading || limitReached || (text === undefined && stillLoading)) return;
    const hasFiles = attachments.length > 0;
    setAttachError('');
    const reviewish = /review|rating|feedback|testimonial/i.test(content + ' ' + attachments.map((a) => a.name + ' ' + (a.text || '').slice(0, 3000)).join(' '));
    // Which department handles this message
    const dept = forceDept || (deptMode !== 'auto' ? deptMode : ((hasFiles && reviewish ? 'general' : null) || detectDept(content) || (freshChat ? null : active?.dept) || lastDept || 'sales'));
    setLastDept(dept);
    if (deptProp && dept !== deptProp) onDeptChange?.(dept); // keep the dashboard sidebar in sync
    const asImage = !hasFiles && (forceImage ?? (imageMode || looksLikeImageRequest(content)));
    const asCalls = !hasFiles && forceImage === undefined && /\b(call|phone|dial)\b.{0,40}\b(customer|number|lead|client|\+?91)\b/i.test(content);
    const asPoster = !hasFiles && !asCalls && forceImage === undefined && POSTER_INTENT.test(content);
    if (asImage && !asPoster && !asCalls && usage && usage.remaining < 2) {
      setAttachError('An image needs 2 credits. You can still send a chat for 1 credit. Upgrade for more credits and added benefits, or wait for your reset.');
      return;
    }

    let chatId = freshChat ? null : activeId;
    const userMsg = hasFiles ? { role: 'user', content, attachments } : { role: 'user', content };
    // When editing an earlier message, everything after it is replaced by the new reply
    const base = freshChat ? [] : editing && text === undefined ? messages.slice(0, editing.index) : messages;
    if (editing) setEditing(null);
    const history = [...base, userMsg];
    if (hasFiles) { setPending([]); setAttachError(''); }
    if (!chatId) {
      chatId = newId();
      const base = content || (reviewish ? `Review analysis: ${attachments[0].name}` : `Report: ${attachments[0].name}`);
      const title = base.length > 42 ? base.slice(0, 42) + '…' : base;
      setChats((prev) => [...prev, { id: chatId, title, dept, messages: [], updatedAt: Date.now() }]);
      setActiveId(chatId);
    } else {
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, dept } : c)));
    }
    if (asCalls) {
      updateChat(chatId, [...history, { role: 'assistant', type: 'call-plan', content: 'Phone calling is paused. Open Sales to create an email duty, add recipients and questions, and review your message before sending.' }]);
      setInput('');
      return;
    }
    if (asPoster) {
      // Ask for details first — no AI call yet, so no usage is spent.
      updateChat(chatId, [...history, { role: 'assistant', type: 'poster-form', content: '[Asked the user for poster details]', initial: { occasion: guessOccasion(content) } }]);
      setInput('');
      return;
    }
    updateChat(chatId, [...history, { role: 'assistant', content: '', pendingImage: asImage }]);
    setInput('');
    setLoading(true);

    if (asImage) {
      try {
        const res = await fetch(imageApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, prompt: content, dept }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 402) { setUsage(data); updateChat(chatId, [...history, { role: 'assistant', content: data.error }]); return; }
        if (!res.ok || !data.url) throw new Error(data.error || 'Image generation failed. Please try again.');
        updateChat(chatId, [...history, { role: 'assistant', content: `[Generated an image for: ${content}]`, image: data.url, imagePath: data.path }]);
      } catch (err) {
        updateChat(chatId, [...history, { role: 'assistant', content: err.message }]);
      } finally {
        setLoading(false);
        refreshUsage();
      }
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    let acc = '';
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, chatId, messages: history, dept, edited: Boolean(editing), context: buildWorkContext(chats, dept, chatId) }),
        signal: ctrl.signal,
      });
      if (res.status === 402) {
        const u = await res.json();
        setUsage(u);
        updateChat(chatId, [...history, { role: 'assistant', content: u.error }]);
        return;
      }
      if (!res.ok || !res.body) { const detail = await res.json().catch(() => ({})); throw new Error(detail.error || 'Request failed'); }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        updateChat(chatId, [...history, { role: 'assistant', content: acc }]);
      }
    } catch (error) {
      if (ctrl.signal.aborted) {
        updateChat(chatId, [...history, { role: 'assistant', content: acc ? `${acc}\n\n*Stopped.*` : '*Stopped waiting for this reply.*', stopped: true }]);
      } else {
        updateChat(chatId, [...history, { role: 'assistant', content: error.message || 'Something went wrong. Please try again.' }]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setLoading(false);
      refreshUsage();
      inputRef.current?.focus();
    }
  }

  async function createPoster(index, { fields, logo, prompt }) {
    const chatId = activeId;
    const before = messages.slice(0, index);
    const summary = `[Created a ${fields.occasion} poster for ${fields.business}${fields.offer ? ` — ${fields.offer}` : ''}]`;
    updateChat(chatId, [...before, { role: 'assistant', content: '', pendingImage: true }]);
    setLoading(true);
    try {
      const size = fields.size === 'Story' ? { width: 1080, height: 1920 } : { width: 1080, height: 1080 };
      const res = await fetch(imageApiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, prompt, dept: currentDept, ...size }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) { setUsage(data); updateChat(chatId, [...before, { role: 'assistant', type: 'poster-form', initial: fields, error: data.error }]); return; }
      if (!res.ok || !data.url) throw new Error(data.error || 'Poster background failed. Please try again.');
      const png = await composePoster(data.url, fields, logo);
      const saved = await fetch('/api/save-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, dataUrl: png, dept: currentDept, prompt: summary }),
      }).then((r) => r.json());
      if (!saved.url) throw new Error('Could not save the poster.');
      updateChat(chatId, [...before, { role: 'assistant', content: summary, image: saved.url, imagePath: saved.path }]);
    } catch (err) {
      updateChat(chatId, [...before, { role: 'assistant', type: 'poster-form', content: '[Asked the user for poster details]', initial: fields, error: err.message }]);
    } finally {
      setLoading(false);
      refreshUsage();
    }
  }

  const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const usagePct = usage ? (usage.limit > 0 ? (usage.remaining / usage.limit) * 100 : 0) : 100;
  const usageLevel = !usage ? '' : usage.remaining <= 0 ? 'out' : usage.remaining <= 10 ? 'low' : '';

  const composer = limitReached ? (
    <div className="sa-limit">
      <div>
        <strong>You’ve used all {usage.limit} credits for this 24-hour period.</strong>
        <span>{resetLabel}. Upgrade for more credits and added benefits.</span>
      </div>
      <a className="sa-upgrade-btn" href={upgradeUrl}>Upgrade plan</a>
    </div>
  ) : (
    <form
      className={`sa-composer ${pending.length ? 'has-files' : ''} ${dragOver ? 'drag' : ''}`}
      onSubmit={(e) => { e.preventDefault(); send(); }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
    >
      {editing && (
        <div className="sa-edit-bar">
          <span>✏️ Editing your message. Add what you forgot, then send. This creates a revised reply.</span>
          <button type="button" onClick={cancelEdit}>Cancel</button>
        </div>
      )}
      {(pending.length > 0 || attachError) && (
        <div className="sa-attach-area">
          {pending.length > 0 && (
            <div className="sa-attach-list">
              {pending.map((a) => (
                <div key={a.id} className={`sa-attach ${a.status}`}>
                  {a.kind === 'image' && a.dataUrl ? <img src={a.dataUrl} alt="" /> : <span className="sa-attach-ico">{a.kind === 'pdf' ? 'PDF' : 'IMG'}</span>}
                  <span className="sa-attach-name">
                    <b>{a.name}</b>
                    <small>{a.status === 'loading' ? (a.kind === 'pdf' ? 'Reading PDF…' : 'Preparing…') : a.kind === 'pdf' ? 'PDF ready' : 'Photo'}</small>
                  </span>
                  <button type="button" onClick={() => removePending(a.id)} aria-label={`Remove ${a.name}`}>×</button>
                </div>
              ))}
            </div>
          )}
          {attachError && (
            <div className="sa-attach-err">
              <span>{attachError}</span>
              {/Upgrade/.test(attachError) && <a href={upgradeUrl}>Upgrade</a>}
            </div>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple hidden
        onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
      <button type="button" className="sa-attach-btn" onClick={() => fileRef.current?.click()} title="Attach PDF or photos" aria-label="Attach PDF or photos">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
      </button>
      <button
        type="button"
        className={`sa-mode ${imageMode ? 'on' : ''}`}
        onClick={() => { setImageMode((v) => !v); inputRef.current?.focus(); }}
        aria-pressed={imageMode}
        title="Generate an image"
      >{Icon.image}<span>Image</span></button>
      <textarea
        ref={inputRef}
        rows={1}
        value={input}
        placeholder={imageMode ? 'Describe the image you want…' : pending.length ? 'Add a note (optional): e.g. "make a report" or "reply to the bad reviews"' : `Ask your ${agentName.toLowerCase()} anything…`}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Message"
      />
      {streaming ? (
        <div className="sa-live-actions">
          <button type="button" className="sa-addmore" onClick={addToPrompt} title="Stop and add more to your message">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            <span>Add to prompt</span>
          </button>
          <button type="button" className="sa-send sa-stop" onClick={stopReply} aria-label="Stop response" title="Stop response">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
          </button>
        </div>
      ) : (
        <button type="submit" className="sa-send" disabled={(!input.trim() && !readyAttachments.length && !editing?.attachments?.length) || loading || stillLoading} aria-label="Send">{Icon.send}</button>
      )}
    </form>
  );

  return (
    <div className={`sa-app ${embedded ? 'sa-embedded' : ''} ${theme ? `sa-theme-${theme}` : ''}`}>
      {/* ---------- Sidebar ---------- */}
      {!embedded && <>
      <aside className={`sa-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sa-side-top">
          <div className="sa-brand"><Logo size={24} /><span>{companyName} <b>AI</b></span></div>
          <button className="sa-icon-btn sa-only-mobile" onClick={() => setSidebarOpen(false)} aria-label="Close menu">{Icon.close}</button>
        </div>
        <button className="sa-newchat" onClick={newChat}>{Icon.plus}<span>New chat</span></button>
        <div className="sa-recents-label">Recents</div>
        <nav className="sa-recents">
          {sorted.length === 0 && <p className="sa-empty-recents">Your chats will show up here.</p>}
          {sorted.map((c) => (
            <div
              key={c.id}
              className={`sa-recent ${c.id === activeId ? 'active' : ''}`}
              onClick={() => openChat(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && openChat(c.id)}
            >
              <i className="sa-dept-dot" style={{ background: DEPARTMENTS[c.dept || 'sales'].color }} title={DEPARTMENTS[c.dept || 'sales'].label} />
              <span className="sa-recent-title">{c.title}</span>
              <button className="sa-recent-del" onClick={(e) => deleteChat(c.id, e)} aria-label="Delete chat">{Icon.trash}</button>
            </div>
          ))}
        </nav>
        <div className="sa-side-footer">
          <div className="sa-plan"><span>Your plan</span><small>{usage ? `${usage.limit} credits / 24 hours` : ''}</small></div>
          <a className="sa-upgrade-link" href={upgradeUrl}>Upgrade</a>
        </div>
      </aside>
      {sidebarOpen && <div className="sa-scrim" onClick={() => setSidebarOpen(false)} />}
      </>}
      {embedded && panelOpen && (
        <>
          <ChatPanel chats={chats} activeId={activeId} currentDept={currentDept}
            onOpen={openFromList} onNew={() => { newChat(); if (window.innerWidth < 860) setPanelOpen(false); }}
            onClose={() => setPanelOpen(false)} onTogglePin={togglePin} />
          <div className="sa-cp-scrim" onClick={() => setPanelOpen(false)} />
        </>
      )}

      {/* ---------- Main ---------- */}
      <div className="sa-root">
        <header className="sa-header">
          <div className="sa-header-left">
            {!embedded && <button className="sa-icon-btn sa-only-mobile" onClick={() => setSidebarOpen(true)} aria-label="Open menu">{Icon.menu}</button>}
            {embedded && !panelOpen && <button className="sa-icon-btn sa-panel-open" onClick={() => setPanelOpen(true)} title="Open chats panel" aria-label="Open chats panel">{HistoryIcons.panel}</button>}
            <div className="sa-ask" ref={askRef}>
              <button className={`sa-ask-btn ${askOpen ? 'open' : ''}`} onClick={() => setAskOpen((v) => !v)} aria-expanded={askOpen} aria-haspopup="dialog">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" /><path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z" /></svg>
                <span className="sa-ask-label">Ask Synq AI</span>
                <span className="sa-ask-dept"><i className="sa-dept-dot" style={{ background: D.color }} />{deptMode === 'auto' && !active?.dept ? `Auto · ${D.label}` : D.label}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {askOpen && (
                <div className="sa-ask-pop" role="dialog" aria-label="Ask Synq AI">
                  <div className="sa-ask-title">Which department should help?</div>
                  <button className={`sa-dept-opt ${deptMode === 'auto' ? 'on' : ''}`} onClick={() => chooseDept('auto')}>
                    <i className="sa-dept-dot sa-dept-auto" />
                    <span><b>Auto-detect</b><small>Picks the department from what you type</small></span>
                  </button>
                  {DEPT_KEYS.map((k) => (
                    <button key={k} className={`sa-dept-opt ${deptMode === k ? 'on' : ''}`} onClick={() => chooseDept(k)}>
                      <i className="sa-dept-dot" style={{ background: DEPARTMENTS[k].color }} />
                      <span><b>{DEPARTMENTS[k].label}</b><small>{DEPARTMENTS[k].role}{recentCount(k) ? ` · ${recentCount(k)} recent chat${recentCount(k) === 1 ? '' : 's'}` : ''}</small></span>
                    </button>
                  ))}
                  <button className="sa-continue" onClick={continueWork} disabled={loading || limitReached}>
                    <span>Continue where I left off</span>
                    <small>{recentCount(currentDept) ? `Picks up your ${recentCount(currentDept)} recent ${D.label} chat${recentCount(currentDept) === 1 ? '' : 's'}` : `Start your ${D.label} work`}</small>
                  </button>
                </div>
              )}
            </div>
            <span className="sa-chat-title">{active ? active.title : ''}</span>
          </div>
          <div className="sa-header-right">
          {embedded && (
            <div className="sa-history">
              <button className="sa-icon-btn" onClick={newChat} title="New chat" aria-label="New chat">{Icon.plus}</button>
              <button className={`sa-icon-btn ${historyView ? 'on' : ''}`} onClick={() => setHistoryView((v) => !v)} title="All chat history" aria-label="All chat history">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>
              </button>
            </div>
          )}
          {usage && (
            <div className={`sa-usage ${usageLevel}`} title={`${usage.used} of ${usage.limit} credits used. ${resetLabel}. Chat: 1 credit; image: 2 credits.`}>
              <div className="sa-usage-text"><b>{usage.remaining}</b> / {usage.limit} credits left</div>
              <div className="sa-usage-bar"><div style={{ width: `${usagePct}%` }} /></div>
            </div>
          )}
          {embedded && onClose && (
            <button className="sa-exit" onClick={onClose} title="Exit AI mode">{Icon.close}<span>Close AI mode</span></button>
          )}
          </div>
        </header>

        {syncError && <div className="sa-sync-error" role="status">{syncError} <button onClick={() => setSyncError('')}>Dismiss</button></div>}
        {usageError && <div className="sa-sync-error" role="status">{usageError} <button onClick={refreshUsage}>Retry</button></div>}
        <div className="sa-credit-info">
          <span>Chat: 1 credit · Image or poster: 2 credits{usage ? ` · ${resetLabel}` : ''}</span>
          <a href={upgradeUrl}>Upgrade for more credits and added benefits</a>
        </div>
        {historyView ? (
          <HistoryView chats={chats} activeId={activeId} onOpen={openFromList} onBack={() => setHistoryView(false)}
            onNew={newChat} onDelete={deleteChats} onRename={renameChat} onTogglePin={togglePin} onMove={moveChat} />
        ) : messages.length === 0 ? (
          <main className="sa-welcome">
            <Logo size={44} />
            <h1>{D.hello}</h1>
            <p className="sa-sub">Your AI {D.role.toLowerCase()}: {D.sub.charAt(0).toLowerCase() + D.sub.slice(1)}</p>
            {composer}
            {!limitReached && (
              <div className="sa-suggestions">
                {(D.suggestions || SUGGESTIONS).map((s) => (
                  <button key={s.title} onClick={() => send(s.text, s.image ? true : undefined)}>
                    <strong>{s.title}</strong>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            )}
          </main>
        ) : (
          <>
            <main className="sa-thread" ref={scrollRef}>
              <div className="sa-thread-inner">
                {messages.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="sa-msg sa-user-wrap">
                      {m.attachments?.length > 0 && (
                        <div className="sa-user-files">
                          {m.attachments.map((a, j) => a.kind === 'image'
                            ? <img key={j} src={a.dataUrl} alt={a.name} className="sa-user-img" />
                            : <div key={j} className="sa-attach ready"><span className="sa-attach-ico">PDF</span><span className="sa-attach-name"><b>{a.name}</b><small>{a.pages} page{a.pages === 1 ? '' : 's'}</small></span></div>)}
                        </div>
                      )}
                      {m.content && <div className="sa-user">{m.content}</div>}
                      {!loading && (
                        <button className="sa-edit-msg" onClick={() => startEdit(i)} title="Edit and resend" aria-label="Edit message">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>Edit
                        </button>
                      )}
                    </div>
                  ) : (
                    <div key={i} className="sa-msg sa-ai">
                      <div className="sa-ai-icon"><Logo size={22} /></div>
                      {m.type === 'call-plan' ? (
                        <div className="sa-pf-wrap">
                          <p>{m.content}</p><button className="sa-btn-secondary" onClick={onOpenCalls}>Open email outreach →</button>
                        </div>
                      ) : m.type === 'poster-form' ? (
                        <div className="sa-pf-wrap">
                          {m.error && <p className="sa-pf-err">{m.error}</p>}
                          <PosterForm initial={m.initial} disabled={loading || limitReached} onSubmit={(d) => createPoster(i, d)} />
                        </div>
                      ) : m.image ? (
                        <figure className="sa-image">
                          <img src={m.image} alt={m.content} loading="lazy" />
                          <a href={m.image} download target="_blank" rel="noreferrer">Open / download</a>
                        </figure>
                      ) : m.content ? (
                        <div className="sa-md-wrap">
                          <div className="sa-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                          {!(loading && i === messages.length - 1) && m.content.length > 60 && (
                            <div className="sa-msg-actions">
                              <button onClick={() => copyMessage(m.content, i)}>{copied === i ? '✓ Copied' : 'Copy'}</button>
                              <button onClick={() => downloadMessage(m, i)}>Download</button>
                            </div>
                          )}
                        </div>
                      ) : m.pendingImage ? (
                        <div className="sa-image-loading">Creating your image…</div>
                      ) : (
                        <div className="sa-typing"><span /><span /><span /></div>
                      )}
                    </div>
                  )
                )}
              </div>
            </main>
            <div className="sa-bottom">
              {composer}
              <p className="sa-disclaimer">AI can make mistakes. Verify market data before acting on it.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
