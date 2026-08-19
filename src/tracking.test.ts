import { describe, it, expect } from 'vitest';
import { parseScan } from './tracking';

describe('parseScan', () => {
  it('extracts UPS 1Z numbers, embedded or bare', () => {
    expect(parseScan('1Z999AA10123456784')).toEqual({ tracking: '1Z999AA10123456784', carrier: 'UPS' });
    expect(parseScan('J1Z999AA10123456784XYZ')).toEqual({ tracking: '1Z999AA10123456784', carrier: 'UPS' });
    expect(parseScan('1z999aa10123456784')).toEqual({ tracking: '1Z999AA10123456784', carrier: 'UPS' });
  });

  it('strips the 420+zip routing prefix off USPS IMpb barcodes', () => {
    expect(parseScan('420960149400111899223197428490')).toEqual({
      tracking: '9400111899223197428490',
      carrier: 'USPS',
    });
    expect(parseScan('9400111899223197428490')).toEqual({
      tracking: '9400111899223197428490',
      carrier: 'USPS',
    });
  });

  it('takes the trailing tracking block from FedEx Ground 96 barcodes', () => {
    const barcode = '96' + '1102927810' + '0000000000' + '779841234567'; // 34 digits
    expect(barcode.length).toBe(34);
    const out = parseScan(barcode);
    expect(out.carrier).toBe('FedEx');
    expect(out.tracking.endsWith('779841234567')).toBe(true);
  });

  it('accepts bare FedEx Express (12) and Ground (15) numbers', () => {
    expect(parseScan('779841234567')).toEqual({ tracking: '779841234567', carrier: 'FedEx' });
    expect(parseScan('961102927810000')).toEqual({ tracking: '961102927810000', carrier: 'FedEx' });
  });

  it('keeps the trailing 12 for 20-22 digit numerics', () => {
    expect(parseScan('12345678779841234567')).toEqual({ tracking: '779841234567', carrier: 'FedEx' });
  });

  it('falls through to Other with the cleaned raw value', () => {
    expect(parseScan('  abc-123  ')).toEqual({ tracking: 'ABC-123', carrier: 'Other' });
  });
});
