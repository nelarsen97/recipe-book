import { expect, Page, test } from '@playwright/test';

/**
 * Drag-to-rearrange in the home list's selection mode: long-press a card to
 * lift it, drag to a new slot, release to commit. Driven with real mouse
 * events because the gesture lives in a PanResponder, which jsdom-style
 * tests can't exercise.
 */

// Skip the bundled default recipes so the list holds only what the test adds.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('recipe-book/seeded', '1'));
});

const ing = (page: Page, n: number) => page.getByLabel(`Ingredient ${n}`, { exact: true });

async function addRecipe(page: Page, name: string) {
  await page.getByText('+', { exact: true }).click();
  await page.getByPlaceholder('e.g. Pancakes').fill(name);
  await ing(page, 1).fill('water');
  await page.getByText('Save', { exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** The given names sorted by their vertical position on screen. */
async function orderOnScreen(page: Page, names: string[]) {
  const withY = await Promise.all(
    names.map(async (name) => {
      const box = await page.getByText(name, { exact: true }).boundingBox();
      return { name, y: box?.y ?? Number.MAX_VALUE };
    })
  );
  return withY.sort((a, b) => a.y - b.y).map((entry) => entry.name);
}

/** Long-press (no movement) — enters selection mode outside of it. */
async function longPress(page: Page, name: string) {
  const box = (await page.getByText(name, { exact: true }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
}

/** In selection mode: hold a card past the lift delay, then drag it by dy. */
async function dragCard(page: Page, name: string, dy: number) {
  const box = (await page.getByText(name, { exact: true }).boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(700); // past the long-press delay: the card lifts
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX, startY + (dy * i) / steps);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

test('long-press drag re-arranges the list and the order persists', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await addRecipe(page, 'Alpha Stew');
  await addRecipe(page, 'Beta Bread');
  await addRecipe(page, 'Gamma Cake');

  const names = ['Alpha Stew', 'Beta Bread', 'Gamma Cake'];
  expect(await orderOnScreen(page, names)).toEqual(names); // alphabetical to start

  await longPress(page, 'Alpha Stew');
  await expect(page.getByText('1 selected')).toBeVisible();

  // One slot is a card (~75px) plus the list gap; overshoot is clamped to
  // the nearest slot, so aim past the center of the card below.
  const alphaBox = (await page.getByText('Alpha Stew', { exact: true }).boundingBox())!;
  const betaBox = (await page.getByText('Beta Bread', { exact: true }).boundingBox())!;
  await dragCard(page, 'Alpha Stew', betaBox.y - alphaBox.y + 10);

  await expect.poll(() => orderOnScreen(page, names)).toEqual([
    'Beta Bread',
    'Alpha Stew',
    'Gamma Cake',
  ]);
  // The drag neither toggled the dragged card nor dropped out of selection.
  await expect(page.getByText('1 selected')).toBeVisible();

  // Dragging up works too: lift the bottom card all the way to the top.
  const gammaBox = (await page.getByText('Gamma Cake', { exact: true }).boundingBox())!;
  const topBox = (await page.getByText('Beta Bread', { exact: true }).boundingBox())!;
  await dragCard(page, 'Gamma Cake', topBox.y - gammaBox.y - 10);
  await expect.poll(() => orderOnScreen(page, names)).toEqual([
    'Gamma Cake',
    'Beta Bread',
    'Alpha Stew',
  ]);

  // The manual order is a stored preference: it survives a reload.
  await page.getByText('Cancel', { exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => orderOnScreen(page, names)).toEqual([
    'Gamma Cake',
    'Beta Bread',
    'Alpha Stew',
  ]);
});

test('a quick tap in selection mode still toggles instead of dragging', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await addRecipe(page, 'Alpha Stew');
  await addRecipe(page, 'Beta Bread');

  await longPress(page, 'Alpha Stew');
  await expect(page.getByText('1 selected')).toBeVisible();

  await page.getByText('Beta Bread', { exact: true }).click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByText('Beta Bread', { exact: true }).click();
  await expect(page.getByText('1 selected')).toBeVisible();

  // No drag happened: the order is untouched.
  expect(await orderOnScreen(page, ['Alpha Stew', 'Beta Bread'])).toEqual([
    'Alpha Stew',
    'Beta Bread',
  ]);
});
