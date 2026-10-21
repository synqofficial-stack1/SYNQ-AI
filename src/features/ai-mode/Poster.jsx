import React, { useState } from 'react';

// Poster flow: collect details → AI makes a text-free background → we draw the real text + logo on top.
export const POSTER_INTENT = /\b(poster|flyer|banner|post for|creative for|ad for)\b/i;
const OCCASIONS = ['Diwali', 'Holi', 'Eid', 'Christmas', 'New Year', 'Raksha Bandhan', 'Navratri', 'Dussehra', 'Ganesh Chaturthi', 'Onam', 'Pongal', 'Valentine', 'Grand Opening', 'Anniversary'];
export const guessOccasion = (text) => OCCASIONS.find((o) => new RegExp(`\\b${o}\\b`, 'i').test(text)) || '';

const STYLES = {
  Festive: 'joyful celebratory atmosphere, rich colours, warm lighting, tasteful decorations appropriate to the chosen occasion',
  Minimal: 'clean minimal aesthetic, soft pastel gradient, subtle elegant shapes, lots of calm empty space',
  Luxury: 'luxurious dark background, gold accents, elegant silk textures, premium soft lighting',
  Bold: 'bold modern graphic design, bright saturated colours, dynamic abstract shapes, energetic',
};
const SIZES = { Square: { w: 1080, h: 1080, label: 'Square (Instagram post)' }, Story: { w: 1080, h: 1920, label: 'Story / Reel (9:16)' } };

export function buildPrompt(f) {
  const subject = f.details?.trim();
  const occasion = f.occasion?.trim();
  // Only visual context goes to the image model. Canvas adds the exact business/headline later.
  return (subject ? `Main visual subject, required and clearly recognizable: ${subject}. ` : '') +
    (occasion ? `The scene celebrates ${occasion}; this is visual context, not wording to draw. ` : '') +
    `Create only a text-free scene or illustration, not a finished greeting card or advertisement. ` +
    `${STYLES[f.style] || STYLES.Festive}. ` +
    (subject ? `Keep the requested subject prominent in the upper half; style and decorations must not replace or obscure it. ` : '') +
    `Use only decorations that fit this occasion and the requested subject. ` +
    `Leave the lower half simple and uncluttered for a separate text overlay. ` +
    `Absolutely no typography, lettering, greetings, captions, words, watermarks, logos or signs anywhere in the image.`;
}

// ---- Canvas composition ----
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export async function composePoster(bgUrl, f, logoDataUrl) {
  const { w, h } = SIZES[f.size];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  try { await Promise.all([document.fonts.load('700 80px "Source Serif 4"'), document.fonts.load('600 40px Inter')]); } catch { /* fallback fonts */ }

  // Background (cover-fit)
  const bg = await loadImg(bgUrl);
  const s = Math.max(w / bg.width, h / bg.height);
  ctx.drawImage(bg, (w - bg.width * s) / 2, (h - bg.height * s) / 2, bg.width * s, bg.height * s);

  // Readability overlays
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, h * 0.38, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.22);
  top.addColorStop(0, 'rgba(0,0,0,0.45)'); top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top; ctx.fillRect(0, 0, w, h * 0.22);

  const cx = w / 2; const pad = 80; const gold = '#F5C451';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18;

  // Logo (top center, on a white rounded tile)
  let y = 70;
  if (logoDataUrl) {
    const logo = await loadImg(logoDataUrl);
    const box = f.size === 'Story' ? 190 : 150;
    const ls = Math.min((box - 28) / logo.width, (box - 28) / logo.height);
    ctx.save(); ctx.shadowBlur = 24; ctx.fillStyle = '#fff'; roundRect(ctx, cx - box / 2, y, box, box, 28); ctx.fill(); ctx.restore();
    ctx.drawImage(logo, cx - (logo.width * ls) / 2, y + (box - logo.height * ls) / 2, logo.width * ls, logo.height * ls);
    y += box;
  } else if (f.business) {
    ctx.font = '600 38px Inter'; ctx.fillStyle = '#fff';
    ctx.fillText(f.business.toUpperCase(), cx, y + 50);
  }

  // Bottom block, laid out upward from the bottom
  const footer = f.contact?.trim();
  const offer = f.offer?.trim();
  const headSize = f.size === 'Story' ? 118 : 96;
  ctx.font = `700 ${headSize}px "Source Serif 4", Georgia, serif`;
  const headLines = wrap(ctx, f.occasion ? (/^happy|sale|offer|opening/i.test(f.occasion) ? f.occasion : `Happy ${f.occasion}`) : f.business, w - pad * 2);

  let by = h - (f.size === 'Story' ? 170 : 90);
  if (footer) {
    ctx.font = '500 30px Inter'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const fl = wrap(ctx, footer, w - pad * 2).reverse();
    for (const l of fl) { ctx.fillText(l, cx, by); by -= 42; }
    by -= 26;
  }
  if (offer) {
    ctx.font = '700 44px Inter';
    const ol = wrap(ctx, offer, w - pad * 2 - 80);
    const ph = ol.length * 56 + 40; const pw = Math.min(w - pad * 2, Math.max(...ol.map((l) => ctx.measureText(l).width)) + 80);
    ctx.save(); ctx.shadowBlur = 20; ctx.fillStyle = gold; roundRect(ctx, cx - pw / 2, by - ph, pw, ph, ph / 2 > 50 ? 30 : ph / 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = '#2b1a00';
    ol.forEach((l, i) => ctx.fillText(l, cx, by - ph + 20 + 44 + i * 56 - 6));
    ctx.restore();
    by -= ph + 40;
  }
  ctx.font = `700 ${headSize}px "Source Serif 4", Georgia, serif`; ctx.fillStyle = '#fff';
  for (const l of [...headLines].reverse()) { ctx.fillText(l, cx, by); by -= headSize * 1.05; }
  if (f.business && logoDataUrl) {
    ctx.font = '600 34px Inter'; ctx.fillStyle = gold;
    ctx.fillText(f.business.toUpperCase().split('').join(String.fromCharCode(8202)), cx, by - 6);
  }
  return c.toDataURL('image/png');
}

