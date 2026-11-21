import { expect, test } from '@playwright/test';
import { openManualSetup, stubStoragePersistence } from './utils';

test('create flow enables start and navigates to cashier', async ({ page }) => {
  await openManualSetup(page);

  await page.fill('#event-name', 'Vereinsfest');
  await page.fill('#item-name', 'Wasser');
  await page.fill('#item-price', '1.50');
  await page.click('#btn-add-item');

  await page.check('#accept-liability');

  const startButton = page.locator('#btn-start-event');
  await expect(startButton).toBeEnabled();

  await startButton.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#cashier-event-name')).toContainText('Vereinsfest');
});

test('create edits, cancels and removes pending items inline', async ({ page }) => {
  await openManualSetup(page);
  for (const [name, price] of [
    ['Wasser', '1.50'],
    ['Bier', '3'],
  ]) {
    await page.fill('#item-name', name);
    await page.fill('#item-price', price);
    await page.click('#btn-add-item');
  }
  const rows = page.locator('#setup-items-list .setup-item-row');
  await expect(rows).toHaveCount(2);

  await rows.first().locator('.setup-item-name').click();
  const editRow = page.locator('#setup-items-list .setup-item-edit');
  await editRow.locator('.edit-name').fill('Sprudel');
  await editRow.locator('.edit-price').fill('2');
  await editRow.locator('.btn-save-item').click();
  await expect(rows.first().locator('.setup-item-name')).toHaveText('Sprudel');

  await rows.first().locator('.setup-item-name').click();
  await editRow.locator('.edit-name').fill('Verworfen');
  await editRow.locator('.btn-cancel-edit').click();
  await expect(rows.first().locator('.setup-item-name')).toHaveText('Sprudel');

  await rows.nth(1).locator('.btn-remove-item').click();
  await expect(rows).toHaveCount(1);
});

test('create imports an event from a JSON file', async ({ page }) => {
  await page.goto('/create/');
  await page.setInputFiles('#import-file', 'tests/e2e/fixtures/import-event.json');

  await expect(page.locator('#event-name')).toHaveValue('Sommerfest');
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText('Wurst');
  await expect(page.locator('#import-error')).toHaveText('');
  await expect(page.locator('#config-notice')).toContainText('Einrichtung übernommen');

  await page.click('#btn-restart');
  await page.setInputFiles('#import-file', 'tests/e2e/fixtures/import-invalid.txt');
  await expect(page.locator('#import-error')).toContainText('Ungültiges JSON-Format');
  await expect(page.locator('#start-screen')).toBeVisible();
});

test('create starts on the start screen and loads the example', async ({ page }) => {
  await page.goto('/create/');
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#setup-screen')).toBeHidden();

  await page.click('#start-example');
  await expect(page.locator('#setup-screen')).toBeVisible();
  await expect(page.locator('#event-name')).toHaveValue('Vereinsfest');
  await expect(page.locator('#setup-items-list .setup-item-row')).toHaveCount(14);
  await expect(page.locator('#config-notice')).toContainText('Beispiel geladen');

  await page.click('#btn-restart');
  await expect(page.locator('#start-screen')).toBeVisible();
});

test('the template card opens the file picker', async ({ page }) => {
  await page.goto('/create/');
  const chooser = page.waitForEvent('filechooser');
  await page.click('#start-template');
  await (await chooser).setFiles('tests/e2e/fixtures/import-event.json');
  await expect(page.locator('#event-name')).toHaveValue('Sommerfest');
});

test('starting an event requests persistent storage', async ({ page }) => {
  await page.addInitScript(stubStoragePersistence, true);
  await openManualSetup(page);
  await page.fill('#event-name', 'Vereinsfest');
  await page.fill('#item-name', 'Wasser');
  await page.fill('#item-price', '1.50');
  await page.click('#btn-add-item');
  await page.check('#accept-liability');

  await page.click('#btn-start-event');
  await expect(page.locator('#cashier-event-name')).toContainText('Vereinsfest');

  expect(await page.evaluate(() => sessionStorage.getItem('persist-calls'))).toBe('1');
});
