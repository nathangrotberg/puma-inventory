import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { parseScan } from '../tracking';
import { guessKind } from '../classify';
import { mxResolve, mxReceive, MxHealth } from '../api';
import { ALLOCATION_OPTIONS, label as facilityLabel, ReceiveLocation } from '../facilities';
import {
  GENERAL_INVENTORY,
  MxAssetHit,
  MxPartHit,
  ReceiveResponse,
  ResolveResponse,
} from '../mxContract';

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 320;
    gain.gain.value = 0.1;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    /* audio optional */
  }
  if (navigator.vibrate) navigator.vibrate(ok ? 80 : [80, 60, 80]);
}

const money = (cents?: number | null) =>
  cents == null ? '' : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

interface Props {
  receiveLocation: ReceiveLocation;
  facilityHandle: string;
  onFacilityChange: (h: string) => void;
  health: MxHealth | null;
}

export default function Receive({ receiveLocation, facilityHandle, onFacilityChange, health }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const recentRef = useRef<Map<string, number>>(new Map());
  const [cameraError, setCameraError] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [pick, setPick] = useState<{ kind: 'part' | 'asset'; id: number } | null>(null);
  const [qty, setQty] = useState('1');
  const [po, setPo] = useState('');
  const [newName, setNewName] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newKind, setNewKind] = useState<'part' | 'asset'>('part');
  const [result, setResult] = useState<ReceiveResponse | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // Keep the camera callback reading current props without re-mounting it.
  const ctx = useRef({ receiveLocation, facilityHandle });
  ctx.current = { receiveLocation, facilityHandle };

  function reset() {
    setResolved(null);
    setPick(null);
    setResult(null);
    setQty('1');
    setPo('');
    setNewName('');
    setNewCost('');
  }

  async function handleCode(raw: string) {
    const now = Date.now();
    const seen = recentRef.current.get(raw);
    if (seen && now - seen < 8000) return; // ignore rapid re-reads of one label
    recentRef.current.set(raw, now);

    reset();
    setBusy(true);
    try {
      const t = parseScan(raw);
      const r = await mxResolve(raw, { tracking: t.tracking, carrier: t.carrier });
      setResolved(r);
      // Auto-select when there is exactly one candidate. Never when there are
      // several: 73 barcodes and 97 serials in the org are duplicated, and
      // picking for the operator would move the wrong record.
      if (r.parts.length === 1 && r.assets.length === 0) setPick({ kind: 'part', id: r.parts[0].id });
      else if (r.assets.length === 1 && r.parts.length === 0) setPick({ kind: 'asset', id: r.assets[0].id });
      if (r.kind === 'unknown' || r.kind === 'tracking') {
        setNewKind(guessKind(raw).kind === 'serial' ? 'asset' : 'part');
        setNewName('');
      }
      beep(r.kind === 'part' || r.kind === 'asset');
    } catch (err) {
      beep(false);
      setResolved(null);
      setLog((l) => [`Resolve failed: ${String(err)}`, ...l.slice(0, 9)]);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!resolved) return;
    setBusy(true);
    try {
      const target =
        pick?.kind === 'part'
          ? ({ kind: 'part', partId: pick.id } as const)
          : pick?.kind === 'asset'
            ? ({ kind: 'asset', assetId: pick.id } as const)
            : newKind === 'part'
              ? ({
                  kind: 'newPart',
                  name: newName.trim(),
                  unitCostCents: newCost.trim() ? Math.round(Number(newCost) * 100) : undefined,
                } as const)
              : ({ kind: 'newAsset', name: newName.trim(), serialNumber: resolved.normalized } as const);

      const r = await mxReceive({
        code: resolved.normalized,
        target,
        locationId: ctx.current.receiveLocation.locationId,
        facilityHandle: ctx.current.facilityHandle,
        quantity: Number(qty) || 1,
        poNumber: po.trim() || undefined,
      });
      setResult(r);
      beep(r.ok);
      setLog((l) => [
        `${r.dryRun ? 'DRY RUN' : 'Wrote'} ${resolved.normalized} -> ${facilityLabel(ctx.current.facilityHandle)}`,
        ...l.slice(0, 9),
      ]);
    } catch (err) {
      beep(false);
      setLog((l) => [`Receive failed: ${String(err)}`, ...l.slice(0, 9)]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;
    (async () => {
      try {
        controlsRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (res) => {
          if (res && !cancelled) handleCode(res.getText());
        });
      } catch (err) {
        setCameraError(`Camera unavailable. Grant camera permission, or type the code below. (${String(err)})`);
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCommit = pick != null || (resolved != null && newName.trim().length > 1);

  return (
    <div className="scanner">
      {health && !health.writesEnabled && (
        <p className="banner warn">
          Dry run. The proxy is not authorised to write, so a receive shows the exact request it would
          send and changes nothing in MaintainX.
        </p>
      )}
      {health && health.writesEnabled && !health.allocationFieldsReady && (
        <p className="banner warn">
          Writing is on, but the MaintainX custom fields <code>Facility Handle</code> and{' '}
          <code>PO Number</code> do not exist yet, so allocation is stored in <code>externalId</code>.
        </p>
      )}

      <div className="alloc">
        <label>
          <span>Allocate to</span>
          <select value={facilityHandle} onChange={(e) => onFacilityChange(e.target.value)}>
            {ALLOCATION_OPTIONS.map((f) => (
              <option key={f.handle} value={f.handle}>
                {f.handle === GENERAL_INVENTORY ? f.name : `${f.handle} — ${f.name}`}
                {f.locationId ? '' : ' (no MaintainX location)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>PO number (optional)</span>
          <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="BKD-260336-RW-II" />
        </label>
        <p className="alloc-note">
          Landing at <strong>{receiveLocation.path}</strong>
        </p>
      </div>

      <div className="viewport">
        <video ref={videoRef} muted playsInline />
        <div className="reticle" />
      </div>
      {cameraError && <p className="camera-error">{cameraError}</p>}

      <form
        className="manual"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            handleCode(manual.trim());
            setManual('');
          }
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          // A handheld wedge scanner types the code then sends Enter. Native
          // form submission covers that, but this makes it explicit so the
          // scanner path cannot depend on default button behaviour.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (manual.trim()) {
                handleCode(manual.trim());
                setManual('');
              }
            }
          }}
          placeholder="Scan or type a barcode, serial, or tracking number"
          autoCapitalize="characters"
          autoCorrect="off"
        />
        <button type="submit" disabled={busy}>
          {busy ? '...' : 'Look up'}
        </button>
      </form>

      {resolved && !result && (
        <div className="resolve">
          <div className="resolve-head">
            <span className={`kind ${resolved.kind}`}>{resolved.kind}</span>
            <span className="code">{resolved.normalized}</span>
          </div>
          <p className="reason">{resolved.reason}</p>

          {resolved.dataQuality?.map((d, i) => (
            <p key={i} className="banner warn">
              {d}
            </p>
          ))}

          {resolved.parts.map((p: MxPartHit) => (
            <button
              key={p.id}
              className={pick?.kind === 'part' && pick.id === p.id ? 'hit selected' : 'hit'}
              onClick={() => setPick({ kind: 'part', id: p.id })}
            >
              <span className="hit-name">{p.name}</span>
              <span className="hit-meta">
                part {p.id} · {money(p.unitCostCents)} ·{' '}
                {p.locations.length
                  ? p.locations.map((l) => `${l.availableQuantity} at ${l.locationName ?? l.locationId}`).join(', ')
                  : 'no stock recorded'}
              </span>
            </button>
          ))}

          {resolved.assets.map((a: MxAssetHit) => (
            <button
              key={a.id}
              className={pick?.kind === 'asset' && pick.id === a.id ? 'hit selected' : 'hit'}
              onClick={() => setPick({ kind: 'asset', id: a.id })}
            >
              <span className="hit-name">{a.name}</span>
              <span className="hit-meta">
                asset {a.id} · serial {a.serialNumber ?? 'none'} · at {a.locationName ?? 'unknown'}
              </span>
            </button>
          ))}

          {(resolved.kind === 'unknown' || resolved.kind === 'tracking') && (
            <div className="create">
              <p className="hint">
                {resolved.kind === 'tracking'
                  ? 'A shipping label, so nothing in MaintainX matches yet. Record what is in the box.'
                  : 'Nothing in MaintainX matches. Create it.'}
              </p>
              <div className="create-row">
                <select value={newKind} onChange={(e) => setNewKind(e.target.value as 'part' | 'asset')}>
                  <option value="part">Part (countable, over $100)</option>
                  <option value="asset">Asset (serialised, high value)</option>
                </select>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={newKind === 'asset' ? 'P.W. - Red Lion DA50 - 0042' : 'Phoenix terminal block 3210499'}
                />
              </div>
              {newKind === 'part' && (
                <input
                  className="cost"
                  value={newCost}
                  onChange={(e) => setNewCost(e.target.value)}
                  placeholder="Unit cost in dollars, e.g. 425.00"
                  inputMode="decimal"
                />
              )}
            </div>
          )}

          <div className="commit-row">
            {(pick?.kind === 'part' || newKind === 'part') && (
              <label className="qty">
                <span>Qty</span>
                <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
              </label>
            )}
            <button className="primary" disabled={!canCommit || busy} onClick={commit}>
              {health?.writesEnabled ? 'Receive' : 'Preview receive'}
            </button>
            <button onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className={`result ${result.ok ? 'ok' : 'bad'}`}>
          <div className="resolve-head">
            <span className={`kind ${result.dryRun ? 'tracking' : 'part'}`}>
              {result.dryRun ? 'dry run' : 'written'}
            </span>
            <button onClick={reset}>Next item</button>
          </div>
          {result.error && <p className="banner warn">{result.error}</p>}

          {result.readBack && (
            <div className="readback">
              <p className="hint">
                Read back from MaintainX. Open MaintainX and you should see exactly this.
              </p>
              <pre>{JSON.stringify(result.readBack, null, 1)}</pre>
            </div>
          )}

          {result.dryRun && (
            <div className="readback">
              <p className="hint">This is the request that was withheld:</p>
              <pre>{JSON.stringify(result.wouldSend, null, 1)}</pre>
              {result.before && (
                <>
                  <p className="hint">Current state in MaintainX, unchanged:</p>
                  <pre>{JSON.stringify(result.before, null, 1)}</pre>
                </>
              )}
            </div>
          )}

          {result.warnings.map((w, i) => (
            <p key={i} className="banner warn">
              {w}
            </p>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <div className="events">
          {log.map((l, i) => (
            <div key={i} className="event">
              <div className="detail">{l}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
