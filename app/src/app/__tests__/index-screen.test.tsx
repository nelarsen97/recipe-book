import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import RecipeListScreen from '@/app/index';
import { saveSettings } from '@/lib/settings';
import { deleteLocal, getRecipes, upsertLocal } from '@/lib/store';
import { syncNow } from '@/lib/sync';
import { parseImport, pickAndReadImportFile } from '@/lib/transfer';

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => children,
    // Render the header options inline so tests can press header buttons and
    // read the "N selected" title.
    Stack: {
      Screen: ({ options }: { options?: Record<string, any> }) => {
        const opts = options ?? {};
        return React.createElement(
          React.Fragment,
          null,
          opts.title ? React.createElement(Text, null, opts.title) : null,
          opts.headerLeft ? opts.headerLeft() : null,
          opts.headerRight ? opts.headerRight() : null
        );
      },
    },
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
  };
});

jest.mock('@/lib/sync', () => ({
  syncNow: jest.fn().mockResolvedValue({ ok: true, pending: 0 }),
}));

jest.mock('@/lib/transfer', () => ({
  exportRecipesToFile: jest.fn().mockResolvedValue(undefined),
  parseImport: jest.fn(),
  pickAndReadImportFile: jest.fn(),
}));

const setServerEnabled = (serverEnabled: boolean) =>
  saveSettings({ serverEnabled, serverUrl: 'http://srv', apiKey: 'k' });

// The store is a module singleton that persists across tests in this file;
// start each test from an empty recipe list so the selection-count assertions
// aren't thrown off by recipes left behind by earlier tests.
beforeEach(async () => {
  for (const r of await getRecipes()) await deleteLocal(r.id);
});

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

it('enters selection mode on long-press, toggles a second recipe, and cancels', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'One', ingredients: [] });
  await upsertLocal({ name: 'Two', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent(await screen.findByText('One'), 'longPress');
  await screen.findByText('1 selected');
  expect(screen.getByText('Export (1)')).toBeTruthy();

  // In selection mode a tap toggles rather than navigates.
  await fireEvent.press(screen.getByText('Two'));
  await screen.findByText('Export (2)');
  expect(mockPush).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('Cancel'));
  await waitFor(() => expect(screen.queryByText(/Export \(/)).toBeNull());
});

it('selects and deselects every recipe with Select all', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'One', ingredients: [] });
  await upsertLocal({ name: 'Two', ingredients: [] });
  await upsertLocal({ name: 'Three', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent(await screen.findByText('One'), 'longPress');
  await fireEvent.press(await screen.findByText('Select all'));
  await screen.findByText('Export (3)');

  await fireEvent.press(await screen.findByText('Deselect all'));
  await screen.findByText('Export (0)');
});

it('bulk-deletes the selected recipes after confirmation', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    (buttons as AlertButton[]).find((b) => b.style === 'destructive')?.onPress?.();
  });
  await setServerEnabled(false);
  await upsertLocal({ name: 'One', ingredients: [] });
  await upsertLocal({ name: 'Two', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent(await screen.findByText('One'), 'longPress');
  await fireEvent.press(await screen.findByText('Select all'));
  await fireEvent.press(await screen.findByText(/Delete \(2\)/));

  await waitFor(async () => expect(await getRecipes()).toHaveLength(0));
});

