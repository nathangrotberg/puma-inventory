import { parseScan, Carrier } from './tracking';

// A LOCAL guess at what a scanned code is, used only to label the card while
// the proxy resolves it for real. It is deliberately not authoritative:
// measured against the live org on 2026-09-08, 90 of 1,625 asset serial
// numbers match the MaintainX barcode shape exactly and 13 look like carrier
// tracking numbers, so shape cannot separate them. Only a lookup can.
export type GuessKind = 'tracking' | 'mx-barcode' | 'serial';

export interface Guess {
  kind: GuessKind;
  normalized: string;
  carrier?: Carrier;
  /** True when another kind is a real possibility, so the UI can stay vague. */
  ambiguous: boolean;
}

/** MaintainX generates 12 or 13 character upper-alphanumeric barcodes; 4,386 of
 *  the org's 4,518 barcoded parts are that shape. */
const MX_BARCODE = /^[A-Z0-9]{12,13}$/;

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function guessKind(raw: string): Guess {
  const normalized = normalizeCode(raw);
  const parsed = parseScan(raw);

  // A recognised carrier format is the one signal with no measured collisions:
  // zero of 4,518 part barcodes match any carrier pattern. Serials do collide
  // (13 cases), so flag those as ambiguous rather than trusting the shape.
  if (parsed.carrier !== 'Other') {
    return { kind: 'tracking', normalized, carrier: parsed.carrier, ambiguous: true };
  }

  if (MX_BARCODE.test(normalized) && /[A-Z]/.test(normalized) && /\d/.test(normalized)) {
    return { kind: 'mx-barcode', normalized, ambiguous: true };
  }

  return { kind: 'serial', normalized, ambiguous: false };
}

/** Resolution order the proxy applies, kept here so the UI can explain it.
 *  Lookup always beats shape; shape only picks the fallback. */
export const RESOLUTION_ORDER = [
  'exact match on a MaintainX part barcode',
  'exact match on a MaintainX asset serial number',
  'carrier tracking shape with a matching expected shipment',
  'carrier tracking shape with no expected shipment',
  'unknown, offer to create a part or an asset',
] as const;
