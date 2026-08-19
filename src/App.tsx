import { useEffect, useState } from 'react';
import Scanner from './components/Scanner';
import ImportForm from './components/ImportForm';
import { flowUrl } from './api';

const LOCATIONS = ['Redding', 'Visalia', 'Meadowview', 'Site - Other'];

const LISTS_URL =
  'https://maasenergy.sharepoint.com/sites/ArtificialIntelligence/Lists/PUMA%20Inventory%20Packages/AllItems.aspx';

export default function App() {
  const [tab, setTab] = useState<'scan' | 'expect'>('scan');
  const [location, setLocation] = useState(() => localStorage.getItem('location') || 'Redding');
  const [showSettings, setShowSettings] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');

  useEffect(() => {
    localStorage.setItem('location', location);
  }, [location]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-name">PUMA Works</span>
          <span className="brand-sub">Inventory Intake</span>
        </div>
        <select
          className="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          aria-label="Receiving location"
        >
          {LOCATIONS.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <button className="gear" onClick={() => setShowSettings((s) => !s)} aria-label="Settings">
          ⚙
        </button>
      </header>

      {showSettings && (
        <div className="settings">
          <p>
            Intake endpoint: {flowUrl() ? 'configured' : 'NOT CONFIGURED'}. Paste a new flow URL to
            override on this device only.
          </p>
          <input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://..." />
          <button
            onClick={() => {
              if (urlDraft.trim()) localStorage.setItem('flowUrl', urlDraft.trim());
              setUrlDraft('');
              setShowSettings(false);
            }}
          >
            Save
          </button>
        </div>
      )}

      <nav>
        <button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>
          Scan received
        </button>
        <button className={tab === 'expect' ? 'active' : ''} onClick={() => setTab('expect')}>
          Add expected
        </button>
        <a href={LISTS_URL} target="_blank" rel="noreferrer">
          Inventory lists
        </a>
      </nav>

      <main>{tab === 'scan' ? <Scanner location={location} /> : <ImportForm />}</main>

      <footer>
        <span>Maas Energy Works · PUMA Works inventory POC (O24)</span>
      </footer>
    </div>
  );
}
