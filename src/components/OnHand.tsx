import { useEffect, useMemo, useState } from 'react';
import { mxOnHand, mxIssue } from '../api';
import { ALLOCATION_OPTIONS, RECEIVE_LOCATIONS, label as facilityLabel } from '../facilities';
import { GENERAL_INVENTORY, MxAssetHit, MxPartHit, OnHandResponse } from '../mxContract';

const money = (cents?: number | null) =>
  cents == null ? '' : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/** Allocation currently lives in externalId as "HANDLE|PO" until the two
 *  MaintainX custom fields exist, so read either shape. */
function allocationOf(r: { extraFields?: Record<string, string>; externalId?: string | null }) {
  const ef = r.extraFields || {};
  const handle = ef['Facility Handle'] || (r.externalId || '').split('|')[0] || '';
  const po = ef['PO Number'] || (r.externalId || '').split('|')[1] || '';
  return { handle, po };
}

/** PUMA-managed means this tool has allocated it, or it carries the PUMA naming
 *  convention already used on 96 assets in the org. Allocation is checked first
 *  so newly received stock counts even before anyone renames it. */
function isPumaManaged(r: {
  name?: string;
  extraFields?: Record<string, string>;
  externalId?: string | null;
}) {
  if (allocationOf(r).handle) return true;
  return (r.name || '').trim().toUpperCase().startsWith('P.W.');
}

