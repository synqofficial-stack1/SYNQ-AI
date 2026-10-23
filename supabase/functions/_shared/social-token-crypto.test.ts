import { decryptToken, encryptToken } from './social-token-crypto.ts';

Deno.test('social tokens roundtrip through the existing AES-GCM v1 format', async () => {
  Deno.env.set('SOCIAL_TOKEN_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  const encrypted = await encryptToken('test-token-do-not-use');
  if (!encrypted.startsWith('v1.')) throw new Error('Unexpected token encryption format.');
  if (await decryptToken(encrypted) !== 'test-token-do-not-use') throw new Error('Token did not decrypt to its original value.');
  if (await decryptToken(null) !== null) throw new Error('Null token should remain null.');
});
