import raw from './facilities.json';
import { GENERAL_INVENTORY } from './mxContract';

export interface Facility {
  handle: string;
  name: string;
  payingEntity: string;
  poCount: number;
  locationId: number | null;
  locationName: string | null;
  ambiguous?: boolean;
  alternates?: { id: number; name: string }[];
}

export interface ReceiveLocation {
  key: string;
  locationId: number;
  path: string;
}

const data = raw as {
  generatedAt: string;
  matched: number;
  total: number;
  facilities: Facility[];
  receiveLocations: ReceiveLocation[];
};

export const GENERATED_AT = data.generatedAt;

/** Where PUMA physically receives. CT3 is the Tech Hub in Redding and is where
 *  the org's PUMA-named assets already sit; `Redding, CA` itself is a roll-up
 *  node with ten children that stocks nothing, so it is deliberately absent. */
export const RECEIVE_LOCATIONS = data.receiveLocations;

/** `MEW` is QuickBase's handle for "not allocated to a facility" and covers 180
 *  of 292 PUMA POs. It is presented as General Inventory rather than as a real
 *  facility so nobody reads it as a place. */
export const UNALLOCATED: Facility = {
  handle: GENERAL_INVENTORY,
  name: 'General Inventory (not yet allocated)',
  payingEntity: 'Maas Energy Works, LLC',
  poCount: data.facilities.find((f) => f.handle === 'MEW')?.poCount ?? 0,
  locationId: null,
  locationName: null,
};

/** Real facilities, busiest first, with the MEW placeholder pulled out. */
export const FACILITIES: Facility[] = data.facilities.filter((f) => f.handle !== 'MEW');

export const ALLOCATION_OPTIONS: Facility[] = [UNALLOCATED, ...FACILITIES];

export function facility(handle: string): Facility | undefined {
  if (handle === GENERAL_INVENTORY || handle === 'MEW') return UNALLOCATED;
  return FACILITIES.find((f) => f.handle === handle);
}

export function label(handle: string): string {
  const f = facility(handle);
  if (!f) return handle;
  return f.handle === GENERAL_INVENTORY ? f.name : `${f.handle} — ${f.name}`;
}

/** Facilities with no MaintainX location cannot be an issue destination yet.
 *  As of 2026-09-08 that is CHD (CDF Howard, the live pilot), OVH and RCC. */
export const UNMAPPED = FACILITIES.filter((f) => !f.locationId).map((f) => f.handle);
