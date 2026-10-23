/**
 * Facts only the business owner can supply. The privacy policy and the account
 * deletion page read them from here and show a visible "draft" notice while any
 * is missing, so a placeholder is never mistaken for a published policy.
 *
 * Google Play rejects a listing whose privacy policy names no operator or
 * contact, so fill every value before submitting.
 */
export const LEGAL: {
  /** Person or company that runs Synq, e.g. "Synq AI Private Limited". */
  operatorName: string | null;
  /** Inbox that answers privacy and deletion requests. */
  contactEmail: string | null;
  /** Date this policy takes effect, e.g. "1 November 2026". */
  effectiveDate: string | null;
  /** Youngest age allowed to use Synq. */
  minimumAge: number | null;
} = {
  operatorName: null,
  contactEmail: null,
  effectiveDate: null,
  minimumAge: null,
};

export const legalDetailsComplete = Object.values(LEGAL).every((value) => value !== null && value !== '');

export const legalValue = (value: string | number | null) => (value === null || value === '' ? '[to be confirmed]' : String(value));
