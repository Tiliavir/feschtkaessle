import { expect, test } from '@playwright/test';
import { buildSeedState, configHash, STORAGE_KEY } from './utils';

function seedState(page: import('@playwright/test').Page) {
  const seed = buildSeedState();
  return page
    .addInitScript(
      ([key, value]) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      },
      [STORAGE_KEY, JSON.stringify(seed.state)],
    )
    .then(() => seed);
}

test('create page takes name and items from a share link', async ({ page }) => {
  const hash = configHash({
    name: 'Dorffescht 2026',
    items: [
      { name: 'Kässpätzle «groß»', price: 3.5, color: '#d35400' },
      { name: 'Pfand', price: -2 },
    ],
  });
  await page.goto(`/create/${hash}`);

  await expect(page.locator('#event-name')).toHaveValue('Dorffescht 2026');
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText(['Kässpätzle «groß»', 'Pfand']);
  await expect(page.locator('#setup-items-list .setup-item-price')).toHaveText(['3,50 €', '-2,00 €']);
  await expect(page.locator('#config-notice')).toContainText('übernommen');
  expect(new URL(page.url()).hash).toBe('');
});

test('create page rejects an invalid share link', async ({ page }) => {
  await page.goto(`/create/${configHash({ name: 'X', items: [{ name: 'Bier', price: 'teuer' }] })}`);

  await expect(page.locator('#import-error')).toContainText('keine gültige Konfiguration');
  await expect(page.locator('#setup-items-list .setup-item-row')).toHaveCount(0);
});

test('edit shares a link that recreates the items on another device', async ({ page, browser }) => {
  const seed = await seedState(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        sessionStorage.setItem('shared-url', data.url ?? '');
      },
    });
  });
  await page.goto(`/edit/?id=${seed.eventId}`);
  await page.click('#btn-share-link');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('shared-url'))).toContain('/create/#cfg=');
  const sharedUrl = (await page.evaluate(() => sessionStorage.getItem('shared-url'))) ?? '';

  const other = await browser.newPage();
  await other.goto(sharedUrl);
  await expect(other.locator('#event-name')).toHaveValue('Vereinsfest');
  await expect(other.locator('#setup-items-list .setup-item-name')).toHaveText(['Wasser', 'Bier']);
  await other.close();
});

test('edit falls back to a copy field without share sheet and clipboard', async ({ page }) => {
  const seed = await seedState(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error('denied')) },
    });
  });
  await page.goto(`/edit/?id=${seed.eventId}`);
  await page.click('#btn-share-link');

  const field = page.locator('#share-link');
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(/\/create\/#cfg=/);
});

test('settings opens an earlier event as template', async ({ page }) => {
  await seedState(page);
  await page.goto('/settings/');
  await page.getByRole('link', { name: 'Als Vorlage' }).click();

  await expect(page).toHaveURL(/\/create\/$/);
  await expect(page.locator('#event-name')).toHaveValue('Vereinsfest');
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText(['Wasser', 'Bier']);
});
