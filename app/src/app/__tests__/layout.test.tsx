import { render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import RootLayout from '@/app/_layout';
import { maybeSync, syncNow } from '@/lib/sync';

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('@/lib/sync', () => ({
  syncNow: jest.fn().mockResolvedValue({ ok: true, pending: 0 }),
  maybeSync: jest.fn().mockReturnValue(null),
}));

it('syncs on app open and again when returning to the foreground', async () => {
  const listenerSpy = jest.spyOn(AppState, 'addEventListener');
  await render(<RootLayout />);

  expect(syncNow).toHaveBeenCalledTimes(1);

  const notify = (state: AppStateStatus) =>
    listenerSpy.mock.calls.forEach(([, handler]) => handler(state));

  notify('background');
  expect(maybeSync).not.toHaveBeenCalled();

  notify('active');
  expect(maybeSync).toHaveBeenCalledTimes(1);
});
