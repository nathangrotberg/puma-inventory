export type Carrier = 'UPS' | 'FedEx' | 'USPS' | 'Other';

export interface Parsed {
  tracking: string;
  carrier: Carrier;
}

// Normalize a scanned barcode into the tracking number a shipment is keyed by.
// Shipping labels often encode more than the bare tracking number (routing
// prefixes, zip codes, application identifiers); these rules extract the part
// the carrier's own tracking site accepts.
export function parseScan(rawInput: string): Parsed {
  const raw = rawInput.trim().toUpperCase().replace(/\s+/g, '');

  // UPS: 1Z + 16 alphanumeric, sometimes embedded in a longer string
  const ups = raw.match(/1Z[0-9A-Z]{16}/);
  if (ups) return { tracking: ups[0], carrier: 'UPS' };

  // USPS IMpb: optional 420+zip routing prefix, then 9x + 21-25 digits
  let m = raw.match(/^420\d{5}(?:\d{4})?(9[1-5]\d{20,24})$/);
  if (m) return { tracking: m[1], carrier: 'USPS' };
  m = raw.match(/^(9[1-5]\d{20,24})$/);
  if (m) return { tracking: m[1], carrier: 'USPS' };

  // FedEx Ground 96 barcode: 34 digits, tracking is the trailing block
  if (/^96\d{32}$/.test(raw)) {
    const tail = raw.slice(-15).replace(/^0+/, '');
    return { tracking: tail.length >= 12 ? tail : raw.slice(-12), carrier: 'FedEx' };
  }

  // FedEx door tag / long numeric forms: keep the trailing 12
  if (/^\d{20,22}$/.test(raw)) return { tracking: raw.slice(-12), carrier: 'FedEx' };

  // FedEx Ground (15 digits) and Express (12 digits)
  if (/^\d{15}$/.test(raw)) return { tracking: raw, carrier: 'FedEx' };
  if (/^\d{12}$/.test(raw)) return { tracking: raw, carrier: 'FedEx' };

  return { tracking: raw, carrier: 'Other' };
}
