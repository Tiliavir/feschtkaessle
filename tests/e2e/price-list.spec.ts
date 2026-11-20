import { expect, test } from '@playwright/test';

test('create takes items from a pasted price list and keeps unclear lines', async ({ page }) => {
  await page.goto('/create/');
  await page.click('#price-list summary');
  await page.fill(
    '#price-list-text',
    [
      'Getränke',
      'Bier 0,5l: 4,00 €',
      'Bratwurst - 3,50',
      'Kaffee 2,-',
      'Steak....6',
      'Pfand zurück -2',
      '',
      'Schorle 0,5 l',
    ].join('\n'),
  );
  await page.click('#btn-price-list-apply');

  await expect(page.locator('#price-list-result')).toHaveText('5 Artikel übernommen.');
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText([
    'Bier 0,5l',
    'Bratwurst',
    'Kaffee',
    'Steak',
    'Pfand zurück',
  ]);
  await expect(page.locator('#setup-items-list .setup-item-price')).toHaveText([
    '4,00 €',
    '3,50 €',
    '2,00 €',
    '6,00 €',
    '-2,00 €',
  ]);
  await expect(page.locator('#price-list-rejected li')).toHaveText([
    'Zeile 1: „Getränke" (kein Preis am Zeilenende)',
    'Zeile 8: „Schorle 0,5 l" (kein Preis am Zeilenende)',
  ]);
  await expect(page.locator('#price-list-text')).toHaveValue('Getränke\nSchorle 0,5 l');

  await page.fill('#price-list-text', 'Schorle 0,5 l 2,50');
  await page.click('#btn-price-list-apply');
  await expect(page.locator('#setup-items-list .setup-item-row')).toHaveCount(6);
  await expect(page.locator('#price-list-rejected')).toBeHidden();
});

test('create copies the prompt for an AI app', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/create/');
  await page.click('#price-list summary');
  await page.click('#btn-copy-prompt');

  await expect(page.locator('#prompt-status')).toHaveText('Auftrag kopiert.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Preisliste auf dem Foto');
});
