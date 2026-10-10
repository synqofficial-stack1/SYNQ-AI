const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get('SOCIAL_TOKEN_ENCRYPTION_KEY')?.trim();
  if (!encoded) throw new Error('Social account encryption is not set up on the server.');

  const raw = /^[\da-f]{64}$/i.test(encoded)
    ? Uint8Array.from(encoded.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16))
    : base64UrlDecode(encoded);
  if (raw.byteLength !== 32) {
    throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes.');
  }

  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(value: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    await encryptionKey(),
    encoder.encode(value)
  );
  return `v1.${base64UrlEncode(nonce)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptToken(value: string | null): Promise<string | null> {
  if (value === null) return null;
  const [version, nonce, encrypted, extra] = value.split('.');
  if (version !== 'v1' || !nonce || !encrypted || extra !== undefined) {
    throw new Error('Stored social login is not encrypted with the current format. Reconnect the account.');
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(nonce) },
    await encryptionKey(),
    base64UrlDecode(encrypted)
  );
  return decoder.decode(plaintext);
}
