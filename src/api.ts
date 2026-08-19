export interface ScanResult {
  matched: boolean;
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

export function postImport(input: {
  vendor: string;
  po: string;
  eta?: string;
  notes?: string;
  packages: { tracking: string; carrier?: string; contents?: string; eta?: string; raw?: string }[];
}): Promise<ImportResult> {
  return post<ImportResult>({ action: 'import', ...input });
}
