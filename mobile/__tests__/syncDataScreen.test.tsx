import React from 'react';
import { act, create } from 'react-test-renderer';
import { Button } from 'react-native-paper';
import SyncDataScreen from '../src/screens/settings/SyncDataScreen';
import { syncNow } from '../src/offline/syncEngine';

const mockConnectivity = {
  online: true, syncing: false, pendingCount: 2, lastSyncAt: null,
  lastSyncError: 'network error detail',
  setLastSyncAt: jest.fn(), setPendingCount: jest.fn(),
};

jest.mock('react-native-paper', () => ({
  ActivityIndicator: 'ActivityIndicator', Button: 'Button', Text: 'Text',
}));
jest.mock('../src/components/ui/SectionCard', () => 'SectionCard');
jest.mock('../src/i18n', () => ({
  useT: () => (text: string, values?: Record<string, number>) =>
    Object.entries(values || {}).reduce((result, [key, value]) => result.replace(`{{${key}}}`, String(value)), text),
}));
jest.mock('../src/offline/capability', () => ({ isDesktopOfflineCapable: () => true }));
jest.mock('../src/offline/connectivityStore', () => ({
  useConnectivityStore: (selector: (state: typeof mockConnectivity) => unknown) => selector(mockConnectivity),
}));
jest.mock('../src/offline/sqliteApi', () => ({
  sqliteGetMeta: jest.fn(async () => null),
  sqlitePendingCount: jest.fn(async () => 2),
  sqliteStatus: jest.fn(async () => ({
    pendingSales: 2, pendingQueue: 1, localOnlyCount: 3,
    localOnlyRecords: [{ type: 'sale', id: 'secret-id', error: 'record error detail' }],
  })),
}));
jest.mock('../src/offline/syncEngine', () => ({
  syncNow: jest.fn(async () => ({
    synced: 2, failed: 1, skipped: 3,
    pulled: { products: 4, categories: 0, brands: 0, customers: 0, errors: ['pull error detail'] },
  })),
}));

it('shows sync counts without exposing error details', async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<SyncDataScreen />);
  });
  await act(async () => {
    renderer!.root.findByType(Button).props.onPress();
  });
  const screen = JSON.stringify(renderer!.toJSON());
  expect(syncNow).toHaveBeenCalledTimes(1);
  expect(screen).toContain('Uploaded 2 change(s)');
  expect(screen).toContain('4 failed');
  expect(screen).toContain('4 downloaded');
  expect(screen).toContain('3 pending');
  expect(screen).toContain('3 local-only');
  expect(screen).not.toContain('network error detail');
  expect(screen).not.toContain('record error detail');
  expect(screen).not.toContain('pull error detail');
  expect(screen).not.toContain('secret-id');
  expect(screen).not.toContain('Last sync');
  expect(screen).not.toContain('Two-way sync');
  expect(renderer!.root.findAllByType('Text')).toHaveLength(1);
  await act(async () => renderer!.unmount());
});
