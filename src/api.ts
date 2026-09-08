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
  RequestedBy?: string;
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
  Cost?: number | null;
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
  requestedBy?: string;
  packages: { tracking: string; carrier?: string; contents?: string; eta?: string; raw?: string; cost?: string }[];
}): Promise<ImportResult> {
  return post<ImportResult>({ action: 'import', ...input });
}

// ---------------------------------------------------------------- MaintainX
// MaintainX is reached through its own proxy, not the SharePoint flow: the
// proxy holds the bearer token server-side. Configured separately so the
// retired SharePoint POC keeps working while MaintainX becomes the database.

import type {
  ResolveResponse,
  ReceiveRequest,
  ReceiveResponse,
  OnHandResponse,
  IssueRequest,
} from './mxContract';

export function mxUrl(): string {
  return localStorage.getItem('mxUrl') || (import.meta.env.VITE_MX_URL as string) || '';
}

async function mxPost<T>(payload: unknown): Promise<T> {
  const url = mxUrl();
  if (!url) throw new Error('No MaintainX endpoint configured. Open Settings and paste the proxy URL.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `MaintainX proxy returned ${res.status}`);
  return body as T;
}

export function mxResolve(code: string, tracking?: { tracking: string; carrier: string }) {
  return mxPost<ResolveResponse>({ action: 'mx-resolve', code, tracking });
}

export function mxReceive(req: Omit<ReceiveRequest, 'action'>) {
  return mxPost<ReceiveResponse>({ action: 'mx-receive', ...req });
}

export function mxOnHand(locationIds?: number[]) {
  return mxPost<OnHandResponse>({ action: 'mx-onhand', locationIds });
}

export function mxIssue(req: Omit<IssueRequest, 'action'>) {
  return mxPost<ReceiveResponse>({ action: 'mx-issue', ...req });
}

export interface MxHealth {
  ok: boolean;
  writesEnabled: boolean;
  allocationFieldsReady: boolean;
  indexed: { parts: number; assets: number } | null;
}

export async function mxHealth(): Promise<MxHealth | null> {
  const url = mxUrl();
  if (!url) return null;
  try {
    const res = await fetch(url.replace(/\/?$/, '/') + 'health');
    return res.ok ? ((await res.json()) as MxHealth) : null;
  } catch {
    return null;
  }
}