export default function OnHand() {
  const [data, setData] = useState<OnHandResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [locFilter, setLocFilter] = useState<number | 'all'>('all');
  const [scope, setScope] = useState<'puma' | 'all'>('puma');
  // The three PUMA receiving nodes also hold site-coded operations spares
  // (Visalia alone carries 193 `FMJ -` / `AVD -` rows that belong to ops, not
  // PUMA). Without this lens the view reads as if they were PUMA stock.
  const [owner, setOwner] = useState<'all' | 'managed'>('all');
  const [issuing, setIssuing] = useState<{ kind: 'part' | 'asset'; id: number; name: string } | null>(null);
  const [issueTo, setIssueTo] = useState(GENERAL_INVENTORY);
  const [issueQty, setIssueQty] = useState('1');
  const [issueMsg, setIssueMsg] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const ids = scope === 'puma' ? RECEIVE_LOCATIONS.map((l) => l.locationId) : undefined;
      setData(await mxOnHand(ids));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const parts = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toUpperCase();
    return data.parts.filter((p: MxPartHit) => {
      if (locFilter !== 'all' && !p.locations.some((l) => l.locationId === locFilter)) return false;
      if (owner === 'managed' && !isPumaManaged(p)) return false;
      if (!needle) return true;
      return [p.name, p.barcode, allocationOf(p).handle].some((v) => (v || '').toUpperCase().includes(needle));
    });
  }, [data, q, locFilter, owner]);

  const assets = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toUpperCase();
    return data.assets.filter((a: MxAssetHit) => {
      if (locFilter !== 'all' && a.locationId !== locFilter) return false;
      if (owner === 'managed' && !isPumaManaged(a)) return false;
      if (!needle) return true;
      return [a.name, a.serialNumber, allocationOf(a).handle].some((v) =>
        (v || '').toUpperCase().includes(needle),
      );
    });
  }, [data, q, locFilter, owner]);

  const totals = useMemo(() => {
    let units = 0;
    let value = 0;
    let negatives = 0;
    for (const p of parts) {
      for (const l of p.locations) {
        if (locFilter !== 'all' && l.locationId !== locFilter) continue;
        units += l.availableQuantity;
        if (l.availableQuantity < 0) negatives += 1;
        value += l.availableQuantity * (p.unitCostCents ?? 0);
      }
    }
    return { units, value, negatives };
  }, [parts, locFilter]);

  const unallocated = useMemo(
    () =>
      parts.filter((p) => !allocationOf(p).handle || allocationOf(p).handle === GENERAL_INVENTORY).length +
      assets.filter((a) => !allocationOf(a).handle || allocationOf(a).handle === GENERAL_INVENTORY).length,
    [parts, assets],
  );

  async function doIssue() {
    if (!issuing) return;
    setIssueMsg('');
    try {
      const dest = ALLOCATION_OPTIONS.find((f) => f.handle === issueTo);
      const r = await mxIssue({
        target: issuing.kind === 'part' ? { kind: 'part', partId: issuing.id } : { kind: 'asset', assetId: issuing.id },
        toFacilityHandle: issueTo,
        toLocationId: dest?.locationId ?? undefined,
        quantity: Number(issueQty) || 1,
      });
      setIssueMsg(
        r.dryRun
          ? `Dry run. Withheld: ${r.wouldSend.map((o) => `${o.method} ${o.path}`).join(', ')}`
          : r.ok
            ? 'Issued. Read back from MaintainX.'
            : `Failed: ${r.error}`,
      );
      if (!r.dryRun && r.ok) refresh();
    } catch (err) {
      setIssueMsg(String(err));
    }
  }

  return (
    <div className="onhand">
      <div className="summary">
        <div className="stat">
          <span className="stat-n">{parts.length}</span>
          <span className="stat-l">Part lines</span>
        </div>
        <div className="stat">
          <span className="stat-n">{totals.units}</span>
          <span className="stat-l">Units</span>
        </div>
        <div className="stat">
          <span className="stat-n">{assets.length}</span>
          <span className="stat-l">Assets</span>
        </div>
        <div className="stat">
          <span className="stat-n">{money(totals.value)}</span>
          <span className="stat-l">Value at unit cost</span>
        </div>
        <div className={unallocated ? 'stat bad' : 'stat'}>
          <span className="stat-n">{unallocated}</span>
          <span className="stat-l">Unallocated</span>
        </div>
      </div>

      {owner === 'all' && (
        <p className="banner warn">
          These locations are shared. Visalia and Meadow View hold site-coded operations spares
          (<code>FMJ -</code>, <code>AVD -</code>) that belong to ops, not to PUMA. Switch to
          <strong> PUMA-managed only</strong> for PUMA&apos;s own stock.
        </p>
      )}
      {unallocated > 0 && (
        <p className="banner warn">
          {unallocated} of {parts.length + assets.length} records carry no facility. That is the
          baseline the 09-02 meeting asked to close: nothing is allocated until it is either
          received through this tool or given a facility below.
        </p>
      )}
      {totals.negatives > 0 && (
        <p className="banner warn">
          {totals.negatives} location row{totals.negatives === 1 ? '' : 's'}{' '}
          {totals.negatives === 1 ? 'is' : 'are'} negative in MaintainX. Shown as-is rather than clamped to
          zero, because hiding them understates the count.
        </p>
      )}

      <div className="facets">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, barcode, serial, facility" />
        <select value={String(locFilter)} onChange={(e) => setLocFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All locations</option>
          {(data?.locations || []).map((l) => (
            <option key={l.locationId} value={l.locationId}>
              {l.name}
            </option>
          ))}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as 'puma' | 'all')}>
          <option value="puma">PUMA locations only</option>
          <option value="all">Whole organisation</option>
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value as 'all' | 'managed')}>
          <option value="all">Everything stored here</option>
          <option value="managed">PUMA-managed only</option>
        </select>
        <button onClick={refresh} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        {data && <span className="asof">as of {new Date(data.asOf).toLocaleTimeString()}</span>}
      </div>

      {error && <p className="banner warn">{error}</p>}

      <h3>Parts</h3>
      <div className="table-view">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Facility</th>
              <th>PO</th>
              <th>Location</th>
              <th className="num">Qty</th>
              <th className="num">Unit</th>
              <th>Barcode</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {parts.map((p) =>
              p.locations
                .filter((l) => locFilter === 'all' || l.locationId === locFilter)
                .map((l) => {
                  const a = allocationOf(p);
                  return (
                    <tr key={`${p.id}-${l.locationId}`}>
                      <td className="strong">{p.name}</td>
                      <td>{a.handle ? facilityLabel(a.handle) : <span className="muted">none</span>}</td>
                      <td className="mono muted">{a.po || ''}</td>
                      <td>{l.locationName ?? l.locationId}</td>
                      <td className={l.availableQuantity < 0 ? 'num bad' : 'num'}>{l.availableQuantity}</td>
                      <td className="num">{money(p.unitCostCents)}</td>
                      <td className="mono muted">{p.barcode}</td>
                      <td>
                        <button onClick={() => setIssuing({ kind: 'part', id: p.id, name: p.name })}>Issue</button>
                      </td>
                    </tr>
                  );
                }),
            )}
          </tbody>
        </table>
      </div>

      <h3>Assets</h3>
      <div className="table-view">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Facility</th>
              <th>Serial</th>
              <th>Location</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const al = allocationOf(a);
              return (
                <tr key={a.id}>
                  <td className="strong">{a.name}</td>
                  <td>{al.handle ? facilityLabel(al.handle) : <span className="muted">none</span>}</td>
                  <td className="mono muted">{a.serialNumber}</td>
                  <td>{a.locationName ?? '-'}</td>
                  <td>
                    <button onClick={() => setIssuing({ kind: 'asset', id: a.id, name: a.name })}>Issue</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {issuing && (
        <div className="settings">
          <p>
            Issue <strong>{issuing.name}</strong> to a facility. This is Justin&apos;s 20-Red-Lions case:
            bought under General Inventory, later switched to a project.
          </p>
          <select value={issueTo} onChange={(e) => setIssueTo(e.target.value)}>
            {ALLOCATION_OPTIONS.map((f) => (
              <option key={f.handle} value={f.handle}>
                {f.handle === GENERAL_INVENTORY ? f.name : `${f.handle} — ${f.name}`}
                {f.locationId ? '' : ' (no MaintainX location)'}
              </option>
            ))}
          </select>
          {issuing.kind === 'part' && (
            <input value={issueQty} onChange={(e) => setIssueQty(e.target.value)} inputMode="numeric" />
          )}
          <button onClick={doIssue}>Issue</button>
          <button onClick={() => { setIssuing(null); setIssueMsg(''); }}>Close</button>
          {issueMsg && <p className="hint">{issueMsg}</p>}
        </div>
      )}
    </div>
  );
}
