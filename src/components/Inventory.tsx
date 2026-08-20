import { useEffect, useMemo, useState } from 'react';
import { postFetch, FetchResult, SPOrder, SPPackage, SPScan } from '../api';

type View = 'have' | 'expecting' | 'activity';

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function fmtDay(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ageDays(iso?: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

interface Column<T> {
  key: string;
  label: string;
  sort: (row: T) => string;
  render: (row: T) => React.ReactNode;
}

function DataTable<T extends { Id: number }>({
  columns,
  rows,
  defaultSort,
  defaultDir,
}: {
  columns: Column<T>[];
  rows: T[];
  defaultSort: string;
  defaultDir: 'asc' | 'desc';
}) {
  const [sortKey, setSortKey] = useState(defaultSort);
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey) || columns[0];
    const out = [...rows].sort((a, b) => col.sort(a).localeCompare(col.sort(b)));
    return dir === 'desc' ? out.reverse() : out;
  }, [rows, columns, sortKey, dir]);

  function clickHeader(key: string) {
    if (key === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setDir('asc');
    }
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} onClick={() => clickHeader(c.key)}>
                {c.label}
                {sortKey === c.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.Id}>
              {columns.map((c) => (
                <td key={c.key}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

  const pkgByTracking = useMemo(() => {
    const m = new Map<string, SPPackage>();
    (data?.packages || []).forEach((p) => m.set(p.Title, p));
    return m;
  }, [data]);

  function itemName(p: SPPackage): string {
    return p.Contents || '(item not identified)';
  }

  function scanItemName(title: string): string {
    const p = pkgByTracking.get(title);
    return p?.Contents || '(no order on file)';
  }

  const have = (data?.packages || [])
    .filter((p) => p.PkgStatus === 'received')
    .filter((p) => loc === 'All locations' || p.ReceivedLocation === loc)
    .filter((p) => matchesQ(p.Title, p.Contents, p.Carrier, p.ReceivedLocation, orderLabel(p)));

  const expecting = (data?.packages || [])
    .filter((p) => p.PkgStatus !== 'received')
    .filter((p) => matchesQ(p.Title, p.Contents, p.Carrier, orderLabel(p)));

  const activity = (data?.scans || [])
    .filter((s) => loc === 'All locations' || s.Location === loc)
    .filter((s) => matchesQ(s.Title, s.RawCode, s.ScanNote, s.Location, scanItemName(s.Title)));

  const counts = {
    have: (data?.packages || []).filter((p) => p.PkgStatus === 'received').length,
    expecting: (data?.packages || []).filter((p) => p.PkgStatus !== 'received').length,
    activity: (data?.scans || []).length,
  };

  const haveCols: Column<SPPackage>[] = [
    { key: 'item', label: 'Item', sort: (p) => itemName(p), render: (p) => <span className="item-name">{itemName(p)}</span> },
    { key: 'tracking', label: 'Tracking', sort: (p) => p.Title, render: (p) => <span className="tracking">{p.Title}</span> },
    { key: 'order', label: 'Vendor / PO', sort: (p) => orderLabel(p), render: (p) => orderLabel(p) },
    { key: 'carrier', label: 'Carrier', sort: (p) => p.Carrier || '', render: (p) => p.Carrier || '' },
    { key: 'location', label: 'Location', sort: (p) => p.ReceivedLocation || '', render: (p) => p.ReceivedLocation || '' },
    { key: 'received', label: 'Received', sort: (p) => p.ReceivedAt || '', render: (p) => fmtDate(p.ReceivedAt) },
  ];

  const expectingCols: Column<SPPackage>[] = [
    { key: 'item', label: 'Item', sort: (p) => itemName(p), render: (p) => <span className="item-name">{itemName(p)}</span> },
    { key: 'tracking', label: 'Tracking', sort: (p) => p.Title, render: (p) => <span className="tracking">{p.Title}</span> },
    { key: 'order', label: 'Vendor / PO', sort: (p) => orderLabel(p), render: (p) => orderLabel(p) },
    { key: 'carrier', label: 'Carrier', sort: (p) => p.Carrier || '', render: (p) => p.Carrier || '' },
    { key: 'eta', label: 'ETA', sort: (p) => p.ETA || '9999', render: (p) => fmtDay(p.ETA) },
    {
      key: 'status',
      label: 'Status',
      sort: (p) => (p.ETA && new Date(p.ETA).getTime() < Date.now() ? '0' : '1'),
      render: (p) => {
        const overdue = p.ETA && new Date(p.ETA).getTime() < Date.now();
        const age = ageDays(p.Created);
        if (overdue) return <span className="badge overdue">OVERDUE</span>;
        return <span className="badge waiting">expecting{age > 0 ? ` · ${age}d` : ''}</span>;
      },
    },
  ];

  const activityCols: Column<SPScan>[] = [
    { key: 'item', label: 'Item', sort: (s) => scanItemName(s.Title), render: (s) => <span className="item-name">{scanItemName(s.Title)}</span> },
    { key: 'code', label: 'Scanned code', sort: (s) => s.Title, render: (s) => <span className="tracking">{s.Title}</span> },
    { key: 'location', label: 'Location', sort: (s) => s.Location || '', render: (s) => s.Location || '' },
    { key: 'note', label: 'Note', sort: (s) => s.ScanNote || '', render: (s) => s.ScanNote || '' },
    { key: 'time', label: 'Time', sort: (s) => s.Created, render: (s) => fmtDate(s.Created) },
  ];

  return (
    <div className="inventory">
      <div className="inv-controls">
        <input
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tracking, vendor, PO, contents"
        />
        <select value={loc} onChange={(e) => setLoc(e.target.value)}>
          {locations.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
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
        <button className="refresh" onClick={refresh} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p className="camera-error">{error}</p>}
      {!data && !error && <p className="hint">Loading inventory from SharePoint...</p>}

      {data && (
        <>
          {/* Desktop: full-width sortable tables */}
          <div className="table-view">
            {view === 'have' && (
              <DataTable columns={haveCols} rows={have} defaultSort="received" defaultDir="desc" />
            )}
            {view === 'expecting' && (
              <DataTable columns={expectingCols} rows={expecting} defaultSort="eta" defaultDir="asc" />
            )}
            {view === 'activity' && (
              <DataTable columns={activityCols} rows={activity} defaultSort="time" defaultDir="desc" />
            )}
            {((view === 'have' && have.length === 0) ||
              (view === 'expecting' && expecting.length === 0) ||
              (view === 'activity' && activity.length === 0)) && (
              <p className="hint">Nothing here{q ? ' matching the search' : ''}.</p>
            )}
          </div>

          {/* Phone: card list fallback */}
          <div className="cards-view">
            {view === 'have' && (
              <div className="events">
                {have
                  .sort((a, b) => (b.ReceivedAt || '').localeCompare(a.ReceivedAt || ''))
                  .map((p) => (
                    <div key={p.Id} className="event matched">
                      <div className="event-top">
                        <span className="item-name">{itemName(p)}</span>
                        <span className="meta">{p.ReceivedLocation || '?'} · {fmtDate(p.ReceivedAt)}</span>
                      </div>
                      <div className="detail">
                        <span className="tracking small">{p.Title}</span> · {orderLabel(p)}
                      </div>
                    </div>
                  ))}
                {have.length === 0 && <p className="hint">Nothing received yet{q ? ' matching the search' : ''}.</p>}
              </div>
            )}
            {view === 'expecting' && (
              <div className="events">
                {expecting
                  .sort((a, b) => (a.ETA || '9999').localeCompare(b.ETA || '9999'))
                  .map((p) => {
                    const overdue = p.ETA && new Date(p.ETA).getTime() < Date.now();
                    const age = ageDays(p.Created);
                    return (
                      <div key={p.Id} className={`event ${overdue ? 'error' : 'unmatched'}`}>
                        <div className="event-top">
                          <span className="item-name">{itemName(p)}</span>
                          <span className="meta">
                            {p.Carrier || ''}{p.ETA ? ` · ETA ${fmtDay(p.ETA)}` : ''}
                          </span>
                        </div>
                        <div className="detail">
                          <span className="tracking small">{p.Title}</span> · {orderLabel(p)}
                          {overdue ? ' · OVERDUE' : age > 0 ? ` · expected ${age}d ago` : ''}
                        </div>
                      </div>
                    );
                  })}
                {expecting.length === 0 && <p className="hint">Nothing outstanding{q ? ' matching the search' : ''}.</p>}
              </div>
            )}
            {view === 'activity' && (
              <div className="events">
                {activity.map((s) => (
                  <div key={s.Id} className="event">
                    <div className="event-top">
                      <span className="item-name">{scanItemName(s.Title)}</span>
                      <span className="meta">{s.Location || '?'} · {fmtDate(s.Created)}</span>
                    </div>
                    <div className="detail">
                      <span className="tracking small">{s.Title}</span>
                      {s.ScanNote ? ` · ${s.ScanNote}` : ''}
                    </div>
                  </div>
                ))}
                {activity.length === 0 && <p className="hint">No scans yet{q ? ' matching the search' : ''}.</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
