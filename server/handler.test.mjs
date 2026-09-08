import { describe, it, expect, beforeEach } from 'vitest';
import { handle, __setIndex, ALLOCATION_FIELDS, GENERAL_INVENTORY } from './handler.mjs';

// Fixtures modelled on records read out of org 62357 on 2026-09-08, including
// the duplicate-barcode and duplicate-serial cases that actually exist there.
const LOCATIONS = [
  { id: 4362293, name: 'Redding, CA', parentId: null },
  { id: 3579125, name: 'CT3 - Court St 3: Tech Hub (1716 Court St)', parentId: 4362293 },
  { id: 395602, name: 'VIS - Visalia Office', parentId: null },
  { id: 4287939, name: 'BKD - Brooksco', parentId: 4287937 },
];
const PARTS = [
  {
    id: 501,
    name: 'Redlion - DA50',
    barcode: 'OU5MD7IS6LE0',
    unitCost: 129479,
    locations: [{ locationId: 3579125, availableQuantity: 8 }],
    extraFields: { 'Model and/or Part Number': 'RLDA50A0BNN0000030' },
  },
  { id: 502, name: 'Emergency Stop Sign', barcode: 'QSBO05U3VZF6', unitCost: 846, locations: [] },
  // 73 barcodes in the live org are duplicated; this is that shape
  { id: 601, name: 'Dup part A', barcode: 'XJYZY89I9Q85', unitCost: 1000, locations: [] },
  { id: 602, name: 'Dup part B', barcode: 'XJYZY89I9Q85', unitCost: 1000, locations: [] },
  { id: 700, name: 'GWS oddity', barcode: 'GWSNEG123456', unitCost: 500, locations: [{ locationId: 395602, availableQuantity: -3 }] },
];
const ASSETS = [
  { id: 15755767, name: 'P.W. - Red Lion DA50 - 0031', serialNumber: 'YU29AUG2400031', locationId: 3579125 },
  // a serial that is indistinguishable from a MaintainX barcode by shape
  { id: 900, name: 'Compressor', serialNumber: 'KA4211186577', locationId: 395602 },
  // 96 serials in the live org are duplicated
  { id: 910, name: 'Pump A', serialNumber: '539090344RN', locationId: 395602 },
  { id: 911, name: 'Pump B', serialNumber: '539090344RN', locationId: 4287939 },
];

const BASE = { MX_KEY: 'test-key', MX_INDEX_TTL_MS: '999999' };
const post = (body, env = BASE) =>
  handle(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }), env);
const asJson = async (res) => JSON.parse(await res.text());

beforeEach(() => __setIndex(PARTS, ASSETS, LOCATIONS));

describe('mx-resolve', () => {
  it('matches a part barcode and names the reason', async () => {
    const r = await asJson(await post({ action: 'mx-resolve', code: 'ou5md7is6le0' }));
    expect(r.kind).toBe('part');
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].name).toBe('Redlion - DA50');
    expect(r.parts[0].locations[0].locationName).toContain('CT3');
    expect(r.reason).toMatch(/part barcode/);
  });

  it('returns every part sharing a duplicated barcode rather than guessing', async () => {
    const r = await asJson(await post({ action: 'mx-resolve', code: 'XJYZY89I9Q85' }));
    expect(r.parts.map((p) => p.id).sort()).toEqual([601, 602]);
    expect(r.reason).toMatch(/2 parts share this barcode/);
  });

  it('matches an asset serial', async () => {
    const r = await asJson(await post({ action: 'mx-resolve', code: 'YU29AUG2400031' }));
    expect(r.kind).toBe('asset');
    expect(r.assets[0].id).toBe(15755767);
  });

  it('returns every asset sharing a duplicated serial', async () => {
    const r = await asJson(await post({ action: 'mx-resolve', code: '539090344RN' }));
    expect(r.assets.map((a) => a.id).sort()).toEqual([910, 911]);
    expect(r.reason).toMatch(/2 assets share this serial/);
  });

  it('LOOKUP BEATS SHAPE: a serial shaped like a barcode still resolves as an asset', async () => {
    const r = await asJson(await post({ action: 'mx-resolve', code: 'KA4211186577' }));
    expect(r.kind).toBe('asset');
    expect(r.assets[0].name).toBe('Compressor');
  });

  it('falls back to tracking only when nothing in MaintainX matches', async () => {
    const r = await asJson(
      await post({ action: 'mx-resolve', code: '1Z999AA10123456784', tracking: { tracking: '1Z999AA10123456784', carrier: 'UPS' } }),
    );
    expect(r.kind).toBe('tracking');
    expect(r.reason).toMatch(/UPS/);
  });

  it('prefers a MaintainX hit over a supplied tracking guess', async () => {
    const r = await asJson(
      await post({ action: 'mx-resolve', code: 'OU5MD7IS6LE0', tracking: { tracking: 'x', carrier: 'FedEx' } }),
    );
    expect(r.kind).toBe('part');
  });

  it('reports unknown honestly', async () => {
    const r = await asJson(await post({ action: 'mx-resolve', code: 'F26-04-M00' }));
    expect(r.kind).toBe('unknown');
    expect(r.parts).toHaveLength(0);
    expect(r.assets).toHaveLength(0);
  });

  it('handles an empty code without throwing', async () => {
    const r = await asJson(await post({ action: 'mx-resolve', code: '   ' }));
    expect(r.kind).toBe('unknown');
    expect(r.reason).toBe('empty code');
  });
});

