import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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

// The real hook's Keyboard events don't fire in jest, so back it with real
// React state driven from the test via `emitKeyboardHeight`. Real state (not a
// mutated variable) is what the React Compiler tracks to trigger a re-render.
const mockKeyboardListeners = new Set<(height: number) => void>();
const emitKeyboardHeight = (height: number) => {
  for (const listener of mockKeyboardListeners) listener(height);
};
jest.mock('@/lib/use-keyboard', () => {
  const { useEffect, useState } = require('react');
  return {
    useKeyboardHeight: () => {
      const [height, setHeight] = useState(0);
      useEffect(() => {
        mockKeyboardListeners.add(setHeight);
        return () => {
          mockKeyboardListeners.delete(setHeight);
        };
      }, []);
      return height;
    },
  };
});

beforeEach(() => {
  mockParams = {};
});

const selectionEvent = (start: number, end = start) => ({
  nativeEvent: { selection: { start, end } },
});
const backspaceEvent = { nativeEvent: { key: 'Backspace' } };

it('starts a new recipe with one ingredient row and one step row', async () => {
  await render(<EditRecipeScreen />);

  expect(screen.getByLabelText('Ingredient 1')).toBeTruthy();
  expect(screen.queryByLabelText('Ingredient 2')).toBeNull();
  expect(screen.getByLabelText('Step 1')).toBeTruthy();
  expect(screen.queryByLabelText('Step 2')).toBeNull();
});

it('adds a new ingredient row below on Enter', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByLabelText('Ingredient 1'), 'flour');
  await fireEvent(screen.getByLabelText('Ingredient 1'), 'submitEditing');

  expect(screen.getByLabelText('Ingredient 2')).toBeTruthy();
  expect(screen.getByLabelText('Ingredient 1').props.value).toBe('flour');
  expect(screen.getByLabelText('Ingredient 2').props.value).toBe('');
});

it('merges an ingredient into the previous row on backspace at the start', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByLabelText('Ingredient 1'), 'flour');
  await fireEvent(screen.getByLabelText('Ingredient 1'), 'submitEditing');
  await fireEvent.changeText(screen.getByLabelText('Ingredient 2'), 'milk');

  await fireEvent(screen.getByLabelText('Ingredient 2'), 'selectionChange', selectionEvent(0));
  await fireEvent(screen.getByLabelText('Ingredient 2'), 'keyPress', backspaceEvent);

  expect(screen.queryByLabelText('Ingredient 2')).toBeNull();
  expect(screen.getByLabelText('Ingredient 1').props.value).toBe('flourmilk');
});

it('does not merge when the cursor is not at the start', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByLabelText('Ingredient 1'), 'flour');
  await fireEvent(screen.getByLabelText('Ingredient 1'), 'submitEditing');
  await fireEvent.changeText(screen.getByLabelText('Ingredient 2'), 'milk');

  await fireEvent(screen.getByLabelText('Ingredient 2'), 'selectionChange', selectionEvent(2));
  await fireEvent(screen.getByLabelText('Ingredient 2'), 'keyPress', backspaceEvent);

  expect(screen.getByLabelText('Ingredient 2')).toBeTruthy();
  expect(screen.getByLabelText('Ingredient 2').props.value).toBe('milk');
});

it('never merges away the first ingredient row', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent(screen.getByLabelText('Ingredient 1'), 'selectionChange', selectionEvent(0));
  await fireEvent(screen.getByLabelText('Ingredient 1'), 'keyPress', backspaceEvent);

  expect(screen.getByLabelText('Ingredient 1')).toBeTruthy();
});

it('adds a new numbered step row below on Enter', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByLabelText('Step 1'), 'Mix everything');
  await fireEvent(screen.getByLabelText('Step 1'), 'submitEditing');

  expect(screen.getByLabelText('Step 2')).toBeTruthy();
  expect(screen.getByLabelText('Step 1').props.value).toBe('Mix everything');
  expect(screen.getByText('1.')).toBeTruthy();
  expect(screen.getByText('2.')).toBeTruthy();
});

