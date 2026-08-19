import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { parseScan } from '../tracking';
import { postScan, ScanResult } from '../api';

export interface ScanEvent {
  id: number;
  tracking: string;
  carrier: string;
  location: string;
  status: 'pending' | 'matched' | 'unmatched' | 'error';
  detail: string;
}

let nextId = 1;

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

export default function Scanner({ location }: { location: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const recentRef = useRef<Map<string, number>>(new Map());
  const [cameraError, setCameraError] = useState('');
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [manual, setManual] = useState('');
  const locationRef = useRef(location);
  locationRef.current = location;

  async function handleCode(rawCode: string) {
    const now = Date.now();
    const seenAt = recentRef.current.get(rawCode);
    if (seenAt && now - seenAt < 8000) return; // ignore rapid re-reads of the same label
    recentRef.current.set(rawCode, now);

    const { tracking, carrier } = parseScan(rawCode);
    const id = nextId++;
    setEvents((e) => [
      { id, tracking, carrier, location: locationRef.current, status: 'pending', detail: 'Logging...' },
      ...e.slice(0, 19),
    ]);
    try {
      const r: ScanResult = await postScan({
        tracking,
        raw: rawCode,
        carrier,
        location: locationRef.current,
      });
      beep(r.matched);
      setEvents((e) =>
        e.map((ev) =>
          ev.id === id
            ? {
                ...ev,
                status: r.matched ? 'matched' : 'unmatched',
                detail: r.matched
                  ? `${r.vendor || 'Order'} ${r.po || ''} — package ${r.receivedPackages} of ${r.totalPackages} received`
                  : 'No expected shipment on file. Logged anyway.',
              }
            : ev,
        ),
      );
    } catch (err) {
      beep(false);
      setEvents((e) =>
        e.map((ev) => (ev.id === id ? { ...ev, status: 'error', detail: String(err) } : ev)),
      );
    }
  }

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;
    (async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (result && !cancelled) handleCode(result.getText());
          },
        );
        controlsRef.current = controls;
      } catch (err) {
        setCameraError(
          'Camera unavailable. Grant camera permission, or use manual entry below. (' +
            String(err) +
            ')',
        );
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scanner">
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
          placeholder="Type or wedge-scan a tracking number"
          autoCapitalize="characters"
          autoCorrect="off"
        />
        <button type="submit">Log</button>
      </form>

      <div className="events">
        {events.map((ev) => (
          <div key={ev.id} className={`event ${ev.status}`}>
            <div className="event-top">
              <span className="tracking">{ev.tracking}</span>
              <span className="meta">
                {ev.carrier} · {ev.location}
              </span>
            </div>
            <div className="detail">{ev.detail}</div>
          </div>
        ))}
        {events.length === 0 && (
          <p className="hint">Point the camera at the shipping label barcode. Every scan is logged, matched or not.</p>
        )}
      </div>
    </div>
  );
}
