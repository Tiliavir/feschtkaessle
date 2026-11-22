import { expect, type Page, test } from '@playwright/test';

// The configured endpoint (hugo.toml `feedbackEndpoint`); every test mocks it, nothing is sent for real.
const ENDPOINT = 'https://www.mv-wollbach.de/feedback.php';
const CORS = { 'Access-Control-Allow-Origin': '*' };

async function openFeedback(page: Page) {
  await page.goto('/feedback/');
}

test('settings and the close hint lead to the feedback page', async ({ page }) => {
  await page.goto('/settings/');
  await expect(page.locator('#feedback-section a')).toHaveAttribute('href', 'feedback/');
  await expect(page.locator('#close-notice-feedback')).toHaveAttribute('href', 'feedback/');
  await page.goto('/feedback/');
  await expect(page.locator('#feedback-form')).toBeVisible();
  await expect(page.locator('#feedback-unavailable')).toBeHidden();
});

test('guided answers are sent with technical details and a thank-you is shown', async ({ page }) => {
  let sent: string | null = null;
  let accept: string | undefined;
  await page.route(ENDPOINT, async (route) => {
    sent = route.request().postData();
    accept = route.request().headers().accept;
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
  expect(accept).toBe('application/json');
  for (const [name, value] of [
    ['source', 'feschtkaessle'],
    ['questions[nutzung]', 'Wofür nutzt du die App?'],
    ['answers[nutzung]', 'Vereinsfest'],
    ['questions[umstaendlich]', 'Was war beim letzten Fest umständlich?'],
    ['answers[umstaendlich]', 'Rückgeld bei Pfand'],
    ['answers[nervt]', ''],
    ['website', ''],
    ['meta[installiert]', 'nein'],
    ['meta[geraet]', 'desktop'],
  ]) {
    expect(body).toContain(`name="${name}"\r\n\r\n${value}\r\n`);
  }
  expect(body).toMatch(/name="meta\[version\]"\r\n\r\n\d+\.\d+\.\d+\r\n/);
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
