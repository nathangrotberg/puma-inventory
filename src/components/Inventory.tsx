import { useEffect, useMemo, useState } from 'react';
import { postFetch, FetchResult, SPOrder, SPPackage } from '../api';

type View = 'have' | 'expecting' | 'activity';

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function ageDays(iso?: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function Inventory() {
  const [data, setData] = useState<FetchResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('have');
  const [q, setQ] = useState('');
  const [loc, setLoc] = useState('All locations');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setData(await postFetch());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ordersById = useMemo(() => {
    const m = new Map<number, SPOrder>();
    (data?.orders || []).forEach((o) => m.set(o.Id, o));
    return m;
  }, [data]);

  const locations = useMemo(() => {
    const s = new Set<string>();
    (data?.packages || []).forEach((p) => p.ReceivedLocation && s.add(p.ReceivedLocation));
    (data?.scans || []).forEach((sc) => sc.Location && s.add(sc.Location));
    return ['All locations', ...Array.from(s).sort()];
  }, [data]);

  function orderLabel(p: SPPackage): string {
    const o = p.OrderRef ? ordersById.get(p.OrderRef) : undefined;
    if (!o) return 'No order on file';
    return [o.Vendor, o.PONumber].filter(Boolean).join(' ') || o.Title;
  }

  function matchesQ(...vals: (string | undefined | null)[]): boolean {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return vals.some((v) => (v || '').toLowerCase().includes(needle));
  }

  const have = (data?.packages || [])
    .filter((p) => p.PkgStatus === 'received')
    .filter((p) => loc === 'All locations' || p.ReceivedLocation === loc)
    .filter((p) => matchesQ(p.Title, p.Contents, p.Carrier, p.ReceivedLocation, orderLabel(p)))
    .sort((a, b) => (b.ReceivedAt || '').localeCompare(a.ReceivedAt || ''));

  const expecting = (data?.packages || [])
    .filter((p) => p.PkgStatus !== 'received')
    .filter((p) => matchesQ(p.Title, p.Contents, p.Carrier, orderLabel(p)))
    .sort((a, b) => (a.ETA || '9999').localeCompare(b.ETA || '9999'));

  const activity = (data?.scans || [])
    .filter((s) => loc === 'All locations' || s.Location === loc)
    .filter((s) => matchesQ(s.Title, s.RawCode, s.ScanNote, s.Location));

  const counts = {
    have: (data?.packages || []).filter((p) => p.PkgStatus === 'received').length,
    expecting: (data?.packages || []).filter((p) => p.PkgStatus !== 'received').length,
    activity: (data?.scans || []).length,
  };

  return (
    <div className="inventory">
      <div className="inv-controls">
        <input
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tracking, vendor, PO, contents"
        />
        <div className="inv-row">
          <select value={loc} onChange={(e) => setLoc(e.target.value)}>
            {locations.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <button className="refresh" onClick={refresh} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="chips">
          <button className={view === 'have' ? 'chip active' : 'chip'} onClick={() => setView('have')}>
            Have ({counts.have})
          </button>
          <button className={view === 'expecting' ? 'chip active' : 'chip'} onClick={() => setView('expecting')}>
            Expecting ({counts.expecting})
          </button>
          <button className={view === 'activity' ? 'chip active' : 'chip'} onClick={() => setView('activity')}>
            Activity ({counts.activity})
          </button>
        </div>
      </div>

      {error && <p className="camera-error">{error}</p>}
      {!data && !error && <p className="hint">Loading inventory from SharePoint...</p>}

      {data && view === 'have' && (
        <div className="events">
          {have.map((p) => (
            <div key={p.Id} className="event matched">
              <div className="event-top">
                <span className="tracking">{p.Title}</span>
                <span className="meta">{p.ReceivedLocation || '?'} · {fmtDate(p.ReceivedAt)}</span>
              </div>
              <div className="detail">
                {orderLabel(p)}
                {p.Contents ? ` · ${p.Contents}` : ''}
              </div>
            </div>
          ))}
          {have.length === 0 && <p className="hint">Nothing received yet{q ? ' matching the search' : ''}.</p>}
        </div>
      )}

      {data && view === 'expecting' && (
        <div className="events">
          {expecting.map((p) => {
            const overdue = p.ETA && new Date(p.ETA).getTime() < Date.now();
            const age = ageDays(p.Created);
            return (
              <div key={p.Id} className={`event ${overdue ? 'error' : 'unmatched'}`}>
                <div className="event-top">
                  <span className="tracking">{p.Title}</span>
                  <span className="meta">
                    {p.Carrier || ''}{p.ETA ? ` · ETA ${fmtDate(p.ETA).split(' ').slice(0, 2).join(' ')}` : ''}
                  </span>
                </div>
                <div className="detail">
                  {orderLabel(p)}
                  {p.Contents ? ` · ${p.Contents}` : ''}
                  {overdue ? ' · OVERDUE' : age > 0 ? ` · expected ${age}d ago` : ''}
                </div>
              </div>
            );
          })}
          {expecting.length === 0 && <p className="hint">Nothing outstanding{q ? ' matching the search' : ''}.</p>}
        </div>
      )}

      {data && view === 'activity' && (
        <div className="events">
          {activity.map((s) => (
            <div key={s.Id} className="event">
              <div className="event-top">
                <span className="tracking">{s.Title}</span>
                <span className="meta">{s.Location || '?'} · {fmtDate(s.Created)}</span>
              </div>
              {(s.ScanNote || s.Carrier) && (
                <div className="detail">{[s.Carrier, s.ScanNote].filter(Boolean).join(' · ')}</div>
              )}
            </div>
          ))}
          {activity.length === 0 && <p className="hint">No scans yet{q ? ' matching the search' : ''}.</p>}
        </div>
      )}
    </div>
  );
}
