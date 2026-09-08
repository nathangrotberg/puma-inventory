import { describe, it, expect } from 'vitest';
import { guessKind, normalizeCode } from './classify';

describe('normalizeCode', () => {
  it('uppercases and strips all whitespace', () => {
    expect(normalizeCode('  ab 12\tcd ')).toBe('AB12CD');
  });
});

describe('guessKind', () => {
  it('calls a recognised carrier format tracking', () => {
    expect(guessKind('1Z999AA10123456784')).toMatchObject({ kind: 'tracking', carrier: 'UPS' });
    expect(guessKind('9400111899223197428490')).toMatchObject({ kind: 'tracking', carrier: 'USPS' });
    expect(guessKind('779841234567')).toMatchObject({ kind: 'tracking', carrier: 'FedEx' });
  });

  it('calls a 12-13 char mixed alphanumeric a MaintainX barcode', () => {
    // real barcodes read off the live org, CT3 parts, 2026-09-08
    for (const bc of ['3HGZWA5KLRFCB', 'WERI245NB631', 'OU5MD7IS6LE0', '388ZOEDGCGFWE']) {
      expect(guessKind(bc).kind).toBe('mx-barcode');
    }
  });

  it('needs both letters and digits to guess a barcode', () => {
    expect(guessKind('ABCDEFGHIJKL').kind).toBe('serial');
    expect(guessKind('123456789012').kind).not.toBe('mx-barcode'); // 12 digits is FedEx
  });

  it('falls back to serial for the shapes MaintainX serials actually take', () => {
    // real serials off the live org: dashes, spaces, short, long, lowercase
    for (const sn of ['F26-04-M00', '459M96', 'KA424-0116258', '5220BWC01221720977', '000103875']) {
      expect(guessKind(sn).kind).toBe('serial');
    }
  });

  it('marks the collision cases ambiguous so the UI does not overclaim', () => {
    // 90 of 1,625 live serials are 12-13 alnum and indistinguishable by shape
    expect(guessKind('4990511347RN').ambiguous).toBe(true);
    expect(guessKind('KA4211186577').ambiguous).toBe(true);
    // 13 live serials look like carrier tracking numbers
    expect(guessKind('202009280038').ambiguous).toBe(true);
    // a dashed serial cannot be anything else, so it is not ambiguous
    expect(guessKind('F26-04-M00').ambiguous).toBe(false);
  });

  it('is a guess, never a decision: every ambiguous kind still returns a kind', () => {
    const g = guessKind('20SHFE0014263');
    expect(['mx-barcode', 'serial']).toContain(g.kind);
    expect(g.ambiguous).toBe(true);
  });
});