describe('mx-receive, writes withheld', () => {
  it('withholds the write and returns the exact request it would have sent', async () => {
    const r = await asJson(
      await post({
        action: 'mx-receive',
        code: 'OU5MD7IS6LE0',
        target: { kind: 'part', partId: 501 },
        locationId: 3579125,
        facilityHandle: 'BKD',
        quantity: 2,
        poNumber: 'BKD-260336-RW-II',
      }),
    );
    expect(r.dryRun).toBe(true);
    expect(r.wouldSend).toHaveLength(1);
    expect(r.wouldSend[0]).toMatchObject({ method: 'PATCH', path: 'parts/501' });
    expect(r.warnings.some((w) => /nothing was sent to MaintainX/.test(w))).toBe(true);
  });

  it('adds quantity to the existing location row rather than replacing it', async () => {
    const r = await asJson(
      await post({
        action: 'mx-receive', code: '', target: { kind: 'part', partId: 501 },
        locationId: 3579125, facilityHandle: 'BKD', quantity: 2,
      }),
    );
    expect(r.wouldSend[0].body.locations).toEqual([{ locationId: 3579125, availableQuantity: 10 }]);
  });

  it('appends a new location row when the part is not stocked there yet', async () => {
    const r = await asJson(
      await post({
        action: 'mx-receive', code: '', target: { kind: 'part', partId: 501 },
        locationId: 395602, facilityHandle: 'BKD', quantity: 3,
      }),
    );
    expect(r.wouldSend[0].body.locations).toEqual([
      { locationId: 3579125, availableQuantity: 8 },
      { locationId: 395602, availableQuantity: 3 },
    ]);
  });

  it('never sends the deprecated top-level locationId or availableQuantity', async () => {
    const r = await asJson(
      await post({
        action: 'mx-receive', code: '', target: { kind: 'part', partId: 501 },
        locationId: 3579125, facilityHandle: 'BKD', quantity: 1,
      }),
    );
    const body = r.wouldSend[0].body;
    expect(body).not.toHaveProperty('locationId');
    expect(body).not.toHaveProperty('availableQuantity');
  });

  it('carries allocation in externalId while the custom fields do not exist, and says so', async () => {
    const r = await asJson(
      await post({
        action: 'mx-receive', code: '', target: { kind: 'part', partId: 501 },
        locationId: 3579125, facilityHandle: 'BKD', poNumber: 'BKD-260336-RW-II', quantity: 1,
      }),
    );
    expect(r.wouldSend[0].body.externalId).toBe('BKD|BKD-260336-RW-II');
    expect(r.wouldSend[0].body).not.toHaveProperty('extraFields');
    expect(r.warnings.some((w) => w.includes('MX_ALLOCATION_FIELDS_READY'))).toBe(true);
  });

  it('uses the real custom fields once they are marked ready', async () => {
    const r = await asJson(
      await post(
        {
          action: 'mx-receive', code: '', target: { kind: 'part', partId: 501 },
          locationId: 3579125, facilityHandle: 'BKD', poNumber: 'BKD-260336-RW-II', quantity: 1,
        },
        { ...BASE, MX_ALLOCATION_FIELDS_READY: 'true' },
      ),
    );
    expect(r.wouldSend[0].body.extraFields).toEqual({
      [ALLOCATION_FIELDS.facility]: 'BKD',
      [ALLOCATION_FIELDS.po]: 'BKD-260336-RW-II',
    });
    expect(r.wouldSend[0].body).not.toHaveProperty('externalId');
  });

  it('defaults a missing facility handle to GENERAL_INVENTORY and warns', async () => {
    const r = await asJson(
      await post({ action: 'mx-receive', code: '', target: { kind: 'part', partId: 501 }, locationId: 3579125 }),
    );
    expect(r.wouldSend[0].body.externalId).toBe(`${GENERAL_INVENTORY}|`);
    expect(r.warnings.some((w) => /no facilityHandle/.test(w))).toBe(true);
  });

  it('creates a new part with the scanned code as its barcode and cost in cents', async () => {
    const r = await asJson(
      await post({
        action: 'mx-receive', code: 'newbarcode123', target: { kind: 'newPart', name: 'Phoenix terminal block', unitCostCents: 42500 },
        locationId: 3579125, facilityHandle: 'DLD', quantity: 25,
      }),
    );
    expect(r.wouldSend[0]).toMatchObject({ method: 'POST', path: 'parts' });
    expect(r.wouldSend[0].body).toMatchObject({
      name: 'Phoenix terminal block',
      barcode: 'NEWBARCODE123',
      unitCost: 42500,
      locations: [{ locationId: 3579125, availableQuantity: 25 }],
    });
  });

  it('warns that a sub-$100 part is bench stock', async () => {
    const r = await asJson(
      await post({
        action: 'mx-receive', code: 'x', target: { kind: 'newPart', name: 'Fuse', unitCostCents: 450 },
        locationId: 3579125, facilityHandle: 'DLD', quantity: 50,
      }),
    );
    expect(r.warnings.some((w) => /bench stock/.test(w))).toBe(true);
  });

  it('moves an asset by locationId and warns when a new asset has no serial', async () => {
    const moved = await asJson(
      await post({
        action: 'mx-receive', code: '', target: { kind: 'asset', assetId: 15755767 },
        locationId: 4287939, facilityHandle: 'BKD',
      }),
    );
    expect(moved.wouldSend[0]).toMatchObject({ method: 'PATCH', path: 'assets/15755767' });
    expect(moved.wouldSend[0].body.locationId).toBe(4287939);

    const created = await asJson(
      await post({
        action: 'mx-receive', code: '', target: { kind: 'newAsset', name: 'P.W. - Pulsar - 9999' },
        locationId: 3579125, facilityHandle: GENERAL_INVENTORY,
      }),
    );
    expect(created.warnings.some((w) => /no serial number/.test(w))).toBe(true);
  });

  it('errors clearly on a missing location, an unknown part and a bad target', async () => {
    expect((await asJson(await post({ action: 'mx-receive', target: { kind: 'part', partId: 501 } }))).error)
      .toMatch(/locationId is required/);
    expect((await asJson(await post({ action: 'mx-receive', target: { kind: 'part', partId: 99999 }, locationId: 3579125 }))).error)
      .toMatch(/not found/);
    expect((await asJson(await post({ action: 'mx-receive', target: { kind: 'nope' }, locationId: 3579125 }))).error)
      .toMatch(/unknown target kind/);
  });

  it('flags an unknown locationId instead of silently accepting it', async () => {
    const r = await asJson(
      await post({ action: 'mx-receive', target: { kind: 'part', partId: 501 }, locationId: 12345, facilityHandle: 'BKD' }),
    );
    expect(r.warnings.some((w) => /not a known MaintainX location/.test(w))).toBe(true);
  });
});

