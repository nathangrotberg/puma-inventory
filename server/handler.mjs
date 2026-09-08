/**
 * MaintainX write/read proxy for the PUMA Works inventory app (O51).
 *
 * Why this exists: the app is a static bundle on GitHub Pages, so it cannot
 * hold a MaintainX bearer token. This handler keeps the token server-side and
 * exposes exactly four actions. It is written as a plain
 * `handle(request, env)` so it runs unchanged behind a container, an Azure
 * Function or a Worker; `local.mjs` runs it on a port.
 *
 * SAFETY: writes are OFF unless env.MX_ALLOW_WRITES === 'true'. With writes
 * off, every mutating action returns `dryRun: true` plus `wouldSend`, the exact
 * requests it withheld, and still performs the live GETs so the response shows
 * real current state. That is what makes a dry run reviewable rather than
 * theatre.
 */

const API = 'https://api.getmaintainx.com/v1';

/** Labels of the MaintainX part/asset custom fields O51 allocation needs.
 *  They do not exist in org 62357 as of 2026-09-08 and are not API-creatable,
 *  so someone has to add them in MaintainX Settings. Until then the proxy
 *  carries allocation in `externalId` and says so in every response. */
export const ALLOCATION_FIELDS = { facility: 'Facility Handle', po: 'PO Number' };

export const GENERAL_INVENTORY = 'GENERAL_INVENTORY';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// ---------------------------------------------------------------- MaintainX IO

async function mxFetch(env, path, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.MX_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, body };
}

async function mxAll(env, path) {
  const out = [];
  let cursor;
  for (;;) {
    const qs = new URLSearchParams({ limit: '200' });
    if (cursor) qs.set('cursor', cursor);
    const r = await mxFetch(env, `${path}?${qs}`);
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    const key = Object.keys(r.body).find((k) => Array.isArray(r.body[k]));
    out.push(...r.body[key]);
    cursor = r.body.nextCursor;
    if (!cursor) return out;
  }
}

// ------------------------------------------------------------------- the index
// MaintainX has no server-side barcode or serial filter (verified 2026-08-20
// and again 2026-09-08: /v1/parts and /v1/assets accept only limit and
// cursor). So a scan lookup means scanning every record, and that is only
// viable against a warm in-process index. A cold build is ~48 API calls.

let cache = null;

function indexRecords(parts, assets, locations) {
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const byBarcode = new Map();
  const bySerial = new Map();
  for (const p of parts) {
    if (!p.barcode) continue;
    const k = String(p.barcode).trim().toUpperCase();
    if (!byBarcode.has(k)) byBarcode.set(k, []);
    byBarcode.get(k).push(p);
  }
  for (const a of assets) {
    if (!a.serialNumber) continue;
    const k = String(a.serialNumber).trim().toUpperCase();
    if (!bySerial.has(k)) bySerial.set(k, []);
    bySerial.get(k).push(a);
  }
  return { parts, assets, locations, locName, byBarcode, bySerial, builtAt: Date.now() };
}

export async function getIndex(env, { force = false } = {}) {
  const ttl = Number(env.MX_INDEX_TTL_MS ?? 300000);
  if (!force && cache && Date.now() - cache.builtAt < ttl) return cache;
  const [parts, assets, locations] = await Promise.all([
    mxAll(env, 'parts'),
    mxAll(env, 'assets'),
    mxAll(env, 'locations'),
  ]);
  cache = indexRecords(parts, assets, locations);
  return cache;
}

/** Test seam: load a fixture index without touching the network. */
export function __setIndex(parts, assets, locations) {
  cache = indexRecords(parts, assets, locations);
  return cache;
}

// ------------------------------------------------------------------- shaping

function shapePart(p, ix) {
  return {
    id: p.id,
    name: p.name ?? '',
    barcode: p.barcode ?? null,
    unitCostCents: p.unitCost ?? null,
    locations: (p.locations || []).map((l) => ({
      locationId: l.locationId,
      locationName: ix?.locName.get(l.locationId) ?? null,
      availableQuantity: Number(l.availableQuantity ?? 0),
    })),
    extraFields: p.extraFields ?? {},
    externalId: p.externalId ?? null,
  };
}

