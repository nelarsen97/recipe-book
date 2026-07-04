import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';

import RecipeScreen from '@/app/recipe/[id]';
import { addToKeep } from '@/lib/api';
import { saveSettings } from '@/lib/settings';
import { upsertLocal } from '@/lib/store';

let mockRecipeId = '';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: mockRecipeId }),
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  addToKeep: jest.fn(),
}));

const INGREDIENTS = ['2 cups flour', '3 eggs', '1 cup milk'];

const seedRecipe = async (name: string) => {
  const recipe = await upsertLocal({ name, ingredients: INGREDIENTS });
  mockRecipeId = recipe.id;
  return recipe;
};

const setServerEnabled = (serverEnabled: boolean) =>
  saveSettings({ serverEnabled, serverUrl: 'http://srv', apiKey: 'k' });

describe('with the server connection disabled', () => {
  beforeEach(() => setServerEnabled(false));

  it('offers copy-to-clipboard instead of Google Keep', async () => {
    await seedRecipe('Pancakes');
    await render(<RecipeScreen />);

    await screen.findByText('Copy 3 to clipboard');
    expect(screen.queryByText(/Google Keep$/)).toBeNull();
  });

  it('copies only the unchecked ingredients, one per line', async () => {
    await seedRecipe('Pancakes');
    await render(<RecipeScreen />);

    await fireEvent.press(await screen.findByText('3 eggs'));
    await fireEvent.press(await screen.findByText('Copy 2 to clipboard'));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('2 cups flour\n1 cup milk');
    await screen.findByText('Copied! Paste into Google Keep.');
  });

  it('disables copying when every ingredient is checked off', async () => {
    await seedRecipe('Pancakes');
    await render(<RecipeScreen />);

    for (const item of INGREDIENTS) {
      await fireEvent.press(await screen.findByText(item));
    }
    const button = await screen.findByText('Nothing to copy — you have it all!');
    await fireEvent.press(button);
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });
});

describe('with the server connection enabled', () => {
  beforeEach(() => setServerEnabled(true));

  it('offers both Google Keep and copy-to-clipboard', async () => {
    await seedRecipe('Waffles');
    await render(<RecipeScreen />);

    await screen.findByText('Add 3 to Google Keep');
    expect(screen.getByText('Copy 3 to clipboard')).toBeTruthy();
  });

  it('sends the unchecked ingredients to Keep and reports the result', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    jest.mocked(addToKeep).mockResolvedValue({ added: 2, skipped: 0, skipped_items: [] });
    await seedRecipe('Waffles');
    await render(<RecipeScreen />);

    await fireEvent.press(await screen.findByText('3 eggs'));
    await fireEvent.press(await screen.findByText('Add 2 to Google Keep'));

    expect(addToKeep).toHaveBeenCalledWith(['2 cups flour', '1 cup milk']);
    expect(alertSpy).toHaveBeenCalledWith('Sent to Google Keep', 'Added 2 items.');
  });

  it('mentions items Keep skipped because they were already on the list', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    jest.mocked(addToKeep).mockResolvedValue({
      added: 1,
      skipped: 2,
      skipped_items: ['2 cups flour', '1 cup milk'],
    });
    await seedRecipe('Waffles');
    await render(<RecipeScreen />);

    await fireEvent.press(await screen.findByText('Add 3 to Google Keep'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Sent to Google Keep',
      'Added 1 item.\nSkipped 2 already on the list: 2 cups flour, 1 cup milk.'
    );
  });

  it('shows the API error when Keep fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { ApiError } = jest.requireActual('@/lib/api');
    jest.mocked(addToKeep).mockRejectedValue(new ApiError('Keep is not connected'));
    await seedRecipe('Waffles');
    await render(<RecipeScreen />);

    await fireEvent.press(await screen.findByText('Add 3 to Google Keep'));

    expect(alertSpy).toHaveBeenCalledWith('Could not add to Keep', 'Keep is not connected');
  });
});

it('explains when the recipe no longer exists', async () => {
  mockRecipeId = 'missing-id';
  await render(<RecipeScreen />);
  await screen.findByText('This recipe is gone — it may have been deleted.');
});
