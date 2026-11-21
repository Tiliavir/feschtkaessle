import { expect, test } from '@playwright/test';
import { addSingleItem, openManualSetup } from './utils';

const LIST_WITH_UNCLEAR_LINES = [
  'Getränke',
  'Bier 0,5l: 4,00 €',
  'Bratwurst - 3,50',
  'Kaffee 2,-',
  'Steak....6',
  'Pfand zurück -2',
  '',
  'Schorle 0,5 l',
].join('\n');

test('manual entry starts with the text field only', async ({ page }) => {
  await page.goto('/create/');
  await page.click('#start-manual');

  await expect(page.locator('#manual-panel')).toBeVisible();
  await expect(page.locator('#manual-text')).toBeFocused();
  await expect(page.locator('#btn-manual-next')).toBeDisabled();
  await expect(page.locator('#item-name')).toBeHidden();
  await expect(page.locator('#item-color')).toBeHidden();

  await page.fill('#manual-text', 'Wasser 1,50\nBier 3');
  await page.click('#btn-manual-next');

  await expect(page.locator('#setup-screen')).toBeVisible();
  await expect(page.locator('#config-notice')).toContainText('2 Artikel übernommen');
  await expect(page.locator('#event-name')).toBeFocused();
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText(['Wasser', 'Bier']);
  await expect(page.locator('#price-list-text')).toHaveCount(0);
  await expect(page.locator('#item-add')).not.toHaveAttribute('open');
  await expect(page.locator('#price-list-rejected')).toBeHidden();

  await addSingleItem(page, 'Kaffee', '2');
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText(['Wasser', 'Bier', 'Kaffee']);
});

test('unclear lines are shown and can be corrected', async ({ page }) => {
  await page.goto('/create/');
  await page.click('#start-manual');
  await page.fill('#manual-text', LIST_WITH_UNCLEAR_LINES);
  await page.click('#btn-manual-next');

  await expect(page.locator('#setup-screen')).toBeHidden();
  await expect(page.locator('#manual-rejected-title')).toHaveText(
    '5 Artikel erkannt. Bei diesen Zeilen fehlt ein Preis am Ende:',
  );
  await expect(page.locator('#manual-rejected li')).toHaveText([
    'Zeile 1: „Getränke" (kein Preis am Zeilenende)',
    'Zeile 8: „Schorle 0,5 l" (kein Preis am Zeilenende)',
  ]);
  await expect(page.locator('#btn-manual-next')).toBeHidden();

  await page.click('#btn-manual-fix');
  await expect(page.locator('#manual-rejected')).toBeHidden();
  await expect(page.locator('#manual-text')).toBeFocused();
  await expect(page.locator('#manual-text')).toHaveValue(LIST_WITH_UNCLEAR_LINES);

  await page.fill(
    '#manual-text',
    LIST_WITH_UNCLEAR_LINES.replace('Getränke\n', '').replace('Schorle 0,5 l', 'Schorle 0,5 l 2,50'),
  );
  await page.click('#btn-manual-next');

  await expect(page.locator('#setup-screen')).toBeVisible();
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText([
    'Bier 0,5l',
    'Bratwurst',
    'Kaffee',
    'Steak',
    'Pfand zurück',
    'Schorle 0,5 l',
  ]);
  await expect(page.locator('#setup-items-list .setup-item-price')).toHaveText([
    '4,00 €',
    '3,50 €',
    '2,00 €',
    '6,00 €',
    '-2,00 €',
    '2,50 €',
  ]);
});

test('unclear lines can be skipped', async ({ page }) => {
  await page.goto('/create/');
  await page.click('#start-manual');
  await page.fill('#manual-text', LIST_WITH_UNCLEAR_LINES);
  await page.click('#btn-manual-next');
  await page.click('#btn-manual-skip');

  await expect(page.locator('#setup-screen')).toBeVisible();
  await expect(page.locator('#setup-items-list .setup-item-row')).toHaveCount(5);
  await expect(page.locator('#config-notice')).toContainText('5 Artikel übernommen');
  await expect(page.locator('#price-list-rejected')).toBeHidden();
});

test('without any recognised price only correcting is offered', async ({ page }) => {
  await page.goto('/create/');
  await page.click('#start-manual');
  await page.fill('#manual-text', 'Bier\nWurst');
  await page.click('#btn-manual-next');

  await expect(page.locator('#manual-rejected-title')).toHaveText('Keine Zeile hat einen erkennbaren Preis am Ende:');
  await expect(page.locator('#btn-manual-skip')).toBeHidden();
  await expect(page.locator('#btn-manual-fix')).toBeVisible();

  await page.fill('#manual-text', 'Bier 4');
  await expect(page.locator('#manual-rejected')).toBeHidden();
  await expect(page.locator('#btn-manual-next')).toBeVisible();
});

test('price list parser handles currencies, brackets and signs', async ({ page }) => {
  await openManualSetup(
    page,
    ['Wein 3,5 EUR', 'Kuchen (2,50)', 'Cola 0,33 l 2.50€', 'Pfand zurück −2', '• Brezel 1 Fr.'].join('\n'),
  );

  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText([
    'Wein',
    'Kuchen',
    'Cola 0,33 l',
    'Pfand zurück',
    'Brezel',
  ]);
  await expect(page.locator('#setup-items-list .setup-item-price')).toHaveText([
    '3,50 €',
    '2,50 €',
    '2,50 €',
    '-2,00 €',
    '1,00 €',
  ]);
});

test('lines without a price at the end are not taken over', async ({ page }) => {
  await page.goto('/create/');
  await page.click('#start-manual');
  await page.fill('#manual-text', 'Wein 3\nBier4\n12345');
  await page.click('#btn-manual-next');

  await expect(page.locator('#manual-rejected li')).toHaveText([
    'Zeile 2: „Bier4" (kein Preis am Zeilenende)',
    'Zeile 3: „12345" (kein Preis am Zeilenende)',
  ]);
});