function shapeAsset(a, ix) {
  return {
    id: a.id,
    name: a.name ?? '',
    serialNumber: a.serialNumber ?? null,
    locationId: a.locationId ?? null,
    locationName: a.locationId ? (ix?.locName.get(a.locationId) ?? null) : null,
    extraFields: a.extraFields ?? {},
    externalId: a.externalId ?? null,
  };
}

// ---------------------------------------------------------------- allocation

/** The two allocation fields do not exist yet, so allocation rides in
 *  externalId until they do. Returns the patch fragment plus any warning. */
function allocationPayload(env, facilityHandle, poNumber) {
  const ready = String(env.MX_ALLOCATION_FIELDS_READY) === 'true';
  const handle = facilityHandle || GENERAL_INVENTORY;
  if (ready) {
    const extraFields = { [ALLOCATION_FIELDS.facility]: handle };
    if (poNumber) extraFields[ALLOCATION_FIELDS.po] = poNumber;
    return { fragment: { extraFields }, warnings: [] };
  }
  return {
    fragment: { externalId: [handle, poNumber || ''].join('|') },
    warnings: [
      `MaintainX custom fields "${ALLOCATION_FIELDS.facility}" and "${ALLOCATION_FIELDS.po}" do not ` +
        `exist yet, so allocation is being carried in externalId as "${handle}|${poNumber || ''}". ` +
        `Create both fields in MaintainX Settings, then set MX_ALLOCATION_FIELDS_READY=true.`,
    ],
  };
}

// ------------------------------------------------------------------- actions

