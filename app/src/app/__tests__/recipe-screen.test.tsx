import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';

import RecipeScreen from '@/app/recipe/[id]';
import { addToKeep } from '@/lib/api';
import { saveKeepSettings } from '@/lib/keep/settings';
import { saveSettings } from '@/lib/settings';
import { getRecipe, upsertLocal } from '@/lib/store';

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
// In provision mode a numbered ingredient renders as an editable qty field
// plus fixed text, so rows are toggled by pressing the text part.
const INGREDIENT_LABELS = ['cups flour', 'eggs', 'cup milk'];

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

    await fireEvent.press(await screen.findByText('eggs'));
    await fireEvent.press(await screen.findByText('Copy 2 to clipboard'));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('2 cups flour\n1 cup milk');
    await screen.findByText('Copied!');
    // Keep-for-Android pastes multi-line text into a single checkbox, so the
    // hint spells out the hide/paste/show flow that splits lines properly.
    await screen.findByText(/Hide checkboxes/);
  });

  it('disables copying when every ingredient is checked off', async () => {
    await seedRecipe('Pancakes');
    await render(<RecipeScreen />);

    for (const label of INGREDIENT_LABELS) {
      await fireEvent.press(await screen.findByText(label));
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

    await fireEvent.press(await screen.findByText('eggs'));
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

describe('provision mode quantity overrides', () => {
  const seedShoppingRecipe = async () => {
    const recipe = await upsertLocal({
      name: 'Pasta',
      ingredients: ['400g tomato', '3 eggs', 'salt'],
    });
    mockRecipeId = recipe.id;
    return recipe;
  };

  beforeEach(() => setServerEnabled(false));

  it('shows an editable quantity field only for ingredients with a leading number', async () => {
    await seedShoppingRecipe();
    await render(<RecipeScreen />);

    await screen.findByDisplayValue('400');
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(screen.queryByLabelText('Quantity for salt')).toBeNull();
    expect(screen.getByText('salt')).toBeTruthy();
  });

  it('copies the overridden quantity without touching the stored recipe', async () => {
    await seedShoppingRecipe();
    await render(<RecipeScreen />);

    await fireEvent.changeText(await screen.findByDisplayValue('400'), '200');
    await fireEvent.press(await screen.findByText('Copy 3 to clipboard'));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('200g tomato\n3 eggs\nsalt');
    expect((await getRecipe(mockRecipeId))!.ingredients).toEqual([
      '400g tomato',
      '3 eggs',
      'salt',
    ]);
  });

  it('falls back to the original quantity when the field is cleared', async () => {
    await seedShoppingRecipe();
    await render(<RecipeScreen />);

    await fireEvent.changeText(await screen.findByDisplayValue('400'), '');
    await fireEvent.press(await screen.findByText('Copy 3 to clipboard'));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('400g tomato\n3 eggs\nsalt');
  });

  it('keeps an override across check-off and uncheck', async () => {
    await seedShoppingRecipe();
    await render(<RecipeScreen />);

    await fireEvent.changeText(await screen.findByDisplayValue('400'), '200');
    // Check it off: the row leaves the provisioned list and shows the
    // composed text struck through.
    await fireEvent.press(await screen.findByText('g tomato'));
    await screen.findByText('200g tomato');
    await fireEvent.press(await screen.findByText('Copy 2 to clipboard'));
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith('3 eggs\nsalt');

    // Uncheck: the override is still applied. (The button still reads
    // "Copied!" from the press above — the label resets on a timer.)
    await fireEvent.press(await screen.findByText('200g tomato'));
    await fireEvent.press(await screen.findByText('Copied!'));
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith('200g tomato\n3 eggs\nsalt');
  });

  it('treats a fraction as the editable quantity', async () => {
    const recipe = await upsertLocal({
      name: 'Cookies',
      ingredients: ['1/2 cup sugar', '1 1/2 cups flour'],
    });
    mockRecipeId = recipe.id;
    await render(<RecipeScreen />);

    await fireEvent.changeText(await screen.findByDisplayValue('1/2'), '1/4');
    expect(screen.getByDisplayValue('1 1/2')).toBeTruthy();
    await fireEvent.press(await screen.findByText('Copy 2 to clipboard'));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('1/4 cup sugar\n1 1/2 cups flour');
  });

  it('sends overridden quantities to Google Keep', async () => {
    await setServerEnabled(true);
    jest.mocked(addToKeep).mockResolvedValue({ added: 3, skipped: 0, skipped_items: [] });
    await seedShoppingRecipe();
    await render(<RecipeScreen />);

    await fireEvent.changeText(await screen.findByDisplayValue('400'), '250');
    await fireEvent.press(await screen.findByText('Add 3 to Google Keep'));

    expect(addToKeep).toHaveBeenCalledWith(['250g tomato', '3 eggs', 'salt']);
  });
});

describe('steps section', () => {
  beforeEach(() => setServerEnabled(false));

  it('shows saved steps as a numbered list', async () => {
    const recipe = await upsertLocal({
      name: 'Pancakes',
      ingredients: INGREDIENTS,
      steps: ['Mix the batter', 'Fry until golden'],
    });
    mockRecipeId = recipe.id;
    await render(<RecipeScreen />);

    await screen.findByText('Steps');
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('Mix the batter')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByText('Fry until golden')).toBeTruthy();
  });

  it('hides the section when the recipe has no steps', async () => {
    await seedRecipe('Pancakes');
    await render(<RecipeScreen />);

    await screen.findByText('Copy 3 to clipboard');
    expect(screen.queryByText('Steps')).toBeNull();
  });
});

it('explains when the recipe no longer exists', async () => {
  mockRecipeId = 'missing-id';
  await render(<RecipeScreen />);
  await screen.findByText('This recipe is gone — it may have been deleted.');
});

describe('with only the direct Keep path enabled (no server)', () => {
  beforeEach(async () => {
    await setServerEnabled(false);
    await saveKeepSettings({
      enabled: true,
      email: 'me@gmail.com',
      masterToken: 'aas_et/tok',
      noteId: 'note-1',
    });
  });

  afterEach(() =>
    saveKeepSettings({ enabled: false, email: '', masterToken: '', noteId: '' })
  );

  it('still offers the Google Keep button', async () => {
    await seedRecipe('Pancakes');
    await render(<RecipeScreen />);

    await screen.findByText('Add 3 to Google Keep');
    expect(screen.getByText('Copy 3 to clipboard')).toBeTruthy();
  });
});
