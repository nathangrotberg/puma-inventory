#!/usr/bin/env node
/**
 * Regenerate src/facilities.json: the QuickBase facility-handle -> MaintainX
 * location join that O51 allocation depends on.
 *
 * Read-only. Needs MAINTAINX_API_KEY. The QuickBase side is exported by
 * scripts/export-qb-facilities.sh because the QuickBase connector lives
 * outside this repo; commit the JSON so a build never needs either system.
 *
 *   node scripts/build-facilities.mjs qb-facilities.json > src/facilities.json
 */
import { readFileSync } from 'node:fs';

const KEY = process.env.MAINTAINX_API_KEY;
if (!KEY) { console.error('MAINTAINX_API_KEY not set'); process.exit(2); }

async function all(path) {
  const out = [];
  let cursor;
  for (;;) {
    const u = new URL(`https://api.getmaintainx.com/v1/${path}`);
    u.searchParams.set('limit', '200');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    const d = await r.json();
    out.push(...d[Object.keys(d).find((k) => Array.isArray(d[k]))]);
    cursor = d.nextCursor;
    if (!cursor) return out;
  }
}

const qb = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const locs = await all('locations');

// MaintainX names sites as "CODE - Human Name". Several codes appear more than
// once (LSH names both the hub and each engine under it), so prefer the node
// with no parent, then the shortest name: that is the hub rather than a child.
const byCode = new Map();
for (const l of locs) {
  const m = /^([A-Z0-9]{2,4})\s*-\s*(.+)$/.exec((l.name || '').trim());
  if (!m) continue;
  const code = m[1].toUpperCase();
  if (!byCode.has(code)) byCode.set(code, []);
  byCode.get(code).push(l);
}
function pick(cands) {
  const sorted = [...cands].sort((a, b) => {
    const ra = a.parentId == null ? 0 : 1;
    const rb = b.parentId == null ? 0 : 1;
    return ra - rb || a.name.length - b.name.length;
  });
  return { chosen: sorted[0], ambiguous: cands.length > 1 };
}

const facilities = Object.entries(qb.facilities)
  .filter(([h]) => h && h !== '---')
  .map(([handle, f]) => {
    const cands = byCode.get(handle.toUpperCase()) || [];
    const { chosen, ambiguous } = cands.length ? pick(cands) : { chosen: null, ambiguous: false };
    return {
      handle,
      name: f.name,
      payingEntity: f.entity,
      poCount: f.pos,
      locationId: chosen ? chosen.id : null,
      locationName: chosen ? chosen.name : null,
      ambiguous: ambiguous || undefined,
      alternates: ambiguous ? cands.map((c) => ({ id: c.id, name: c.name })) : undefined,
    };
  })
  .sort((a, b) => b.poCount - a.poCount || a.handle.localeCompare(b.handle));

const byId = new Map(locs.map((l) => [l.id, l]));
const pathOf = (id) => {
  const seg = [];
  for (let cur = id; byId.has(cur); cur = byId.get(cur).parentId) seg.unshift(byId.get(cur).name);
  return seg.join(' / ');
};

process.stdout.write(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString().slice(0, 10),
      source: 'QuickBase Systems/Purchase Orders br96xsmve + MaintainX /v1/locations (org 62357)',
      note:
        'handle is the allocation key. MEW means unallocated and maps to GENERAL_INVENTORY, ' +
        'which is why it has no locationId.',
      matched: facilities.filter((f) => f.locationId).length,
      total: facilities.length,
      facilities,
      receiveLocations: [
        { key: 'Redding', locationId: 3579125, path: pathOf(3579125) },
        { key: 'Visalia', locationId: 395602, path: pathOf(395602) },
        { key: 'Meadowview', locationId: 2042237, path: pathOf(2042237) },
      ],
    },
    null,
    1,
  ) + '\n',
);