describe('mx-onhand', () => {
  it('reports only the requested locations and skips zero-quantity rows', async () => {
    const r = await asJson(await post({ action: 'mx-onhand', locationIds: [3579125] }));
    expect(r.parts.map((p) => p.id)).toEqual([501]); // 502 has no stock anywhere
    expect(r.assets.map((a) => a.id)).toEqual([15755767]);
    expect(r.locations[0]).toMatchObject({ locationId: 3579125, partLines: 1, assets: 1 });
  });

  it('keeps negative quantities visible rather than dropping them', async () => {
    const r = await asJson(await post({ action: 'mx-onhand', locationIds: [395602] }));
    const neg = r.parts.find((p) => p.id === 700);
    expect(neg.locations[0].availableQuantity).toBe(-3);
  });
});

describe('mx-issue', () => {
  it('reassigns a part to a facility through the same write path', async () => {
    const r = await asJson(
      await post({
        action: 'mx-issue', target: { kind: 'part', partId: 501 },
        toFacilityHandle: 'BKD', toLocationId: 4287939, quantity: 1,
      }),
    );
    expect(r.wouldSend[0].path).toBe('parts/501');
    expect(r.wouldSend[0].body.externalId).toBe('BKD|');
    expect(r.wouldSend[0].body.locations).toEqual([
      { locationId: 3579125, availableQuantity: 8 },
      { locationId: 4287939, availableQuantity: 1 },
    ]);
  });
});

describe('dispatch', () => {
  it('answers CORS preflight and rejects unknown actions and non-JSON bodies', async () => {
    expect((await handle(new Request('http://x/', { method: 'OPTIONS' }), BASE)).status).toBe(204);
    expect((await post({ action: 'nope' })).status).toBe(400);
    expect(
      (await handle(new Request('http://x/', { method: 'POST', body: 'not json' }), BASE)).status,
    ).toBe(400);
  });

  it('refuses to run without a key', async () => {
    const res = await post({ action: 'mx-onhand' }, { MX_INDEX_TTL_MS: '999999' });
    expect(res.status).toBe(500);
    expect((await asJson(res)).error).toMatch(/MX_KEY/);
  });

  it('health reports whether writes are on', async () => {
    const off = await asJson(await handle(new Request('http://x/health'), BASE));
    expect(off.writesEnabled).toBe(false);
    const on = await asJson(await handle(new Request('http://x/health'), { ...BASE, MX_ALLOW_WRITES: 'true' }));
    expect(on.writesEnabled).toBe(true);
  });
});
