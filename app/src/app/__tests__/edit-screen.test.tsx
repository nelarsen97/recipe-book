import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import EditRecipeScreen from '@/app/edit';
import { getRecipe, getRecipes, upsertLocal } from '@/lib/store';

const mockBack = jest.fn();
let mockParams: { id?: string } = {};

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/lib/sync', () => ({
  syncNow: jest.fn().mockResolvedValue({ ok: true, pending: 0 }),
}));

beforeEach(() => {
  mockParams = {};
});

it('creates a recipe from the form, splitting and tidying ingredient lines', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByPlaceholderText('e.g. Pancakes'), '  Tacos  ');
  await fireEvent.changeText(
    screen.getByPlaceholderText('2 cups flour\n3 eggs\n1 cup milk'),
    '  ground beef \n\n cheese \n'
  );
  await fireEvent.press(screen.getByText('Save'));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  const saved = (await getRecipes()).find((r) => r.name === 'Tacos');
  expect(saved).toBeDefined();
  expect(saved?.ingredients).toEqual(['ground beef', 'cheese']);
  expect(saved?.dirty).toBe(true);
});

it('refuses to save without a name', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert');
  const countBefore = (await getRecipes()).length;
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(
    screen.getByPlaceholderText('2 cups flour\n3 eggs\n1 cup milk'),
    'lonely ingredient'
  );
  await fireEvent.press(screen.getByText('Save'));

  expect(alertSpy).toHaveBeenCalledWith('Missing name', 'Give the recipe a name.');
  expect(mockBack).not.toHaveBeenCalled();
  expect((await getRecipes()).length).toBe(countBefore);
});

it('pre-fills and updates an existing recipe in place', async () => {
  const existing = await upsertLocal({ name: 'Pancakes', ingredients: ['flour', 'milk'] });
  mockParams = { id: existing.id };
  await render(<EditRecipeScreen />);

  await screen.findByDisplayValue('Pancakes');
  await screen.findByDisplayValue('flour\nmilk');

  await fireEvent.changeText(screen.getByDisplayValue('Pancakes'), 'Crêpes');
  await fireEvent.press(screen.getByText('Save'));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  const updated = await getRecipe(existing.id);
  expect(updated?.name).toBe('Crêpes');
  expect(updated?.ingredients).toEqual(['flour', 'milk']);
});
