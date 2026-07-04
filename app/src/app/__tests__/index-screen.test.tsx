import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import RecipeListScreen from '@/app/index';
import { saveSettings } from '@/lib/settings';
import { getRecipes, upsertLocal } from '@/lib/store';
import { syncNow } from '@/lib/sync';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));

jest.mock('@/lib/sync', () => ({
  syncNow: jest.fn().mockResolvedValue({ ok: true, pending: 0 }),
}));

const setServerEnabled = (serverEnabled: boolean) =>
  saveSettings({ serverEnabled, serverUrl: 'http://srv', apiKey: 'k' });

it('shows the empty state before any recipes exist', async () => {
  await render(<RecipeListScreen />);
  await screen.findByText('No recipes yet. Tap + to add your first one.');
});

it('lists recipes with their ingredient counts', async () => {
  await upsertLocal({ name: 'Pancakes', ingredients: ['flour', 'eggs'] });
  await upsertLocal({ name: 'Toast', ingredients: ['bread'] });
  await render(<RecipeListScreen />);

  await screen.findByText('Pancakes');
  expect(screen.getByText('2 ingredients')).toBeTruthy();
  expect(screen.getByText('Toast')).toBeTruthy();
  expect(screen.getByText('1 ingredient')).toBeTruthy();
});

it('hides the pending-sync banner while the server connection is disabled', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Unsynced', ingredients: [] }); // dirty
  await render(<RecipeListScreen />);

  await screen.findByText('Unsynced');
  expect(screen.queryByText(/waiting to sync/)).toBeNull();
});

it('shows the pending-sync banner when the server connection is enabled', async () => {
  await setServerEnabled(true);
  await upsertLocal({ name: 'Also unsynced', ingredients: [] });
  await render(<RecipeListScreen />);

  await screen.findByText(/waiting to sync — tap to retry/);
});

it('retries the sync when the banner is tapped and surfaces the failure', async () => {
  await setServerEnabled(true);
  await upsertLocal({ name: 'Needs syncing', ingredients: [] });
  jest
    .mocked(syncNow)
    .mockResolvedValue({ ok: false, pending: 1, error: 'Could not reach the server' });
  await render(<RecipeListScreen />);

  await fireEvent.press(await screen.findByText(/waiting to sync — tap to retry/));

  expect(syncNow).toHaveBeenCalled();
  await screen.findByText('Could not reach the server');
});

it('opens a recipe when its card is tapped', async () => {
  await setServerEnabled(false);
  const recipe = await upsertLocal({ name: 'Tap me', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent.press(await screen.findByText('Tap me'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recipe/[id]',
    params: { id: recipe.id },
  });
});

it('deletes a recipe after confirmation on long-press', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    (buttons as AlertButton[]).find((b) => b.style === 'destructive')?.onPress?.();
  });
  const recipe = await upsertLocal({ name: 'Long-press me', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent(await screen.findByText('Long-press me'), 'longPress');

  await waitFor(async () => {
    expect((await getRecipes()).find((r) => r.id === recipe.id)).toBeUndefined();
  });
  await waitFor(() => expect(screen.queryByText('Long-press me')).toBeNull());
});
