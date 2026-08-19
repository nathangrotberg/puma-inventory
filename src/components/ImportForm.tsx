import { useState } from 'react';
import { parseScan } from '../tracking';
import { postImport } from '../api';

export default function ImportForm() {
  const [vendor, setVendor] = useState('');
  const [po, setPo] = useState('');
  const [eta, setEta] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const packages = lines
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [num, contents] = l.split('|').map((p) => p.trim());
        const parsed = parseScan(num);
        return { tracking: parsed.tracking, carrier: parsed.carrier, contents: contents || '', raw: num, eta };
      });
    if (!vendor || packages.length === 0) {
      setStatus('Vendor and at least one tracking number are required.');
      return;
    }
    setBusy(true);
    setStatus('Creating order...');
    try {
      const r = await postImport({ vendor, po, eta, notes, packages });
      setStatus(r.ok ? `Order ${r.orderId} created with ${r.packagesCreated} package(s). Now expecting them.` : 'Import failed.');
      setVendor('');
      setPo('');
      setEta('');
      setNotes('');
      setLines('');
    } catch (err) {
      setStatus(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="import" onSubmit={submit}>
      <p className="hint">
        Log what is on the way: paste the tracking numbers from the vendor's ship
        notification. One per line, optional contents after a pipe:
        <code> 1Z... | 24-port switch</code>
      </p>
      <label>
        Vendor
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. North Valley" />
      </label>
      <label>
        PO number
        <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="optional" />
      </label>
      <label>
        ETA
        <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
      </label>
      <label>
        Tracking numbers
        <textarea rows={5} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'1Z999AA10123456784 | data logger\n779841234567'} />
      </label>
      <label>
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Working...' : 'Add expected shipment'}
      </button>
      {status && <p className="status">{status}</p>}
    </form>
  );
}
