import { useEffect, useMemo, useState } from 'react';
import { postFetch, FetchResult, SPOrder, SPPackage, SPScan } from '../api';

type View = 'have' | 'expecting' | 'orders' | 'activity';
type Range = 'all' | 'today' | '7' | '30';

const DAY = 86400000;

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

function fmtCost(n?: number | null): string {
  if (n === undefined || n === null) return '';
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ageDays(iso?: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
}

function isOverdue(p: SPPackage): boolean {
  return p.PkgStatus !== 'received' && !!p.ETA && new Date(p.ETA).getTime() < Date.now();
}

// Past-looking dates (received, scanned, ordered): within the last N days.
// Future-looking dates (ETA): within the next N days, overdue always included.
function inPastRange(iso: string | null | undefined, range: Range): boolean {
  if (range === 'all') return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (range === 'today') return new Date(iso).toDateString() === new Date().toDateString();
  return Date.now() - t <= Number(range) * DAY && t <= Date.now() + DAY;
}

function inFutureRange(iso: string | null | undefined, range: Range): boolean {
  if (range === 'all') return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (t < Date.now()) return true; // overdue stays visible in every window
  if (range === 'today') return new Date(iso).toDateString() === new Date().toDateString();
  return t - Date.now() <= Number(range) * DAY;
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
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  defaultSort: string;
  defaultDir: 'asc' | 'desc';
  onRowClick?: (row: T) => void;
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
            <tr key={r.Id} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick?.(r)}>
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

interface OrderStats {
  order: SPOrder;
  pkgs: SPPackage[];
  received: number;
  total: number;
  cost: number;
  hasOverdue: boolean;
  nextEta: string | null;
  status: 'complete' | 'partial' | 'open';
}

export default function Inventory() {
  const [data, setData] = useState<FetchResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('have');
  const [q, setQ] = useState('');
  const [vendor, setVendor] = useState('All vendors');
  const [carrier, setCarrier] = useState('All carriers');
  const [loc, setLoc] = useState('All locations');
  const [range, setRange] = useState<Range>('all');
  const [sel, setSel] = useState<{ type: 'pkg' | 'order'; id: number } | null>(null);

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

  const pkgByTracking = useMemo(() => {
    const m = new Map<string, SPPackage>();
    (data?.packages || []).forEach((p) => m.set(p.Title, p));
    return m;
  }, [data]);

  const scansByTracking = useMemo(() => {
    const m = new Map<string, SPScan[]>();
    (data?.scans || []).forEach((s) => {
      const arr = m.get(s.Title) || [];
      arr.push(s);
      m.set(s.Title, arr);
    });
    return m;
  }, [data]);

  const orderStats: OrderStats[] = useMemo(() => {
    return (data?.orders || []).map((o) => {
      const pkgs = (data?.packages || []).filter((p) => p.OrderRef === o.Id);
      const received = pkgs.filter((p) => p.PkgStatus === 'received').length;
      const open = pkgs.filter((p) => p.PkgStatus !== 'received');
      const nextEta = open.map((p) => p.ETA).filter(Boolean).sort()[0] || null;
      return {
        order: o,
        pkgs,
        received,
        total: pkgs.length,
        cost: pkgs.reduce((s, p) => s + (p.Cost || 0), 0),
        hasOverdue: pkgs.some(isOverdue),
        nextEta,
        status: (received === pkgs.length && pkgs.length > 0 ? 'complete' : received > 0 ? 'partial' : 'open') as OrderStats['status'],
      };
    });
  }, [data]);

  function pkgVendor(p: SPPackage): string {
    return (p.OrderRef && ordersById.get(p.OrderRef)?.Vendor) || 'No order';
  }

  function orderLabel(p: SPPackage): string {
    const o = p.OrderRef ? ordersById.get(p.OrderRef) : undefined;
    if (!o) return 'No order on file';
    return [o.Vendor, o.PONumber].filter(Boolean).join(' ') || o.Title;
  }

  function itemName(p: SPPackage): string {
    return p.Contents || '(item not identified)';
  }

  function scanItemName(title: string): string {
    return pkgByTracking.get(title)?.Contents || '(no order on file)';
  }

  const vendors = useMemo(() => {
    const s = new Set<string>();
    (data?.orders || []).forEach((o) => o.Vendor && s.add(o.Vendor));
    return ['All vendors', ...Array.from(s).sort()];
  }, [data]);

  const locations = useMemo(() => {
    const s = new Set<string>();
    (data?.packages || []).forEach((p) => p.ReceivedLocation && s.add(p.ReceivedLocation));
    (data?.scans || []).forEach((sc) => sc.Location && s.add(sc.Location));
    return ['All locations', ...Array.from(s).sort()];
  }, [data]);

  function matchesQ(...vals: (string | undefined | null)[]): boolean {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return vals.some((v) => (v || '').toLowerCase().includes(needle));
  }

  function pkgFacets(p: SPPackage): boolean {
    if (vendor !== 'All vendors' && pkgVendor(p) !== vendor) return false;
    if (carrier !== 'All carriers' && (p.Carrier || 'Other') !== carrier) return false;
    return true;
  }

  const have = (data?.packages || [])
    .filter((p) => p.PkgStatus === 'received')
    .filter(pkgFacets)
    .filter((p) => loc === 'All locations' || p.ReceivedLocation === loc)
    .filter((p) => inPastRange(p.ReceivedAt, range))
    .filter((p) => matchesQ(p.Title, p.Contents, p.Carrier, p.ReceivedLocation, orderLabel(p)));

  const expecting = (data?.packages || [])
    .filter((p) => p.PkgStatus !== 'received')
    .filter(pkgFacets)
    .filter((p) => inFutureRange(p.ETA, range))
    .filter((p) => matchesQ(p.Title, p.Contents, p.Carrier, orderLabel(p)));

  const activity = (data?.scans || [])
    .filter((s) => loc === 'All locations' || s.Location === loc)
    .filter((s) => carrier === 'All carriers' || (s.Carrier || 'Other') === carrier)
    .filter((s) => vendor === 'All vendors' || pkgVendor(pkgByTracking.get(s.Title) || ({} as SPPackage)) === vendor)
    .filter((s) => inPastRange(s.Created, range))
    .filter((s) => matchesQ(s.Title, s.RawCode, s.ScanNote, s.Location, scanItemName(s.Title)));

  const orderRows = orderStats
    .filter((os) => vendor === 'All vendors' || os.order.Vendor === vendor)
    .filter((os) => carrier === 'All carriers' || os.pkgs.some((p) => (p.Carrier || 'Other') === carrier))
    .filter((os) => inPastRange(os.order.Created, range))
    .filter((os) =>
      matchesQ(
        os.order.Vendor,
        os.order.PONumber,
        os.order.RequestedBy,
        os.order.Notes,
        ...os.pkgs.map((p) => p.Contents),
        ...os.pkgs.map((p) => p.Title),
      ),
    );

  const stats = useMemo(() => {
    const pkgs = data?.packages || [];
    return {
      receivedToday: pkgs.filter((p) => p.PkgStatus === 'received' && p.ReceivedAt && new Date(p.ReceivedAt).toDateString() === new Date().toDateString()).length,
      inTransit: pkgs.filter((p) => p.PkgStatus !== 'received' && !isOverdue(p)).length,
      overdue: pkgs.filter(isOverdue).length,
      openOrders: orderStats.filter((os) => os.status !== 'complete').length,
      onHandValue: pkgs.filter((p) => p.PkgStatus === 'received').reduce((s, p) => s + (p.Cost || 0), 0),
    };
  }, [data, orderStats]);

  const filtersActive = q.trim() !== '' || vendor !== 'All vendors' || carrier !== 'All carriers' || loc !== 'All locations' || range !== 'all';

  function clearFilters() {
    setQ('');
    setVendor('All vendors');
    setCarrier('All carriers');
    setLoc('All locations');
    setRange('all');
  }

  const statusBadge = (p: SPPackage) =>
    p.PkgStatus === 'received' ? (
      <span className="badge received">received</span>
    ) : isOverdue(p) ? (
      <span className="badge overdue">OVERDUE</span>
    ) : (
      <span className="badge waiting">expecting{ageDays(p.Created) > 0 ? ` · ${ageDays(p.Created)}d` : ''}</span>
    );

  const haveCols: Column<SPPackage>[] = [
    { key: 'item', label: 'Item', sort: (p) => itemName(p), render: (p) => <span className="item-name">{itemName(p)}</span> },
    { key: 'tracking', label: 'Tracking', sort: (p) => p.Title, render: (p) => <span className="tracking">{p.Title}</span> },
    { key: 'order', label: 'Vendor / PO', sort: (p) => orderLabel(p), render: (p) => orderLabel(p) },
    { key: 'carrier', label: 'Carrier', sort: (p) => p.Carrier || '', render: (p) => p.Carrier || '' },
    { key: 'location', label: 'Location', sort: (p) => p.ReceivedLocation || '', render: (p) => p.ReceivedLocation || '' },
    { key: 'cost', label: 'Cost', sort: (p) => String(1e9 + (p.Cost || 0)), render: (p) => fmtCost(p.Cost) },
    { key: 'received', label: 'Received', sort: (p) => p.ReceivedAt || '', render: (p) => fmtDate(p.ReceivedAt) },
  ];

  const expectingCols: Column<SPPackage>[] = [
    { key: 'item', label: 'Item', sort: (p) => itemName(p), render: (p) => <span className="item-name">{itemName(p)}</span> },
    { key: 'tracking', label: 'Tracking', sort: (p) => p.Title, render: (p) => <span className="tracking">{p.Title}</span> },
    { key: 'order', label: 'Vendor / PO', sort: (p) => orderLabel(p), render: (p) => orderLabel(p) },
    { key: 'carrier', label: 'Carrier', sort: (p) => p.Carrier || '', render: (p) => p.Carrier || '' },
    { key: 'cost', label: 'Cost', sort: (p) => String(1e9 + (p.Cost || 0)), render: (p) => fmtCost(p.Cost) },
    { key: 'eta', label: 'ETA', sort: (p) => p.ETA || '9999', render: (p) => fmtDay(p.ETA) },
    { key: 'status', label: 'Status', sort: (p) => (isOverdue(p) ? '0' : '1'), render: (p) => statusBadge(p) },
  ];

  const activityCols: Column<SPScan>[] = [
    { key: 'item', label: 'Item', sort: (s) => scanItemName(s.Title), render: (s) => <span className="item-name">{scanItemName(s.Title)}</span> },
    { key: 'code', label: 'Scanned code', sort: (s) => s.Title, render: (s) => <span className="tracking">{s.Title}</span> },
    { key: 'location', label: 'Location', sort: (s) => s.Location || '', render: (s) => s.Location || '' },
    { key: 'note', label: 'Note', sort: (s) => s.ScanNote || '', render: (s) => s.ScanNote || '' },
    { key: 'time', label: 'Time', sort: (s) => s.Created, render: (s) => fmtDate(s.Created) },
  ];

  const orderCols: Column<OrderStats & { Id: number }>[] = [
    {
      key: 'order',
      label: 'Order',
      sort: (o) => (o.order.Vendor || '') + (o.order.PONumber || ''),
      render: (o) => (
        <div>
          <div className="item-name">{o.order.Vendor}</div>
          <div className="tracking">{o.order.PONumber}</div>
        </div>
      ),
    },
    { key: 'requested', label: 'Requested by', sort: (o) => o.order.RequestedBy || '', render: (o) => o.order.RequestedBy || '' },
    {
      key: 'items',
      label: 'Items',
      sort: (o) => o.pkgs[0]?.Contents || '',
      render: (o) => {
        const first = o.pkgs[0]?.Contents || '';
        return o.pkgs.length > 1 ? `${first} +${o.pkgs.length - 1} more` : first;
      },
    },
    {
      key: 'progress',
      label: 'Packages',
      sort: (o) => String(o.total ? o.received / o.total : 0),
      render: (o) => (
        <div className="progress-cell">
          <span>
            {o.received} of {o.total}
          </span>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${o.total ? (o.received / o.total) * 100 : 0}%` }} />
          </div>
        </div>
      ),
    },
    { key: 'cost', label: 'Total cost', sort: (o) => String(1e9 + o.cost), render: (o) => fmtCost(o.cost) },
    { key: 'eta', label: 'Next ETA', sort: (o) => o.nextEta || '9999', render: (o) => fmtDay(o.nextEta) },
    {
      key: 'status',
      label: 'Status',
      sort: (o) => (o.hasOverdue ? '0' : o.status),
      render: (o) =>
        o.hasOverdue ? (
          <span className="badge overdue">OVERDUE</span>
        ) : o.status === 'complete' ? (
          <span className="badge received">complete</span>
        ) : o.status === 'partial' ? (
          <span className="badge waiting">partial</span>
        ) : (
          <span className="badge waiting">open</span>
        ),
    },
    { key: 'created', label: 'Ordered', sort: (o) => o.order.Created, render: (o) => fmtDay(o.order.Created) },
  ];

  const selPkg = sel?.type === 'pkg' ? (data?.packages || []).find((p) => p.Id === sel.id) : undefined;
  const selOrder = sel?.type === 'order' ? orderStats.find((o) => o.order.Id === sel.id) : undefined;

  const counts = { have: have.length, expecting: expecting.length, orders: orderRows.length, activity: activity.length };

  return (
    <div className="inventory">
      <div className="stat-strip">
        <div className="stat">
          <div className="stat-num">{stats.receivedToday}</div>
          <div className="stat-label">Received today</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.inTransit}</div>
          <div className="stat-label">In transit</div>
        </div>
        <div className={`stat ${stats.overdue > 0 ? 'alert' : ''}`}>
          <div className="stat-num">{stats.overdue}</div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.openOrders}</div>
          <div className="stat-label">Open orders</div>
        </div>
        <div className="stat wide">
          <div className="stat-num">{fmtCost(stats.onHandValue)}</div>
          <div className="stat-label">Received value</div>
        </div>
      </div>

      <div className="inv-controls">
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, tracking, vendor, PO" />
        <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
          {vendors.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
          {['All carriers', 'FedEx', 'UPS', 'USPS', 'Other'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={loc} onChange={(e) => setLoc(e.target.value)}>
          {locations.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
          <option value="all">All dates</option>
          <option value="today">Today</option>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
        </select>
        <button className="refresh" onClick={refresh} disabled={loading}>
          {loading ? '...' : 'Refresh'}
        </button>
        {filtersActive && (
          <button className="clear" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div className="chips">
        <button className={view === 'have' ? 'chip active' : 'chip'} onClick={() => setView('have')}>
          Have ({counts.have})
        </button>
        <button className={view === 'expecting' ? 'chip active' : 'chip'} onClick={() => setView('expecting')}>
          Expecting ({counts.expecting})
        </button>
        <button className={view === 'orders' ? 'chip active' : 'chip'} onClick={() => setView('orders')}>
          Orders ({counts.orders})
        </button>
        <button className={view === 'activity' ? 'chip active' : 'chip'} onClick={() => setView('activity')}>
          Activity ({counts.activity})
        </button>
      </div>

      {error && <p className="camera-error">{error}</p>}
      {!data && !error && <p className="hint">Loading inventory from SharePoint...</p>}

      {data && (
        <>
          <div className="table-view">
            {view === 'have' && (
              <DataTable columns={haveCols} rows={have} defaultSort="received" defaultDir="desc" onRowClick={(p) => setSel({ type: 'pkg', id: p.Id })} />
            )}
            {view === 'expecting' && (
              <DataTable columns={expectingCols} rows={expecting} defaultSort="eta" defaultDir="asc" onRowClick={(p) => setSel({ type: 'pkg', id: p.Id })} />
            )}
            {view === 'orders' && (
              <DataTable
                columns={orderCols}
                rows={orderRows.map((os) => ({ ...os, Id: os.order.Id }))}
                defaultSort="created"
                defaultDir="desc"
                onRowClick={(o) => setSel({ type: 'order', id: o.order.Id })}
              />
            )}
            {view === 'activity' && <DataTable columns={activityCols} rows={activity} defaultSort="time" defaultDir="desc" />}
          </div>

          <div className="cards-view">
            {view === 'have' &&
              have
                .sort((a, b) => (b.ReceivedAt || '').localeCompare(a.ReceivedAt || ''))
                .map((p) => (
                  <div key={p.Id} className="event matched" onClick={() => setSel({ type: 'pkg', id: p.Id })}>
                    <div className="event-top">
                      <span className="item-name">{itemName(p)}</span>
                      <span className="meta">{p.ReceivedLocation || '?'} · {fmtDate(p.ReceivedAt)}</span>
                    </div>
                    <div className="detail">
                      <span className="tracking small">{p.Title}</span> · {orderLabel(p)}
                      {p.Cost ? ` · ${fmtCost(p.Cost)}` : ''}
                    </div>
                  </div>
                ))}
            {view === 'expecting' &&
              expecting
                .sort((a, b) => (a.ETA || '9999').localeCompare(b.ETA || '9999'))
                .map((p) => (
                  <div key={p.Id} className={`event ${isOverdue(p) ? 'error' : 'unmatched'}`} onClick={() => setSel({ type: 'pkg', id: p.Id })}>
                    <div className="event-top">
                      <span className="item-name">{itemName(p)}</span>
                      <span className="meta">
                        {p.Carrier || ''}{p.ETA ? ` · ETA ${fmtDay(p.ETA)}` : ''}
                      </span>
                    </div>
                    <div className="detail">
                      <span className="tracking small">{p.Title}</span> · {orderLabel(p)}
                      {p.Cost ? ` · ${fmtCost(p.Cost)}` : ''}
                      {isOverdue(p) ? ' · OVERDUE' : ''}
                    </div>
                  </div>
                ))}
            {view === 'orders' &&
              orderRows.map((os) => (
                <div key={os.order.Id} className={`event ${os.hasOverdue ? 'error' : os.status === 'complete' ? 'matched' : 'unmatched'}`} onClick={() => setSel({ type: 'order', id: os.order.Id })}>
                  <div className="event-top">
                    <span className="item-name">{os.order.Vendor}</span>
                    <span className="meta">
                      {os.received} of {os.total} · {fmtCost(os.cost)}
                    </span>
                  </div>
                  <div className="detail">
                    <span className="tracking small">{os.order.PONumber}</span>
                    {os.order.RequestedBy ? ` · ${os.order.RequestedBy}` : ''}
                    {os.hasOverdue ? ' · OVERDUE' : os.nextEta ? ` · next ETA ${fmtDay(os.nextEta)}` : ''}
                  </div>
                </div>
              ))}
            {view === 'activity' &&
              activity.map((s) => (
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
          </div>

          {((view === 'have' && have.length === 0) ||
            (view === 'expecting' && expecting.length === 0) ||
            (view === 'orders' && orderRows.length === 0) ||
            (view === 'activity' && activity.length === 0)) && (
            <p className="hint">Nothing here{filtersActive ? ' matching the filters' : ''}.</p>
          )}
        </>
      )}

      {(selPkg || selOrder) && (
        <div className="drawer-backdrop" onClick={() => setSel(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" onClick={() => setSel(null)}>
              ✕
            </button>
            {selPkg && (
              <>
                <h3>{itemName(selPkg)}</h3>
                <div className="drawer-badges">{statusBadge(selPkg)}</div>
                <dl>
                  <dt>Tracking</dt>
                  <dd className="tracking">{selPkg.Title}</dd>
                  <dt>Order</dt>
                  <dd>
                    {orderLabel(selPkg)}
                    {selPkg.OrderRef && ordersById.get(selPkg.OrderRef)?.RequestedBy
                      ? ` (requested by ${ordersById.get(selPkg.OrderRef)!.RequestedBy})`
                      : ''}
                  </dd>
                  <dt>Carrier</dt>
                  <dd>{selPkg.Carrier || 'Unknown'}</dd>
                  {selPkg.Cost != null && (
                    <>
                      <dt>Cost</dt>
                      <dd>{fmtCost(selPkg.Cost)}</dd>
                    </>
                  )}
                  {selPkg.ETA && (
                    <>
                      <dt>ETA</dt>
                      <dd>{fmtDay(selPkg.ETA)}</dd>
                    </>
                  )}
                  {selPkg.ReceivedAt && (
                    <>
                      <dt>Received</dt>
                      <dd>
                        {fmtDate(selPkg.ReceivedAt)} at {selPkg.ReceivedLocation || '?'}
                      </dd>
                    </>
                  )}
                </dl>
                <h4>Scan history</h4>
                {(scansByTracking.get(selPkg.Title) || []).map((s) => (
                  <div key={s.Id} className="drawer-scan">
                    {fmtDate(s.Created)} · {s.Location || '?'}
                    {s.ScanNote ? ` · ${s.ScanNote}` : ''}
                  </div>
                ))}
                {!(scansByTracking.get(selPkg.Title) || []).length && <p className="hint">No scans yet.</p>}
              </>
            )}
            {selOrder && (
              <>
                <h3>{selOrder.order.Vendor}</h3>
                <div className="drawer-badges">
                  {selOrder.hasOverdue ? (
                    <span className="badge overdue">OVERDUE</span>
                  ) : (
                    <span className={`badge ${selOrder.status === 'complete' ? 'received' : 'waiting'}`}>{selOrder.status}</span>
                  )}
                </div>
                <dl>
                  <dt>PO</dt>
                  <dd className="tracking">{selOrder.order.PONumber}</dd>
                  {selOrder.order.RequestedBy && (
                    <>
                      <dt>Requested by</dt>
                      <dd>{selOrder.order.RequestedBy}</dd>
                    </>
                  )}
                  <dt>Progress</dt>
                  <dd>
                    {selOrder.received} of {selOrder.total} packages received
                  </dd>
                  <dt>Total cost</dt>
                  <dd>{fmtCost(selOrder.cost)}</dd>
                  {selOrder.order.Notes && (
                    <>
                      <dt>Notes</dt>
                      <dd>{selOrder.order.Notes}</dd>
                    </>
                  )}
                </dl>
                <h4>Packages</h4>
                {selOrder.pkgs.map((p) => (
                  <div key={p.Id} className="drawer-scan clickable" onClick={() => setSel({ type: 'pkg', id: p.Id })}>
                    <span className="item-name">{itemName(p)}</span>
                    <br />
                    <span className="tracking small">{p.Title}</span> · {statusBadge(p)}
                    {p.Cost ? ` · ${fmtCost(p.Cost)}` : ''}
                  </div>
                ))}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
