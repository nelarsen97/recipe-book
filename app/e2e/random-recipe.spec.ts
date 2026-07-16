import { expect, Page, test } from '@playwright/test';

/**
 * Drives the random-recipe FAB: opens a recipe drawn from the full pool,
 * pinned recipes included. Math.random is stubbed to steer the pick, so the
 * pool order matters: a fresh install seeds the two "Sample: …" recipes, and
 * with no manual rearrange getRecipes() sorts alphabetically — the two
 * recipes created here lead it: [E2E Rand Alpha, E2E Rand Beta, Sample:
 * Buttered Toast, Sample: Simple Salad]. (The empty-list case — the button
 * hidden — lives in the Jest suite; seeding means a browser never starts
 * empty.)
 */

async function createRecipe(page: Page, name: string) {
  await page.getByText('+', { exact: true }).click();
  await page.getByPlaceholder('e.g. Pancakes').fill(name);
  await page.getByText('Save', { exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

test('random button opens recipes from pinned and unpinned alike', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  await createRecipe(page, 'E2E Rand Alpha');
  await createRecipe(page, 'E2E Rand Beta');
  await page.getByLabel('Pin E2E Rand Beta').click();
  await expect(page.getByText('📌 Pinned')).toBeVisible();
  await expect(page.getByLabel('Open a random recipe')).toBeVisible();

  // floor(0.3 * 4) = 1 → Beta, the pinned recipe: pinning doesn't remove a
  // recipe from the pool.
  await page.evaluate(() => {
    Math.random = () => 0.3;
  });
  await page.getByLabel('Open a random recipe').click();
  await expect(page).toHaveURL(/\/recipe\//);
  // The list stays mounted beneath the pushed screen, so match the detail
  // screen's heading rather than bare text.
  await expect(page.getByRole('heading', { name: 'E2E Rand Beta' })).toBeVisible();

  // floor(0 * 4) = 0 → Alpha, an unpinned recipe.
  await page.goBack();
  await expect(page.getByLabel('Open a random recipe')).toBeVisible();
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await page.getByLabel('Open a random recipe').click();
  await expect(page.getByRole('heading', { name: 'E2E Rand Alpha' })).toBeVisible();
});
