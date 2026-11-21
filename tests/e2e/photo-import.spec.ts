import { expect, type Page, test } from '@playwright/test';

const PHOTO = 'tests/e2e/fixtures/price-board.png';

async function configure(page: Page, settings: unknown) {
  await page.addInitScript((value) => {
    localStorage.setItem('feschtkaessle_vision_v1', value);
  }, JSON.stringify(settings));
}

test('create hints at the settings while no provider is set up', async ({ page }) => {
  await page.goto('/create/');
  await page.click('#price-list summary');
  await expect(page.locator('#photo-import')).toBeHidden();
  await expect(page.locator('#photo-setup-hint')).toBeVisible();
});

test('settings store provider, key and model on this device', async ({ page }) => {
  await page.goto('/settings/');
  await expect(page.locator('#vision-details')).toBeHidden();
  await page.selectOption('#vision-provider', 'anthropic');
  await expect(page.locator('#vision-model')).toHaveAttribute('placeholder', 'claude-haiku-5-5');
  await page.selectOption('#vision-provider', 'gemini');
  await expect(page.locator('#vision-model')).toHaveAttribute('placeholder', 'gemini-3.5-flash-lite');
  await page.selectOption('#vision-provider', 'anthropic');
  await page.fill('#vision-key', ' sk-ant-test ');
  await page.locator('#vision-key').blur();

  const stored = () => page.evaluate(() => localStorage.getItem('feschtkaessle_vision_v1'));
  await expect
    .poll(async () => JSON.parse((await stored()) ?? 'null'))
    .toEqual({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: '',
    });

  await page.selectOption('#vision-provider', '');
  await expect.poll(stored).toBeNull();
  await expect(page.locator('#vision-status')).toContainText('Schlüssel gelöscht');
});

test('a photo is read via Anthropic and lands in the text field for review', async ({ page }) => {
  await configure(page, { provider: 'anthropic', apiKey: 'sk-ant-test', model: '' });
  let request: { headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    request = { headers: route.request().headers(), body: route.request().postDataJSON() };
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      json: { content: [{ type: 'text', text: 'Bratwurst 3,50\nBier 4,00\nPfand -2' }] },
    });
  });

  await page.goto('/create/');
  await page.click('#price-list summary');
  await page.setInputFiles('#photo-file', PHOTO);

  await expect(page.locator('#photo-status')).toContainText('Bitte prüfen');
  await expect(page.locator('#price-list-text')).toHaveValue('Bratwurst 3,50\nBier 4,00\nPfand -2');
  await expect(page.locator('#setup-items-list .setup-item-row')).toHaveCount(0);

  expect(request).not.toBeNull();
  const sent = request as unknown as { headers: Record<string, string>; body: Record<string, unknown> };
  expect(sent.headers['x-api-key']).toBe('sk-ant-test');
  expect(sent.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(sent.body.model).toBe('claude-haiku-5-5');
  const content = (
    sent.body.messages as { content: { type: string; source?: { media_type: string; data: string } }[] }[]
  )[0].content;
  expect(content[0].type).toBe('image');
  expect(content[0].source?.media_type).toBe('image/jpeg');
  expect(content[0].source?.data.length).toBeGreaterThan(100);

  await page.click('#btn-price-list-apply');
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText(['Bratwurst', 'Bier', 'Pfand']);
});

test('a photo is read via OpenAI with the chosen model', async ({ page }) => {
  await configure(page, { provider: 'openai', apiKey: 'sk-test', model: 'gpt-custom' });
  let body: Record<string, unknown> | null = null;
  let auth = '';
  await page.route('https://api.openai.com/v1/chat/completions', async (route) => {
    body = route.request().postDataJSON();
    auth = route.request().headers().authorization;
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      json: { choices: [{ message: { content: 'Kaffee 2,00' } }] },
    });
  });

  await page.goto('/create/');
  await page.click('#price-list summary');
  await page.fill('#price-list-text', 'Kuchen 2,50');
  await page.setInputFiles('#photo-file', PHOTO);

  await expect(page.locator('#price-list-text')).toHaveValue('Kuchen 2,50\nKaffee 2,00');
  expect(auth).toBe('Bearer sk-test');
  expect((body as unknown as { model: string }).model).toBe('gpt-custom');
});

test('a rejected key is reported and nothing is added', async ({ page }) => {
  await configure(page, { provider: 'anthropic', apiKey: 'wrong', model: '' });
  await page.route('https://api.anthropic.com/v1/messages', (route) =>
    route.fulfill({
      status: 401,
      headers: { 'access-control-allow-origin': '*' },
      json: { error: { message: 'invalid x-api-key' } },
    }),
  );

  await page.goto('/create/');
  await page.click('#price-list summary');
  await page.setInputFiles('#photo-file', PHOTO);

  await expect(page.locator('#photo-error')).toContainText('API-Schlüssel wurde abgelehnt');
  await expect(page.locator('#price-list-text')).toHaveValue('');
  await expect(page.locator('#btn-photo')).toBeEnabled();
});

test('reading a photo offline explains why it does not work', async ({ page, context }) => {
  await configure(page, { provider: 'anthropic', apiKey: 'sk-ant-test', model: '' });
  await page.goto('/create/');
  await page.click('#price-list summary');
  await context.setOffline(true);
  await page.setInputFiles('#photo-file', PHOTO);

  await expect(page.locator('#photo-error')).toHaveText('Keine Internetverbindung.');
});

test('a photo is read via Gemini', async ({ page }) => {
  await configure(page, { provider: 'gemini', apiKey: 'AIza-test', model: '' });
  let sent: { url: string; key: string; body: Record<string, unknown> } | null = null;
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    sent = {
      url: route.request().url(),
      key: route.request().headers()['x-goog-api-key'],
      body: route.request().postDataJSON(),
    };
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      json: { candidates: [{ content: { parts: [{ text: 'Brezel 1,50\nKaffee 2,00' }] } }] },
    });
  });

  await page.goto('/create/');
  await page.click('#price-list summary');
  await page.setInputFiles('#photo-file', PHOTO);

  await expect(page.locator('#price-list-text')).toHaveValue('Brezel 1,50\nKaffee 2,00');
  const request = sent as unknown as { url: string; key: string; body: Record<string, unknown> };
  expect(request.url).toBe(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
  );
  expect(request.key).toBe('AIza-test');
  const parts = (request.body.contents as { parts: { inlineData?: { mimeType: string } }[] }[])[0].parts;
  expect(parts[0].inlineData?.mimeType).toBe('image/jpeg');
});

test('Gemini reports an invalid key as rejected', async ({ page }) => {
  await configure(page, { provider: 'gemini', apiKey: 'wrong', model: '' });
  await page.route('https://generativelanguage.googleapis.com/**', (route) =>
    route.fulfill({
      status: 400,
      headers: { 'access-control-allow-origin': '*' },
      json: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } },
    }),
  );
  await page.goto('/create/');
  await page.click('#price-list summary');
  await page.setInputFiles('#photo-file', PHOTO);

  await expect(page.locator('#photo-error')).toContainText('API-Schlüssel wurde abgelehnt');
});
