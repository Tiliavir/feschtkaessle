import { expect, test } from '@playwright/test';
import { buildClosedEventSeed, buildSeedState, STORAGE_KEY, stubStoragePersistence } from './utils';

test('settings shows active and past events', async ({ page }) => {
  const activeSeed = buildSeedState();
  const closedSeed = buildClosedEventSeed();
  const merged = {
    events: [...activeSeed.state.events, ...closedSeed.state.events],
    activeEventId: activeSeed.state.activeEventId,
  };

  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify(merged)],
  );

  await page.goto('/settings/');

  await expect(page.locator('#settings-event-name')).toContainText('Vereinsfest');
  await expect(page.locator('.all-event-row')).toHaveCount(2);
});

test('settings shows storage persistence and requests it on demand', async ({ page }) => {
  await page.addInitScript(stubStoragePersistence, true);
  await page.goto('/settings/');

  const status = page.locator('#storage-status');
  const button = page.locator('#btn-persist-storage');
  await expect(status).toContainText('Nicht dauerhaft gespeichert');
  await expect(button).toBeVisible();

  await button.click();
  await expect(status).toContainText('Dauerhaft gespeichert');
  await expect(button).toBeHidden();
});

test('settings explains when persistence is denied', async ({ page }) => {
  await page.addInitScript(stubStoragePersistence, false);
  await page.goto('/settings/');

  await page.click('#btn-persist-storage');
  await expect(page.locator('#storage-status')).toContainText('Nicht dauerhaft gespeichert');
  await expect(page.locator('#btn-persist-storage')).toBeVisible();
});
