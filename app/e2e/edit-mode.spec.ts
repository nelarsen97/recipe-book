import { expect, Page, test } from '@playwright/test';

/**
 * Drives the split edit mode (ingredient rows + numbered step boxes) in a
 * real browser. Several of these are regression tests for web-only bugs:
 * react-native-web only updates onSelectionChange from `select` events, and
 * a Backspace's default deletion lands on whichever input holds focus when
 * the browser applies it — both invisible to the Jest suite.
 */

const ing = (page: Page, n: number) => page.getByLabel(`Ingredient ${n}`, { exact: true });
const step = (page: Page, n: number) => page.getByLabel(`Step ${n}`, { exact: true });

const focusedLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

const selectionOf = (locator: ReturnType<Page['getByLabel']>) =>
  locator.evaluate((el) => {
    const input = el as HTMLInputElement;
    return `${input.selectionStart},${input.selectionEnd}`;
  });

// The edit screen exits with router.back(), so it needs history: always
// enter through the home screen's "+" button rather than goto('/edit').
async function openNewRecipe(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByText('+', { exact: true }).click();
  await ing(page, 1).waitFor();
}

test('a new recipe starts with one ingredient row and one step row', async ({ page }) => {
  await openNewRecipe(page);

  await expect(ing(page, 1)).toHaveCount(1);
  await expect(ing(page, 2)).toHaveCount(0);
  await expect(step(page, 1)).toHaveCount(1);
  await expect(step(page, 2)).toHaveCount(0);
});

test('Enter inserts a focused ingredient row below; typing right after lands in it', async ({
  page,
}) => {
  await openNewRecipe(page);

  await ing(page, 1).click();
  await page.keyboard.type('ground beef');
  await page.keyboard.press('Enter');
  // No settling wait: keystrokes immediately after Enter must land in the
  // new row (focus for insertions is synchronous, unlike Backspace's).
  await page.keyboard.type('cheese');

  await expect(ing(page, 1)).toHaveValue('ground beef');
  await expect(ing(page, 2)).toHaveValue('cheese');
  expect(await focusedLabel(page)).toBe('Ingredient 2');
});

test('Backspace in an empty ingredient row removes it and refocuses the previous one', async ({
  page,
}) => {
  await openNewRecipe(page);

  await ing(page, 1).click();
  await page.keyboard.type('flour');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');

  await expect(ing(page, 2)).toHaveCount(0);
  // Refocus after Backspace is deferred a tick on web, hence the poll.
  await expect.poll(() => focusedLabel(page)).toBe('Ingredient 1');
  // Regression: the deletion must not eat the previous row's last character.
  await expect(ing(page, 1)).toHaveValue('flour');
});

test('Backspace at the start of a row merges it into the previous one, caret at the junction', async ({
  page,
}) => {
  await openNewRecipe(page);

  await ing(page, 1).click();
  await page.keyboard.type('ground beef');
  await page.keyboard.press('Enter');
  await page.keyboard.type('cheese');
  await page.keyboard.press('Home'); // caret to position 0, like a real user
  await page.keyboard.press('Backspace');

  await expect(ing(page, 2)).toHaveCount(0);
  await expect(ing(page, 1)).toHaveValue('ground beefcheese');
  await expect.poll(() => focusedLabel(page)).toBe('Ingredient 1');
  expect(await selectionOf(ing(page, 1))).toBe('11,11'); // end of "ground beef"
});

test('Backspace mid-text or on the first row does not merge', async ({ page }) => {
  await openNewRecipe(page);

  await ing(page, 1).click();
  await page.keyboard.press('Backspace'); // empty first row: no-op
  await expect(ing(page, 1)).toHaveCount(1);

  await page.keyboard.type('milk');
  await page.keyboard.press('Enter');
  await page.keyboard.type('eggs');
  await page.keyboard.press('Backspace'); // caret at end: plain deletion

  await expect(ing(page, 2)).toHaveValue('egg');
  await expect(ing(page, 1)).toHaveValue('milk');
});

test('Enter in a step inserts the next numbered, focused step; Shift+Enter is a newline', async ({
  page,
}) => {
  await openNewRecipe(page);

  await step(page, 1).click();
  await page.keyboard.type('Brown the beef.');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Drain the fat.');
  await expect(step(page, 1)).toHaveValue('Brown the beef.\nDrain the fat.');
  await expect(step(page, 2)).toHaveCount(0);

  await page.keyboard.press('Enter');
  await page.keyboard.type('Serve in shells.');

  await expect(step(page, 1)).toHaveValue('Brown the beef.\nDrain the fat.');
  await expect(step(page, 2)).toHaveValue('Serve in shells.');
  expect(await focusedLabel(page)).toBe('Step 2');
  await expect(page.getByText('1.', { exact: true })).toHaveCount(1);
  await expect(page.getByText('2.', { exact: true })).toHaveCount(1);
});

test('Backspace in an empty step removes it and renumbers the rest', async ({ page }) => {
  await openNewRecipe(page);

  await step(page, 1).click();
  await page.keyboard.type('Mix.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Serve.');
  await page.keyboard.press('Enter');
  await expect(step(page, 3)).toHaveCount(1);

  await page.keyboard.press('Backspace');

  await expect(step(page, 3)).toHaveCount(0);
  await expect(page.getByText('3.', { exact: true })).toHaveCount(0);
  await expect.poll(() => focusedLabel(page)).toBe('Step 2');
  // Regression: the deletion must not eat the refocused step's last character.
  await expect(step(page, 2)).toHaveValue('Serve.');

  // A step that still has text is not removed by Backspace.
  await page.keyboard.press('Backspace');
  await expect(step(page, 2)).toHaveCount(1);
  await expect(step(page, 2)).toHaveValue('Serve');
});

test('the first step row survives Backspace so steps can always be added', async ({ page }) => {
  await openNewRecipe(page);

  await step(page, 1).click();
  await page.keyboard.press('Backspace');

  await expect(step(page, 1)).toHaveCount(1);
});

test('save, view numbered steps on the detail screen, re-edit prefilled, persist across reload', async ({
  page,
}) => {
  await openNewRecipe(page);

  await page.getByPlaceholder('e.g. Pancakes').fill('E2E Tacos');
  await ing(page, 1).click();
  await page.keyboard.type('ground beef');
  await page.keyboard.press('Enter');
  await page.keyboard.type('cheese');
  await step(page, 1).click();
  await page.keyboard.type('Brown the beef.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Fill the shells.');

  // Save backs out to the home list.
  await page.getByText('Save', { exact: true }).click();
  await page.getByText('E2E Tacos').click();

  // Detail screen: read-only numbered steps below the ingredients.
  await expect(page.getByText('Steps', { exact: true })).toBeVisible();
  await expect(page.getByText('1.', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Brown the beef.')).toBeVisible();
  await expect(page.getByText('2.', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Fill the shells.')).toBeVisible();

  // Re-edit: one prefilled row per ingredient and step.
  await page.getByText('Edit', { exact: true }).click();
  await expect(ing(page, 1)).toHaveValue('ground beef');
  await expect(ing(page, 2)).toHaveValue('cheese');
  await expect(step(page, 1)).toHaveValue('Brown the beef.');
  await expect(step(page, 2)).toHaveValue('Fill the shells.');

  // Saving from here backs out to the detail screen; AsyncStorage is
  // localStorage on web, so a reload proves persistence.
  await page.getByText('Save', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Tacos' })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'E2E Tacos' })).toBeVisible();
});
