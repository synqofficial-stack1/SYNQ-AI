import { Linking, Platform } from 'react-native';

// The only place the app knows how a call is placed. Today there is exactly one
// backend — handing a `tel:` URL to the device dialer, which is real but needs a
// phone. To add a provider (Twilio, Exotel, Plivo), implement `place` against
// their API and pick it here; nothing in the UI has to change.
//
// Automated dialling is regulated. Anyone wiring up a provider is responsible
// for consent, do-not-call lists, and local telecom rules.

export type TelephonyStatus =
  | { available: true; description: string }
  | { available: false; reason: string };

export function telephonyStatus(): TelephonyStatus {
  if (Platform.OS === 'web') {
    return {
      available: false,
      reason: 'Calling integration not configured. Open Synq on your phone to dial.',
    };
  }
  return { available: true, description: "Calls open in your phone's dialer." };
}

/** Keep digits and a leading +; dialers reject the spaces CRM exports contain. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export type DialResult = { ok: true } | { ok: false; message: string };

export async function dial(rawPhone: string | null): Promise<DialResult> {
  const status = telephonyStatus();
  if (!status.available) return { ok: false, message: status.reason };

  const phone = normalizePhone(rawPhone ?? '');
  if (!phone) return { ok: false, message: 'This contact has no phone number.' };

  const url = `tel:${phone}`;
  try {
    if (!(await Linking.canOpenURL(url))) {
      return { ok: false, message: 'This device has no app that can place calls.' };
    }
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not open the dialer.' };
  }
}
