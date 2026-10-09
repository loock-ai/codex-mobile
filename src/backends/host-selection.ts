import type {BackendConfig,DesktopHost} from './types';

export function normalizeDesktopHosts(value: unknown): DesktopHost[] {
  if (!Array.isArray(value)) return [];
  const hosts = new Map<string,DesktopHost>();
  for (const host of value) {
    if (typeof host?.hostId !== 'string' || !host.hostId.trim() || typeof host.displayName !== 'string') continue;
    const hostId = host.hostId.trim();
    hosts.set(hostId, {hostId, displayName:host.displayName.trim() || hostId});
    if (hosts.size >= 256) break;
  }
  return [...hosts.values()];
}

export function hostPreferences(value: Partial<BackendConfig>) {
  return {
    ...(Array.isArray(value.desktopHosts) ? {desktopHosts:normalizeDesktopHosts(value.desktopHosts)} : {}),
    ...(Array.isArray(value.visibleHostIds) ? {visibleHostIds:[...new Set(value.visibleHostIds.filter(id=>typeof id==='string' && id.trim()).map(id=>id.trim()))].slice(0,256)} : {}),
  };
}

export function displayedHostIds(backend: Partial<BackendConfig>, hosts: DesktopHost[]) {
  return backend.visibleHostIds ?? (backend.remoteProjects ? ['local', ...hosts.filter(h=>h.hostId!=='local').map(h=>h.hostId)] : ['local']);
}
