import { Linking } from 'react-native';

// How people reach the Synq team. Support runs on WhatsApp, so every "contact
// us" in the app opens a chat with the support number rather than the dialer.

/** The support number as people see it. */
export const SUPPORT_PHONE = '6300840955';

/** wa.me needs the full international number: India's +91, no plus or spaces. */
const WHATSAPP_URL = `https://wa.me/91${SUPPORT_PHONE}`;

/**
 * Opens a WhatsApp chat with Synq support, in the WhatsApp app when it is
 * installed and in WhatsApp Web otherwise. Resolves false if the device could
 * not open the link, so the caller can say so.
 */
export async function openWhatsAppSupport(message?: string): Promise<boolean> {
  const url = message ? `${WHATSAPP_URL}?text=${encodeURIComponent(message)}` : WHATSAPP_URL;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
