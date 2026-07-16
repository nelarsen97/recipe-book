import { expect, Page, test } from '@playwright/test';

/**
 * Drives the search bar on the list screen: live filtering across the
 * pinned and unpinned sections, the no-match message, and the clear
 * button. (Ingredient matching is covered in the Jest suite; recipes
 * created through the edit screen here only get names.)
 */

async function createRecipe(page: Page, name: string) {
  await page.getByText('+', { exact: true }).click();
  await page.getByPlaceholder('e.g. Pancakes').fill(name);
  await page.getByText('Save', { exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

test('search filters both sections live and clears again', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await createRecipe(page, 'E2E Curry');
  await createRecipe(page, 'E2E Pasta');
  await page.getByLabel('Pin E2E Curry').click();
  await expect(page.getByText('📌 Pinned')).toBeVisible();

  // A query that misses the pinned recipe hides the whole pinned section
  // (and the seeded "Sample: …" recipes).
  await page.getByLabel('Search recipes').fill('pasta');
  await expect(page.getByText('E2E Pasta', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E Curry', { exact: true })).toHaveCount(0);
  await expect(page.getByText('📌 Pinned')).toHaveCount(0);
  await expect(page.getByText(/^Sample:/)).toHaveCount(0);

  // A query matching only the pinned recipe keeps its section label.
  await page.getByLabel('Search recipes').fill('curry');
  await expect(page.getByText('E2E Curry', { exact: true })).toBeVisible();
  await expect(page.getByText('📌 Pinned')).toBeVisible();
  await expect(page.getByText('E2E Pasta', { exact: true })).toHaveCount(0);

  // No match at all: the message shows instead of any cards.
  await page.getByLabel('Search recipes').fill('zzz');
  await expect(page.getByText('No recipes match “zzz”.')).toBeVisible();

  // The ✕ clears the query and everything comes back.
  await page.getByLabel('Clear search').click();
  await expect(page.getByText('E2E Curry', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E Pasta', { exact: true })).toBeVisible();
  await expect(page.getByText('Sample: Buttered Toast', { exact: true })).toBeVisible();
});
