import { useSyncExternalStore } from 'react';
import { getCatalogRevision, subscribeCatalogChanges } from '../services/catalogCache';
import { shouldUseLocalCatalog } from './localCatalog';

function subscribe(onChange: () => void) {
  return shouldUseLocalCatalog() ? subscribeCatalogChanges(onChange) : () => {};
}

function snapshot() {
  return shouldUseLocalCatalog() ? getCatalogRevision() : 0;
}

export function useLocalCatalogRevision(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
