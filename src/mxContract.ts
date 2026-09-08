// The JSON contract between this app and the MaintainX proxy. Both sides import
// these types so a change to one is a compile error in the other.
//
// The app never holds the MaintainX API key. Every MaintainX call goes through
// the proxy, which keeps the bearer token server-side and sets CORS.

export const GENERAL_INVENTORY = 'GENERAL_INVENTORY';

/** What a scanned code turned out to be, decided by lookup rather than shape. */
export type CodeKind = 'part' | 'asset' | 'tracking' | 'unknown';

export interface MxPartHit {
  id: number;
  name: string;
  barcode: string | null;
  unitCostCents: number | null;
  /** Quantity at each location the part is stocked in. */
  locations: { locationId: number; locationName: string | null; availableQuantity: number }[];
  extraFields: Record<string, string>;
}

export interface MxAssetHit {
  id: number;
  name: string;
  serialNumber: string | null;
  locationId: number | null;
  locationName: string | null;
  extraFields: Record<string, string>;
}

export interface ResolveRequest {
  action: 'mx-resolve';
  code: string;
}

export interface ResolveResponse {
  code: string;
  normalized: string;
  kind: CodeKind;
  /** Lookup can return more than one: 73 part barcodes and 96 asset serials in
   *  the org are duplicated, so the caller has to disambiguate. */
  parts: MxPartHit[];
  assets: MxAssetHit[];
  tracking?: { tracking: string; carrier: string };
  /** Problems with the matched records themselves: a duplicated barcode or
   *  serial, or a value that is not really a serial. Surfaced to the operator
   *  because receiving against a duplicate moves the wrong thing. */
  dataQuality: string[];
  /** Why the resolver landed on this kind. Shown in the UI, not just logged. */
  reason: string;
}

export type ReceiveTarget =
  | { kind: 'part'; partId: number }
  | { kind: 'asset'; assetId: number }
  | { kind: 'newPart'; name: string; unitCostCents?: number }
  | { kind: 'newAsset'; name: string; serialNumber?: string };

export interface ReceiveRequest {
  action: 'mx-receive';
  code: string;
  target: ReceiveTarget;
  /** Where it physically landed. */
  locationId: number;
  /** The allocation key: a QuickBase facility handle, or GENERAL_INVENTORY. */
  facilityHandle: string;
  quantity?: number;
  poNumber?: string;
  note?: string;
}

export interface WriteOp {
  method: 'POST' | 'PATCH';
  path: string;
  body: unknown;
}

export interface ReceiveResponse {
  ok: boolean;
  /** True when the proxy is not authorised to write. `wouldSend` is then the
   *  exact request it withheld, which is what makes a dry run reviewable. */
  dryRun: boolean;
  wouldSend: WriteOp[];
  /** GET of the record after writing. The operator should see the same thing in
   *  MaintainX; that read-back is the proof the 09-02 room asked for. */
  readBack?: MxPartHit | MxAssetHit;
  /** State before the write, always returned so a dry run still shows truth. */
  before?: MxPartHit | MxAssetHit;
  warnings: string[];
  error?: string;
}

export interface OnHandRequest {
  action: 'mx-onhand';
  locationIds?: number[];
}

export interface OnHandResponse {
  asOf: string;
  locations: { locationId: number; name: string; partLines: number; assets: number }[];
  parts: MxPartHit[];
  assets: MxAssetHit[];
}

export interface IssueRequest {
  action: 'mx-issue';
  target: { kind: 'part'; partId: number } | { kind: 'asset'; assetId: number };
  /** Move stock or an asset from its current node onto a facility. */
  toFacilityHandle: string;
  toLocationId?: number;
  fromLocationId?: number;
  quantity?: number;
  note?: string;
}

export type MxRequest = ResolveRequest | ReceiveRequest | OnHandRequest | IssueRequest;
