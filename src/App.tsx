import { useEffect, useState } from 'react';
import Scanner from './components/Scanner';
import Receive from './components/Receive';
import ImportForm from './components/ImportForm';
import Inventory from './components/Inventory';
import OnHand from './components/OnHand';
import { flowUrl, mxUrl, mxHealth, MxHealth } from './api';
import { RECEIVE_LOCATIONS, GENERATED_AT } from './facilities';
import { GENERAL_INVENTORY } from './mxContract';

const LISTS_URL =
  'https://maasenergy.sharepoint.com/sites/ArtificialIntelligence/SitePages/PUMA-Inventory.aspx';

type Tab = 'receive' | 'onhand' | 'expect' | 'scan' | 'inventory';

export default function App() {
  const [tab, setTab] = useState<Tab>('receive');
  const [locKey, setLocKey] = useState(() => localStorage.getItem('location') || 'Redding');
  const [facilityHandle, setFacilityHandle] = useState(
    () => localStorage.getItem('facilityHandle') || GENERAL_INVENTORY,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [flowDraft, setFlowDraft] = useState('');
  const [mxDraft, setMxDraft] = useState('');
  const [health, setHealth] = useState<MxHealth | null>(null);

  const receiveLocation =
    RECEIVE_LOCATIONS.find((l) => l.key === locKey) || RECEIVE_LOCATIONS[0];

  useEffect(() => localStorage.setItem('location', locKey), [locKey]);
  useEffect(() => localStorage.setItem('facilityHandle', facilityHandle), [facilityHandle]);
  useEffect(() => {
    mxHealth().then(setHealth);
  }, []);

  const wide = tab === 'inventory' || tab === 'onhand';

  return (
    <div className={wide ? 'app wide' : 'app'}>
      <header>
        <div className="brand">
          <span className="brand-name">PUMA Works</span>
          <span className="brand-sub">Inventory</span>
        </div>
        <select
          className="location"
          value={locKey}
          onChange={(e) => setLocKey(e.target.value)}
          aria-label="Receiving location"
        >
          {RECEIVE_LOCATIONS.map((l) => (
            <option key={l.key} value={l.key}>
              {l.key}
            </option>
          ))}
        </select>
        <button className="gear" onClick={() => setShowSettings((s) => !s)} aria-label="Settings">
          ⚙
        </button>
      </header>

      {showSettings && (
        <div className="settings">
          <p>
            <strong>MaintainX proxy</strong>: {mxUrl() ? 'configured' : 'NOT CONFIGURED'}
            {health
              ? ` · writes ${health.writesEnabled ? 'ENABLED' : 'withheld'} · allocation fields ${
                  health.allocationFieldsReady ? 'ready' : 'not created'
                }${health.indexed ? ` · ${health.indexed.parts} parts, ${health.indexed.assets} assets indexed` : ''}`
              : mxUrl()
                ? ' · not reachable'
                : ''}
          </p>
          <input value={mxDraft} onChange={(e) => setMxDraft(e.target.value)} placeholder="https://... MaintainX proxy" />
          <button
            onClick={() => {
              if (mxDraft.trim()) localStorage.setItem('mxUrl', mxDraft.trim());
              setMxDraft('');
              mxHealth().then(setHealth);
            }}
          >
            Save MaintainX URL
          </button>
          <p>
            <strong>SharePoint intake flow</strong> (retired POC):{' '}
            {flowUrl() ? 'configured' : 'NOT CONFIGURED'}
          </p>
          <input value={flowDraft} onChange={(e) => setFlowDraft(e.target.value)} placeholder="https://... flow URL" />
          <button
            onClick={() => {
              if (flowDraft.trim()) localStorage.setItem('flowUrl', flowDraft.trim());
              setFlowDraft('');
              setShowSettings(false);
            }}
          >
            Save flow URL
          </button>
          <p className="hint">
            Facility map generated {GENERATED_AT} from QuickBase Systems POs joined to MaintainX
            locations. Regenerate with <code>scripts/build-facilities.mjs</code>.
          </p>
        </div>
      )}

      <nav>
        <button className={tab === 'receive' ? 'active' : ''} onClick={() => setTab('receive')}>
          Receive
        </button>
        <button className={tab === 'onhand' ? 'active' : ''} onClick={() => setTab('onhand')}>
          On hand
        </button>
        <button className={tab === 'expect' ? 'active' : ''} onClick={() => setTab('expect')}>
          En route
        </button>
        <button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>
          Log a package
        </button>
        <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')}>
          Packages (POC)
        </button>
      </nav>

      <main>
        {tab === 'receive' && (
          <Receive
            receiveLocation={receiveLocation}
            facilityHandle={facilityHandle}
            onFacilityChange={setFacilityHandle}
            health={health}
          />
        )}
        {tab === 'onhand' && <OnHand />}
        {tab === 'expect' && <ImportForm />}
        {tab === 'scan' && <Scanner location={locKey} />}
        {tab === 'inventory' && <Inventory />}
      </main>

      <footer>
        <span>
          Maas Energy Works · PUMA Works inventory · Receive and On hand write to{' '}
          <strong>MaintainX</strong>; En route, Log a package and Packages remain the SharePoint POC ·{' '}
          <a className="footer-link" href={LISTS_URL} target="_blank" rel="noreferrer">
            SharePoint
          </a>
        </span>
      </footer>
    </div>
  );
}