// ---- Form shown inside the chat ----
export function PosterForm({ initial, disabled, onSubmit }) {
  const [f, setF] = useState({ business: '', occasion: '', offer: '', contact: '', details: '', style: 'Festive', size: 'Square', ...initial });
  const [logo, setLogo] = useState(null);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function onLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return setLogo(null);
    if (!file.type.startsWith('image/')) return setErr('Logo must be an image (PNG/JPG).');
    if (file.size > 5 * 1024 * 1024) return setErr('Logo must be under 5 MB.');
    const r = new FileReader(); r.onload = () => { setLogo(r.result); setErr(''); }; r.readAsDataURL(file);
  }
  function submit(e) {
    e.preventDefault();
    if (!f.business.trim() || !f.occasion.trim()) return setErr('Business name and occasion are required.');
    onSubmit({ fields: f, logo, prompt: buildPrompt(f) });
  }

  return (
    <form className="sa-poster-form" onSubmit={submit}>
      <p className="sa-pf-intro">Let’s make your poster. Fill in the details:</p>
      <div className="sa-pf-grid">
        <label>Business name *<input value={f.business} onChange={set('business')} placeholder="e.g. Sharma Sweets" /></label>
        <label>Occasion *<input value={f.occasion} onChange={set('occasion')} placeholder="e.g. Diwali" /></label>
        <label>Offer / headline<input value={f.offer} onChange={set('offer')} placeholder="e.g. 20% OFF on all sweet boxes" /></label>
        <label>Contact / address<input value={f.contact} onChange={set('contact')} placeholder="e.g. Call 98xxxxxx · MG Road" /></label>
        <label className="sa-pf-wide">Background / main subject (optional)<input value={f.details} onChange={set('details')} placeholder="e.g. Santa beside a Christmas tree" /></label>
        <label>Style<select value={f.style} onChange={set('style')}>{Object.keys(STYLES).map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Size<select value={f.size} onChange={set('size')}>{Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="sa-pf-wide">Logo (optional)
          <div className="sa-pf-logo">
            <input type="file" accept="image/*" onChange={onLogo} />
            {logo && <img src={logo} alt="Logo preview" />}
          </div>
        </label>
      </div>
      {err && <p className="sa-pf-err">{err}</p>}
      <button className="sa-upgrade-btn sa-pf-submit" type="submit" disabled={disabled}>Create poster · 2 credits</button>
    </form>
  );
}
