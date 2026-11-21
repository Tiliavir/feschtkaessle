import { expect, type Page, test } from '@playwright/test';

// The build has no endpoint configured (hugo.toml `feedbackEndpoint`); tests inject one into the page.
const ENDPOINT = 'https://feedback.test/feschtkaessle-feedback.php';
const CORS = { 'Access-Control-Allow-Origin': '*' };

async function openFeedback(page: Page) {
  await page.route('**/feedback/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace(/data-endpoint(="")?(?=[\s>])/, `data-endpoint=${ENDPOINT}`)
      .replace(/<form id=feedback-form([^>]*?) hidden/, '<form id=feedback-form$1');
    await route.fulfill({ response, body: html });
  });
  await page.goto('/feedback/');
}

test('without a configured endpoint the app offers no feedback', async ({ page }) => {
  await page.goto('/settings/');
  await expect(page.locator('#feedback-section')).toHaveCount(0);
  await page.goto('/feedback/');
  await expect(page.locator('#feedback-form')).toBeHidden();
  await expect(page.locator('#feedback-unavailable')).toBeVisible();
});

test('guided answers are sent with technical details and a thank-you is shown', async ({ page }) => {
  let sent: string | null = null;
  await page.route(ENDPOINT, async (route) => {
    sent = route.request().postData();
    await route.fulfill({ status: 201, headers: CORS, json: { result: 'ok' } });
  });
  await openFeedback(page);

  await expect(page.locator('#feedback-form legend')).toHaveText([
    'Wofür nutzt du die App?',
    'Wie viele Geräte kassieren bei euch?',
    'Würdest du sie wieder nutzen?',
  ]);
  await page.click('#btn-feedback-send');
  await expect(page.locator('#feedback-error')).toHaveText('Bitte beantworte mindestens eine Frage.');
  expect(sent).toBeNull();

  await page.getByText('Vereinsfest', { exact: true }).click();
  await page.fill('#fb-umstaendlich', 'Rückgeld bei Pfand');
  await page.click('#btn-feedback-send');

  await expect(page.locator('#feedback-thanks')).toBeVisible();
  await expect(page.locator('#feedback-form')).toBeHidden();
  const body = sent as unknown as string;
  for (const [name, value] of [
    ['nutzung', 'vereinsfest'],
    ['umstaendlich', 'Rückgeld bei Pfand'],
    ['website', ''],
    ['installiert', 'nein'],
    ['geraet', 'desktop'],
  ]) {
    expect(body).toContain(`name="${name}"\r\n\r\n${value}\r\n`);
  }
  expect(body).toMatch(/name="version"\r\n\r\n\d+\.\d+\.\d+\r\n/);
  expect(body).toMatch(/name="started"\r\n\r\n\d{13}\r\n/);
});

test('a rate limit is explained and the answers stay', async ({ page }) => {
  await page.route(ENDPOINT, (route) => route.fulfill({ status: 429, headers: CORS, json: { result: 'rate-limit' } }));
  await openFeedback(page);
  await page.fill('#fb-nervt', 'Nichts');
  await page.click('#btn-feedback-send');

  await expect(page.locator('#feedback-error')).toContainText('sehr viele Rückmeldungen');
  await expect(page.locator('#fb-nervt')).toHaveValue('Nichts');
  await expect(page.locator('#btn-feedback-send')).toBeEnabled();
});

test('offline the answers stay for later', async ({ page, context }) => {
  await openFeedback(page);
  await page.fill('#fb-fehlt', 'Bon-Drucker');
  await context.setOffline(true);
  await page.click('#btn-feedback-send');

  await expect(page.locator('#feedback-error')).toContainText('Keine Internetverbindung');
  await expect(page.locator('#fb-fehlt')).toHaveValue('Bon-Drucker');
});