it('pins a recipe into the pinned section and unpins it again', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Pancakes', ingredients: [] });
  await upsertLocal({ name: 'Toast', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent.press(await screen.findByLabelText('Pin Toast'));

  await screen.findByText('📌 Pinned');
  expect(screen.getByText('All recipes')).toBeTruthy();
  expect(screen.getByLabelText('Unpin Toast')).toBeTruthy();
  // Pinned recipes leave the normal list rather than duplicating.
  expect(screen.getAllByText('Toast')).toHaveLength(1);

  await fireEvent.press(screen.getByLabelText('Unpin Toast'));
  await waitFor(() => expect(screen.queryByText('📌 Pinned')).toBeNull());
  expect(screen.queryByText('All recipes')).toBeNull();
});

it('orders the pinned section by pin order while the rest stays alphabetical', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Apple pie', ingredients: [] });
  await upsertLocal({ name: 'Toast', ingredients: [] });
  await upsertLocal({ name: 'Pancakes', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent.press(await screen.findByLabelText('Pin Toast'));
  await fireEvent.press(await screen.findByLabelText('Pin Pancakes'));

  await screen.findByText('📌 Pinned');
  const titles = screen
    .getAllByText(/^(Apple pie|Toast|Pancakes)$/)
    .map((node) => node.props.children);
  // Toast was pinned first, so it leads despite sorting after Pancakes.
  expect(titles).toEqual(['Toast', 'Pancakes', 'Apple pie']);
});

it('shows a drag handle only on pinned cards, and only when there are two or more', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Pancakes', ingredients: [] });
  await upsertLocal({ name: 'Toast', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent.press(await screen.findByLabelText('Pin Toast'));
  await screen.findByText('📌 Pinned');
  // A single pinned recipe has nothing to reorder against.
  expect(screen.queryByLabelText(/^Reorder /)).toBeNull();

  await fireEvent.press(screen.getByLabelText('Pin Pancakes'));
  await screen.findByLabelText('Reorder Toast');
  expect(screen.getByLabelText('Reorder Pancakes')).toBeTruthy();
  // The unpinned list never gets drag handles.
  expect(screen.getAllByLabelText(/^Reorder /)).toHaveLength(2);
});

it('hides the random-recipe button while there are no recipes', async () => {
  await setServerEnabled(false);
  await render(<RecipeListScreen />);

  await screen.findByText('No recipes yet. Tap + to add your first one.');
  expect(screen.queryByLabelText('Open a random recipe')).toBeNull();
});

it('opens a random recipe drawn from pinned and unpinned alike', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Pancakes', ingredients: [] });
  const pinned = await upsertLocal({ name: 'Toast', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent.press(await screen.findByLabelText('Pin Toast'));
  await screen.findByText('📌 Pinned');

  // Force the pick onto the pinned recipe to prove pinned ones are included.
  const random = jest.spyOn(Math, 'random');
  random.mockReturnValue(0.99);
  await fireEvent.press(screen.getByLabelText('Open a random recipe'));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/recipe/[id]',
    params: { id: pinned.id },
  });
  random.mockRestore();
});

it('filters the list by name as a search query is typed, and clears again', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Pancakes', ingredients: [] });
  await upsertLocal({ name: 'Toast', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent.changeText(await screen.findByLabelText('Search recipes'), 'pan');
  expect(screen.getByText('Pancakes')).toBeTruthy();
  expect(screen.queryByText('Toast')).toBeNull();

  await fireEvent.press(screen.getByLabelText('Clear search'));
  expect(screen.getByText('Toast')).toBeTruthy();
});

it('matches ingredients as well as names', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Pancakes', ingredients: ['flour', 'maple syrup'] });
  await upsertLocal({ name: 'Toast', ingredients: ['bread'] });
  await render(<RecipeListScreen />);

  await fireEvent.changeText(await screen.findByLabelText('Search recipes'), 'syrup');
  expect(screen.getByText('Pancakes')).toBeTruthy();
  expect(screen.queryByText('Toast')).toBeNull();
});

it('filters the pinned section too and reports when nothing matches', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Pancakes', ingredients: [] });
  await upsertLocal({ name: 'Toast', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent.press(await screen.findByLabelText('Pin Toast'));
  await screen.findByText('📌 Pinned');

  // A query that misses the pinned recipe hides the whole pinned section.
  await fireEvent.changeText(screen.getByLabelText('Search recipes'), 'pan');
  expect(screen.queryByText('📌 Pinned')).toBeNull();
  expect(screen.queryByText('Toast')).toBeNull();
  expect(screen.getByText('Pancakes')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('Search recipes'), 'zzz');
  expect(screen.getByText('No recipes match “zzz”.')).toBeTruthy();
});

it('scopes Select all to the search results', async () => {
  await setServerEnabled(false);
  await upsertLocal({ name: 'Pancakes', ingredients: [] });
  await upsertLocal({ name: 'Panzanella', ingredients: [] });
  await upsertLocal({ name: 'Toast', ingredients: [] });
  await render(<RecipeListScreen />);

  await fireEvent.changeText(await screen.findByLabelText('Search recipes'), 'pan');
  await fireEvent(screen.getByText('Pancakes'), 'longPress');
  await fireEvent.press(await screen.findByText('Select all'));

  // Only the two visible matches are selected, not the hidden Toast.
  await screen.findByText('Export (2)');
});

it('imports recipes from a picked file and merges them into the store', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(pickAndReadImportFile).mockResolvedValue('file-contents');
  jest
    .mocked(parseImport)
    .mockReturnValue([{ id: 'imported-1', name: 'Imported', ingredients: [] }]);
  await setServerEnabled(false);
  await render(<RecipeListScreen />);

  await fireEvent.press(await screen.findByText('Import'));

  await waitFor(async () =>
    expect((await getRecipes()).some((r) => r.id === 'imported-1')).toBe(true)
  );
});