async function resolve(env, req) {
  const normalized = String(req.code ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const out = {
    code: req.code ?? '',
    normalized,
    kind: 'unknown',
    parts: [],
    assets: [],
    dataQuality: [],
    reason: '',
  };
  if (!normalized) return { ...out, reason: 'empty code' };

  const ix = await getIndex(env);

  // Lookup beats shape, always. Barcode first: measured on 2026-09-08, zero of
  // 4,518 part barcodes collide with any carrier tracking pattern, so a
  // barcode hit is never a misread shipping label.
  const pHits = ix.byBarcode.get(normalized);
  if (pHits?.length) {
    return {
      ...out,
      kind: 'part',
      parts: pHits.map((p) => shapePart(p, ix)),
      dataQuality:
        pHits.length > 1
          ? [`This barcode is on ${pHits.length} part records. 73 barcodes in the org are duplicated; pick the right one.`]
          : [],
      reason:
        pHits.length > 1
          ? `${pHits.length} parts share this barcode; pick one (73 barcodes in the org are duplicated)`
          : 'exact match on a MaintainX part barcode',
    };
  }

  const aHits = ix.bySerial.get(normalized);
  if (aHits?.length) {
    const dataQuality = [];
    if (aHits.length > 1) {
      const locs = new Set(aHits.map((a) => a.locationId));
      dataQuality.push(
        `This serial is on ${aHits.length} asset records` +
          (locs.size > 1 ? ` in ${locs.size} different locations` : '') +
          `. One physical unit should be one record; picking the wrong one moves the wrong asset.`,
      );
      // A "serial" shared by many unrelated assets is usually not a serial at
      // all: 18DEC25 sits in the serialNumber field of six Red Lion HMIs.
      if (aHits.length >= 4) {
        dataQuality.push(
          `${aHits.length} records share it, which normally means the value is not really a serial number ` +
            `(a date or a batch code typed into the field). Worth fixing in MaintainX rather than receiving against.`,
        );
      }
      const pw = aHits.filter((a) => (a.name || '').toUpperCase().startsWith('P.W.')).length;
      if (pw && pw < aHits.length) {
        dataQuality.push(
          `One record is PUMA-named (P.W. -) and another is not, so the same unit is being counted twice ` +
            `under two naming schemes. Receive against the P.W. record and merge the other.`,
        );
      }
    }
    return {
      ...out,
      kind: 'asset',
      assets: aHits.map((a) => shapeAsset(a, ix)),
      dataQuality,
      reason:
        aHits.length > 1
          ? `${aHits.length} assets share this serial; pick one (97 serials in the org are duplicated)`
          : 'exact match on a MaintainX asset serial number',
    };
  }

  if (req.tracking?.carrier && req.tracking.carrier !== 'Other') {
    return {
      ...out,
      kind: 'tracking',
      tracking: req.tracking,
      reason: `no MaintainX record; ${req.tracking.carrier} tracking shape, treat as an inbound package`,
    };
  }

  return {
    ...out,
    reason: 'no MaintainX part barcode or asset serial matches, and not a recognised carrier format',
  };
}

async function receive(env, req) {
  const warnings = [];
  const writesOn = String(env.MX_ALLOW_WRITES) === 'true';
  const ix = await getIndex(env);

  const locationId = Number(req.locationId);
  if (!Number.isFinite(locationId)) {
    return { ok: false, dryRun: !writesOn, wouldSend: [], warnings, error: 'locationId is required' };
  }
  if (!ix.locName.has(locationId)) {
    warnings.push(`locationId ${locationId} is not a known MaintainX location`);
  }
  if (!req.facilityHandle) {
    warnings.push(`no facilityHandle supplied; allocating to ${GENERAL_INVENTORY}`);
  }

  const alloc = allocationPayload(env, req.facilityHandle, req.poNumber);
  warnings.push(...alloc.warnings);

  const t = req.target || {};
  const qty = Number(req.quantity ?? 1);
  let ops = [];
  let before;

  if (t.kind === 'part') {
    const existing = ix.parts.find((p) => p.id === Number(t.partId));
    if (!existing) return fail(writesOn, warnings, `part ${t.partId} not found`);
    before = shapePart(existing, ix);
    // Only `locations[]` may be sent. Mixing in the deprecated top-level
    // locationId / availableQuantity is an API error.
    const locs = (existing.locations || []).map((l) => ({
      locationId: l.locationId,
      availableQuantity: Number(l.availableQuantity ?? 0),
    }));
    const row = locs.find((l) => l.locationId === locationId);
    if (row) row.availableQuantity += qty;
    else locs.push({ locationId, availableQuantity: qty });
    if (locs.some((l) => l.availableQuantity < 0)) {
      warnings.push('a location row is negative after this receive; MaintainX allows it, rollups must handle it');
    }
    ops = [{ method: 'PATCH', path: `parts/${existing.id}`, body: { locations: locs, ...alloc.fragment } }];
  } else if (t.kind === 'asset') {
    const existing = ix.assets.find((a) => a.id === Number(t.assetId));
    if (!existing) return fail(writesOn, warnings, `asset ${t.assetId} not found`);
    before = shapeAsset(existing, ix);
    ops = [{ method: 'PATCH', path: `assets/${existing.id}`, body: { locationId, ...alloc.fragment } }];
  } else if (t.kind === 'newPart') {
    if (!t.name) return fail(writesOn, warnings, 'newPart needs a name');
    const body = {
      name: t.name,
      locations: [{ locationId, availableQuantity: qty }],
      ...alloc.fragment,
    };
    // unitCost is cents, not dollars.
    if (Number.isFinite(Number(t.unitCostCents))) body.unitCost = Number(t.unitCostCents);
    if (req.code) body.barcode = String(req.code).trim().toUpperCase();
    if (Number(t.unitCostCents) > 0 && Number(t.unitCostCents) < 10000) {
      warnings.push('under $100: the 09-02 room called this bench stock and asked that it not be tracked');
    }
    ops = [{ method: 'POST', path: 'parts', body }];
  } else if (t.kind === 'newAsset') {
    if (!t.name) return fail(writesOn, warnings, 'newAsset needs a name');
    const body = { name: t.name, locationId, ...alloc.fragment };
    if (t.serialNumber) body.serialNumber = String(t.serialNumber).trim();
    else warnings.push('an asset with no serial number is hard to match on a later scan');
    ops = [{ method: 'POST', path: 'assets', body }];
  } else {
    return fail(writesOn, warnings, `unknown target kind "${t.kind}"`);
  }

  if (!writesOn) {
    return {
      ok: true,
      dryRun: true,
      wouldSend: ops,
      before,
      warnings: [
        ...warnings,
        'MX_ALLOW_WRITES is not true, so nothing was sent to MaintainX. `wouldSend` is the exact withheld request.',
      ],
    };
  }

  const results = [];
  for (const op of ops) {
    const r = await mxFetch(env, op.path, { method: op.method, body: JSON.stringify(op.body) });
    results.push(r);
    if (!r.ok) {
      return {
        ok: false,
        dryRun: false,
        wouldSend: ops,
        before,
        warnings,
        error: `${op.method} ${op.path} -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`,
      };
    }
  }

  // Read the record back so the operator can compare it against MaintainX.
  const created = results[results.length - 1].body;
  const isPart = ops[ops.length - 1].path.startsWith('parts');
  const id = created?.part?.id ?? created?.asset?.id ?? created?.id ?? (t.partId ?? t.assetId);
  const fresh = await mxFetch(env, `${isPart ? 'parts' : 'assets'}/${id}`);
  const rec = fresh.body?.part ?? fresh.body?.asset ?? fresh.body;
  await getIndex(env, { force: true });

  return {
    ok: true,
    dryRun: false,
    wouldSend: ops,
    before,
    readBack: isPart ? shapePart(rec, cache) : shapeAsset(rec, cache),
    warnings,
  };
}

function fail(writesOn, warnings, error) {
  return { ok: false, dryRun: !writesOn, wouldSend: [], warnings, error };
}

async function onHand(env, req) {
  const ix = await getIndex(env);
  const want = (req.locationIds || []).map(Number).filter(Number.isFinite);
  const inScope = (id) => want.length === 0 || want.includes(Number(id));

  const parts = ix.parts
    .filter((p) => (p.locations || []).some((l) => inScope(l.locationId) && Number(l.availableQuantity ?? 0) !== 0))
    .map((p) => {
      const s = shapePart(p, ix);
      s.locations = s.locations.filter((l) => inScope(l.locationId) && l.availableQuantity !== 0);
      return s;
    });
  const assets = ix.assets.filter((a) => inScope(a.locationId)).map((a) => shapeAsset(a, ix));

  const locations = (want.length ? want : [...new Set(ix.parts.flatMap((p) => (p.locations || []).map((l) => l.locationId)))])
    .map((id) => ({
      locationId: Number(id),
      name: ix.locName.get(Number(id)) ?? String(id),
      partLines: parts.filter((p) => p.locations.some((l) => l.locationId === Number(id))).length,
      assets: assets.filter((a) => a.locationId === Number(id)).length,
    }))
    .sort((a, b) => b.partLines + b.assets - (a.partLines + a.assets));

  return { asOf: new Date(ix.builtAt).toISOString(), locations, parts, assets };
}

async function issue(env, req) {
  // Issuing is a receive at the destination with the facility handle changed,
  // so it reuses the same write path rather than duplicating the merge logic.
  const to = Number(req.toLocationId);
  return receive(env, {
    action: 'mx-receive',
    code: '',
    target: req.target,
    locationId: Number.isFinite(to) ? to : Number(req.fromLocationId),
    facilityHandle: req.toFacilityHandle,
    quantity: req.quantity,
    note: req.note,
  });
}

// ------------------------------------------------------------------ dispatch

export async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname.endsWith('/health')) {
    return json({
      ok: true,
      writesEnabled: String(env.MX_ALLOW_WRITES) === 'true',
      allocationFieldsReady: String(env.MX_ALLOCATION_FIELDS_READY) === 'true',
      indexAgeMs: cache ? Date.now() - cache.builtAt : null,
      indexed: cache ? { parts: cache.parts.length, assets: cache.assets.length } : null,
    });
  }
  if (request.method === 'GET' && url.pathname.endsWith('/warm')) {
    const ix = await getIndex(env, { force: true });
    return json({ ok: true, parts: ix.parts.length, assets: ix.assets.length, locations: ix.locations.length });
  }
  if (request.method !== 'POST') return json({ error: 'POST a JSON action' }, 405);
  if (!env.MX_KEY) return json({ error: 'MX_KEY is not configured on the proxy' }, 500);

  let req;
  try {
    req = JSON.parse(await request.text());
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }

  try {
    switch (req.action) {
      case 'mx-resolve':
        return json(await resolve(env, req));
      case 'mx-receive':
        return json(await receive(env, req));
      case 'mx-onhand':
        return json(await onHand(env, req));
      case 'mx-issue':
        return json(await issue(env, req));
      default:
        return json({ error: `unknown action "${req.action}"` }, 400);
    }
  } catch (err) {
    return json({ error: String(err?.message || err) }, 502);
  }
}
