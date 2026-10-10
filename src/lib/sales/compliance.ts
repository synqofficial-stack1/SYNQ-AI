import type { Prospect } from '@/types/database';

// The gate every prospect passes before Synq dials it.
//
// Synq places these calls itself, which changes what this file is for. When a
// person dials, they see the number and can stop. An autonomous dialler has no
// such moment, so the moment has to be built: a run pauses with its list on
// screen and goes no further until the user confirms it.
//
// What is screened out automatically, and what is escalated to the user:
//
//   No usable number        -> excluded. Nothing to call.
//   Previously said no      -> excluded. A "not interested" or "wrong number"
//                              from any earlier call suppresses that number
//                              permanently, and no confirmation can override it.
//   Public business listing -> needs confirmation. These are businesses found on
//                              a map, listed publicly for customers to ring. That
//                              is a normal thing to call, and it is still the
//                              user's call to make, not the model's.
//   The user's own contacts -> eligible. Already their records.
//
// Note the deliberate absence: there is no do-not-call registry lookup here,
// because India's NCPR is reachable through a telecom operator rather than a
// public API. Pretending to check it would be worse than not checking, so the
// gap is named in the attestation text the user actually reads.

export type Verdict = {
  eligible: boolean;
  /** True when only user confirmation stands between this prospect and a call. */
  needsAttestation: boolean;
  reason: string;
};

/** India's TCCCPR restricts commercial calls to 09:00–21:00 local time. */
const CALL_WINDOW_START_HOUR = 9;
const CALL_WINDOW_END_HOUR = 21;

export function withinCallingWindow(now = new Date()): boolean {
  const hour = now.getHours();
  return hour >= CALL_WINDOW_START_HOUR && hour < CALL_WINDOW_END_HOUR;
}

export function callingWindowNote(now = new Date()): string {
  return withinCallingWindow(now)
    ? 'Inside the 9am–9pm calling window.'
    : 'Outside the 9am–9pm calling window. Calls are held until 9am.';
}

/** Sources whose contacts are the user's own records. */
const USER_OWNED_SOURCES = new Set(['imported_leads', 'manual', 'csv_import']);

/** Rejects anything that cannot be dialled — not a compliance judgement. */
function usablePhone(phone: string | null): boolean {
  if (!phone) return false;
  return phone.replace(/[^\d]/g, '').length >= 8;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

export function screenProspect(
  prospect: Pick<Prospect, 'name' | 'phone' | 'source'>,
  options: { suppressedPhones?: Set<string> } = {}
): Verdict {
  if (!usablePhone(prospect.phone)) {
    return { eligible: false, needsAttestation: false, reason: 'No usable phone number.' };
  }

  if (options.suppressedPhones?.has(normalizePhone(prospect.phone!))) {
    return {
      eligible: false,
      needsAttestation: false,
      reason: 'Already asked not to be contacted. Permanently suppressed.',
    };
  }

  if (USER_OWNED_SOURCES.has(prospect.source)) {
    return { eligible: true, needsAttestation: false, reason: 'Your own contact record.' };
  }

  return {
    eligible: true,
    needsAttestation: true,
    reason: 'Publicly listed business number. Needs your confirmation before dialling.',
  };
}

/**
 * What the user is agreeing to when they approve a run. Shown verbatim above the
 * confirm button — if it is not worth reading, it is not worth having.
 */
export const ATTESTATION_TERMS = [
  'These are business numbers listed publicly for customers to call.',
  'Synq has not checked them against the national do-not-call registry. That check runs through a telecom operator and no provider is connected.',
  'The voice agent says it is an AI at the start of every call.',
  'Anyone who asks not to be called again is added to your suppression list and never dialled again.',
  'Calls are placed between 9am and 9pm only.',
];

/** Phone numbers that must never be dialled again, normalised for comparison. */
export function suppressionSetFrom(
  calls: { outcome: string; phone: string | null }[]
): Set<string> {
  const suppressed = new Set<string>();
  for (const call of calls) {
    if (!call.phone) continue;
    if (call.outcome === 'not_interested' || call.outcome === 'wrong_number') {
      suppressed.add(normalizePhone(call.phone));
    }
  }
  return suppressed;
}
