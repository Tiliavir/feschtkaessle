import { expect, type Page, test } from '@playwright/test';
import { buildSeedState, STORAGE_KEY } from './utils';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const FIREFOX_ANDROID_UA = 'Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0';

async function seed(page: Page) {
  const { state } = buildSeedState();
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [STORAGE_KEY, JSON.stringify(state)],
  );
}

// Fires a fake `beforeinstallprompt` like Chrome on Android; records whether prompt() was called.
async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed') {
  await page.evaluate((result) => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt(): Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    event.prompt = () => {
      sessionStorage.setItem('prompted', '1');
      return Promise.resolve();
    };
    event.userChoice = Promise.resolve({ outcome: result });
    globalThis.dispatchEvent(event);
  }, outcome);
}

test('the cashier offers the native install dialog and hides the hint after installing', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#install-bar')).toBeHidden();

  await offerInstall(page, 'accepted');
  await expect(page.locator('#install-bar')).toBeVisible();
  await expect(page.locator('#btn-install-howto')).toBeHidden();

  await page.click('#btn-install');
  expect(await page.evaluate(() => sessionStorage.getItem('prompted'))).toBe('1');
  await expect(page.locator('#install-bar')).toBeHidden();

  await page.reload();
  await offerInstall(page, 'dismissed');
  await expect(page.locator('#install-bar')).toBeHidden();
});

test('after a declined dialog the hint returns with the next offer, × hides it for good', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await offerInstall(page, 'dismissed');
  await page.click('#btn-install');
  await expect(page.locator('#install-bar')).toBeHidden();

  await page.reload();
  await offerInstall(page, 'dismissed');
  await expect(page.locator('#install-bar')).toBeVisible();
  await page.click('#btn-install-dismiss');
  await expect(page.locator('#install-bar')).toBeHidden();

  await page.reload();
  await offerInstall(page, 'dismissed');
  await expect(page.locator('#install-bar')).toBeHidden();

  await page.goto('/settings/');
  await offerInstall(page, 'dismissed');
  await expect(page.locator('#install-section')).toBeVisible();
  await expect(page.locator('#btn-install')).toBeVisible();
});

test.describe('on iPhone', () => {
  test.use({ userAgent: IPHONE_UA });

  test('the cashier explains how to add the app to the home screen', async ({ page }) => {
    await seed(page);
    await page.goto('/');
    await expect(page.locator('#install-bar')).toBeVisible();
    await expect(page.locator('#btn-install')).toBeHidden();
    await expect(page.locator('#install-howto')).toBeHidden();

    await page.click('#btn-install-howto');
    await expect(page.locator('#install-howto')).toHaveText(
      'Im Browser auf „Teilen" tippen, dann „Zum Home-Bildschirm".',
    );
  });

  test('nothing is suggested inside the installed app', async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => {
      const original = globalThis.matchMedia.bind(globalThis);
      globalThis.matchMedia = (query: string) =>
        query === '(display-mode: standalone)' ? ({ matches: true } as MediaQueryList) : original(query);
    });
    await page.goto('/');
    await expect(page.locator('.item-tile')).toHaveCount(2);
    await expect(page.locator('#install-bar')).toBeHidden();
    await page.goto('/settings/');
    await expect(page.locator('#install-section')).toBeHidden();
  });
});

test.describe('in Firefox for Android', () => {
  test.use({ userAgent: FIREFOX_ANDROID_UA });

  test('settings explain the Firefox menu', async ({ page }) => {
    await seed(page);
    await page.goto('/settings/');
    await expect(page.locator('#install-section')).toBeVisible();
    await page.click('#btn-install-howto');
    await expect(page.locator('#install-howto')).toContainText('Firefox-Menü');
  });
});

test('desktop browsers without install support show nothing', async ({ page }) => {
  await seed(page);
  await page.goto('/settings/');
  await expect(page.locator('#settings-event-name')).toHaveText('Vereinsfest');
  await expect(page.locator('#install-section')).toBeHidden();
});
