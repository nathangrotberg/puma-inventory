export interface ScanResult {
  matched: boolean;
  item?: string;
  packageId?: string;
  vendor?: string | null;
  po?: string | null;
  orderTitle?: string | null;
  totalPackages?: number | string;
  receivedPackages?: number | string;
}

export interface ImportResult {
  ok: boolean;
  orderId?: string;
  packagesCreated?: string;
}

export function flowUrl(): string {
  return localStorage.getItem('flowUrl') || (import.meta.env.VITE_FLOW_URL as string) || '';
}

// Content-Type text/plain keeps the request a CORS "simple request" (no
// preflight); the flow parses the body as JSON regardless.
async function post<T>(payload: unknown): Promise<T> {
  const url = flowUrl();
  if (!url) throw new Error('No intake endpoint configured. Open Settings and paste the flow URL.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Intake endpoint returned ${res.status}`);
  return (await res.json()) as T;
}

export function postScan(input: {
  tracking: string;
  raw: string;
  carrier: string;
  location: string;
  note?: string;
}): Promise<ScanResult> {
  return post<ScanResult>({ action: 'scan', ...input });
}

export interface SPOrder {
  Id: number;
  Title: string;
  Vendor?: string;
  PONumber?: string;
  OrderStatus?: string;
  Source?: string;
  ETA?: string | null;
  Notes?: string;
  Created: string;
}

export interface SPPackage {
  Id: number;
  Title: string;
  OrderRef?: number | null;
  Carrier?: string;
  PkgStatus?: string;
  ETA?: string | null;
  ReceivedAt?: string | null;
  ReceivedLocation?: string;
  Contents?: string;
  Created: string;
}

export interface SPScan {
  Id: number;
  Title: string;
  RawCode?: string;
  Location?: string;
  Carrier?: string;
  ScanNote?: string;
  Created: string;
}

export interface FetchResult {
  orders: SPOrder[];
  packages: SPPackage[];
  scans: SPScan[];
}

export function postFetch(): Promise<FetchResult> {
  return post<FetchResult>({ action: 'fetch' });
}

export function postImport(input: {
  vendor: string;
  po: string;
  eta?: string;
  notes?: string;
  packages: { tracking: string; carrier?: string; contents?: string; eta?: string; raw?: string }[];
}): Promise<ImportResult> {
  return post<ImportResult>({ action: 'import', ...input });
}
