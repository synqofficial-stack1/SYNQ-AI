// Reading files the user attaches: PDFs → text (via the server), photos → compressed JPEG.
export const MAX_PDFS = 3;
export const MAX_IMAGES = 4;
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024; // 15 MB for all files in one message (free plan)
const MAX_PDF_BYTES = MAX_TOTAL_BYTES;
const MAX_IMAGE_BYTES = MAX_TOTAL_BYTES;
export const LIMIT_MSG = 'Files can be up to 6 MB per message.';
export const fmtMB = (b) => (b / 1024 / 1024).toFixed(b < 1024 * 1024 ? 2 : 1) + ' MB';

const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

async function compressImage(file, maxSide = 1600, quality = 0.85) {
  const url = await readAsDataURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // flatten transparent PNGs
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export function kindOf(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

// Returns an attachment object: { kind, name, ... } or throws with a friendly message
export async function readAttachment(file, clientId) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name}: only PDFs and photos are supported.`);
  if (kind === 'pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name} is ${fmtMB(file.size)}. ${LIMIT_MSG}`);
    const data = await readAsDataURL(file);
    return { kind, name: file.name, dataUrl: data, size: file.size };
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is ${fmtMB(file.size)}. ${LIMIT_MSG}`);
  return { kind, name: file.name, dataUrl: await compressImage(file), size: file.size };
}