it('removes an empty step on backspace and renumbers the rest', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByLabelText('Step 1'), 'Mix');
  await fireEvent(screen.getByLabelText('Step 1'), 'submitEditing');
  await fireEvent(screen.getByLabelText('Step 2'), 'submitEditing');
  await fireEvent.changeText(screen.getByLabelText('Step 3'), 'Serve');

  // Step 2 is empty; backspace removes it and Serve becomes step 2.
  await fireEvent(screen.getByLabelText('Step 2'), 'keyPress', backspaceEvent);

  expect(screen.queryByLabelText('Step 3')).toBeNull();
  expect(screen.getByLabelText('Step 2').props.value).toBe('Serve');
});

it('does not remove a step that still has text on backspace', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByLabelText('Step 1'), 'Mix');
  await fireEvent(screen.getByLabelText('Step 1'), 'keyPress', backspaceEvent);

  expect(screen.getByLabelText('Step 1').props.value).toBe('Mix');
});

it('never removes the first step row, even when empty', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent(screen.getByLabelText('Step 1'), 'keyPress', backspaceEvent);

  expect(screen.getByLabelText('Step 1')).toBeTruthy();
});

it('creates a recipe from the rows, tidying blank and padded entries', async () => {
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByPlaceholderText('e.g. Pancakes'), '  Tacos  ');
  await fireEvent.changeText(screen.getByLabelText('Ingredient 1'), '  ground beef ');
  await fireEvent(screen.getByLabelText('Ingredient 1'), 'submitEditing');
  await fireEvent(screen.getByLabelText('Ingredient 2'), 'submitEditing');
  await fireEvent.changeText(screen.getByLabelText('Ingredient 3'), ' cheese ');
  await fireEvent.changeText(screen.getByLabelText('Step 1'), ' Brown the beef.\nDrain. ');
  await fireEvent(screen.getByLabelText('Step 1'), 'submitEditing');
  await fireEvent.press(screen.getByText('Save'));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  const saved = (await getRecipes()).find((r) => r.name === 'Tacos');
  expect(saved).toBeDefined();
  expect(saved?.ingredients).toEqual(['ground beef', 'cheese']);
  expect(saved?.steps).toEqual(['Brown the beef.\nDrain.']);
  expect(saved?.dirty).toBe(true);
});

it('hides the Save button while the keyboard is open', async () => {
  await render(<EditRecipeScreen />);
  expect(screen.getByText('Save')).toBeTruthy();

  await act(async () => emitKeyboardHeight(320));
  expect(screen.queryByText('Save')).toBeNull();

  await act(async () => emitKeyboardHeight(0));
  expect(screen.getByText('Save')).toBeTruthy();
});

it('refuses to save without a name', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert');
  const countBefore = (await getRecipes()).length;
  await render(<EditRecipeScreen />);

  await fireEvent.changeText(screen.getByLabelText('Ingredient 1'), 'lonely ingredient');
  await fireEvent.press(screen.getByText('Save'));

  expect(alertSpy).toHaveBeenCalledWith('Missing name', 'Give the recipe a name.');
  expect(mockBack).not.toHaveBeenCalled();
  expect((await getRecipes()).length).toBe(countBefore);
});

it('pre-fills one row per ingredient and step and updates in place', async () => {
  const existing = await upsertLocal({
    name: 'Pancakes',
    ingredients: ['flour', 'milk'],
    steps: ['Mix', 'Fry'],
  });
  mockParams = { id: existing.id };
  await render(<EditRecipeScreen />);

  await screen.findByDisplayValue('Pancakes');
  expect(screen.getByLabelText('Ingredient 1').props.value).toBe('flour');
  expect(screen.getByLabelText('Ingredient 2').props.value).toBe('milk');
  expect(screen.getByLabelText('Step 1').props.value).toBe('Mix');
  expect(screen.getByLabelText('Step 2').props.value).toBe('Fry');

  await fireEvent.changeText(screen.getByDisplayValue('Pancakes'), 'Crêpes');
  await fireEvent.press(screen.getByText('Save'));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  const updated = await getRecipe(existing.id);
  expect(updated?.name).toBe('Crêpes');
  expect(updated?.ingredients).toEqual(['flour', 'milk']);
  expect(updated?.steps).toEqual(['Mix', 'Fry']);
});
