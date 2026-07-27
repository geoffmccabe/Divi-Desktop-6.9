// What the user has agreed each app may do.
//
// Stored per app id and compared against the manifest on every launch, so an
// update that quietly adds a permission cannot inherit the old consent: the
// prompt appears again for anything not already granted.

import type { PermissionKey } from "./permissions";

const KEY = "dd69.app.grants";

type GrantMap = Record<string, { permissions: PermissionKey[]; version: string }>;

function load(): GrantMap {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null ? (parsed as GrantMap) : {};
  } catch {
    return {};
  }
}

function save(map: GrantMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Losing a grant record is safe: the user is simply asked again.
  }
}

export function grantedFor(appId: string): PermissionKey[] {
  return load()[appId]?.permissions ?? [];
}

/** True when every permission the manifest asks for has already been agreed. */
export function isFullyGranted(appId: string, wanted: PermissionKey[]): boolean {
  const have = new Set(grantedFor(appId));
  return wanted.every((p) => have.has(p));
}

export function grant(appId: string, permissions: PermissionKey[], version: string): void {
  const map = load();
  map[appId] = { permissions, version };
  save(map);
}

export function revoke(appId: string): void {
  const map = load();
  delete map[appId];
  save(map);
}
