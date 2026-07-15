import { expect, Page, test } from '@playwright/test';

/**
 * Drives the pinned-recipes feature in a real browser: pinning into the
 * tinted section, drag-to-reorder via the handle (PanResponder, which on
 * web runs on mouse events — invisible to the Jest suite), and pin state
 * surviving a reload.
 */

// Must match styles.cardPinned in src/app/index.tsx.
const PINNED_TINT = 'rgb(251, 241, 222)';

async function createRecipe(page: Page, name: string) {
  await page.getByText('+', { exact: true }).click();
  await page.getByPlaceholder('e.g. Pancakes').fill(name);
  await page.getByText('Save', { exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** Background of the recipe card containing this title (walks up past transparent wrappers). */
const cardBackground = (page: Page, title: string) =>
  page.getByText(title, { exact: true }).evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)') {
      node = node.parentElement;
    }
    return node ? getComputedStyle(node).backgroundColor : null;
  });

const titleY = async (page: Page, title: string) =>
  (await page.getByText(title, { exact: true }).boundingBox())!.y;

test('pin into the tinted section, drag to reorder, persist across reload', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await createRecipe(page, 'E2E Alpha');
  await createRecipe(page, 'E2E Beta');

  // Pin Beta first, then Alpha: the section keeps pin order, not name order.
  await page.getByLabel('Pin E2E Beta').click();
  await expect(page.getByText('📌 Pinned')).toBeVisible();
  await page.getByLabel('Pin E2E Alpha').click();
  expect(await titleY(page, 'E2E Beta')).toBeLessThan(await titleY(page, 'E2E Alpha'));

  // The pinned card is tinted; an unpinned card stays plain white.
  await createRecipe(page, 'E2E Gamma');
  expect(await cardBackground(page, 'E2E Beta')).toBe(PINNED_TINT);
  expect(await cardBackground(page, 'E2E Gamma')).toBe('rgb(255, 255, 255)');
  // No drag handle in the normal list.
  await expect(page.getByLabel('Reorder E2E Gamma')).toHaveCount(0);

  // Drag Beta's handle one slot down to swap the pinned pair.
  const handle = (await page.getByLabel('Reorder E2E Beta').boundingBox())!;
  const slot = (await titleY(page, 'E2E Alpha')) - (await titleY(page, 'E2E Beta'));
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2 + slot,
    { steps: 8 }
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await titleY(page, 'E2E Alpha')) < (await titleY(page, 'E2E Beta')))
    .toBe(true);

  // AsyncStorage is localStorage on web: pins and their order survive a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('📌 Pinned')).toBeVisible();
  expect(await titleY(page, 'E2E Alpha')).toBeLessThan(await titleY(page, 'E2E Beta'));
  expect(await cardBackground(page, 'E2E Alpha')).toBe(PINNED_TINT);

  // Unpin both: the section (and its labels) disappears.
  await page.getByLabel('Unpin E2E Alpha').click();
  await page.getByLabel('Unpin E2E Beta').click();
  await expect(page.getByText('📌 Pinned')).toHaveCount(0);
  await expect(page.getByText('All recipes')).toHaveCount(0);
});

test('selection-mode long-press cannot drag a pinned recipe', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await createRecipe(page, 'E2E One');
  await createRecipe(page, 'E2E Two');
  await page.getByLabel('Pin E2E One').click();
  await page.getByLabel('Pin E2E Two').click();
  expect(await titleY(page, 'E2E One')).toBeLessThan(await titleY(page, 'E2E Two'));

  // Long-press (no movement) on a pinned card still enters selection mode…
  const oneBox = (await page.getByText('E2E One', { exact: true }).boundingBox())!;
  await page.mouse.move(oneBox.x + oneBox.width / 2, oneBox.y + oneBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByText('1 selected')).toBeVisible();
  // …where the reorder handles are hidden.
  await expect(page.getByLabel(/^Reorder /)).toHaveCount(0);

  // A held-then-dragged pinned card must not lift: the selection-mode drag
  // only rearranges the main list.
  const slot = (await titleY(page, 'E2E Two')) - (await titleY(page, 'E2E One'));
  const start = (await page.getByText('E2E One', { exact: true }).boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(700); // past the long-press delay
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x, y + ((slot + 10) * i) / 8);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();

  expect(await titleY(page, 'E2E One')).toBeLessThan(await titleY(page, 'E2E Two'));
});
