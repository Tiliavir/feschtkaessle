import { expect, type Page, test } from '@playwright/test';

const PHOTO = 'tests/e2e/fixtures/price-board.png';
const SETTINGS_KEY = 'feschtkaessle_vision_v1';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CORS = { 'access-control-allow-origin': '*' };

async function store(page: Page, settings: unknown) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, value);
    },
    [SETTINGS_KEY, JSON.stringify(settings)],
  );
}

const connected = (page: Page) => store(page, { provider: 'openrouter', apiKey: 'sk-or-test' });
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);

// OpenRouter's auth page is replaced by a redirect back to the callback, like after "allow".
async function fakeOpenRouterAuth(page: Page, options: { state?: string } = {}) {
  const auth: { url: URL | null; exchange: Record<string, string> | null } = { url: null, exchange: null };
  await page.route('https://openrouter.ai/auth?**', async (route) => {
    const url = new URL(route.request().url());
    auth.url = url;
    const back = new URL(url.searchParams.get('callback_url') ?? '');
    back.searchParams.set('code', 'auth-code');
    back.searchParams.set('state', options.state ?? url.searchParams.get('state') ?? '');
    await route.fulfill({ status: 302, headers: { location: back.href } });
  });
  await page.route('https://openrouter.ai/api/v1/auth/keys', async (route) => {
    auth.exchange = route.request().postDataJSON();
    await route.fulfill({ status: 200, headers: CORS, json: { key: 'sk-or-new', user_id: 'u1' } });
  });
  return auth;
}

async function pickPhoto(page: Page, trigger: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.click(trigger);
  await (await chooser).setFiles(PHOTO);
}

test('the photo card asks to connect while not connected', async ({ page }) => {
  await page.goto('/create/');
  await page.click('#start-photo');
  await expect(page.locator('#photo-connect')).toBeVisible();
  await expect(page.locator('#photo-ready')).toBeHidden();
  await expect(page.locator('#btn-connect')).toHaveText('Mit OpenRouter verbinden');
});

test('keys of the former direct providers are dropped', async ({ page }) => {
  await store(page, { provider: 'anthropic', apiKey: 'sk-ant-test', model: '' });
  await page.goto('/create/');
  await page.click('#start-photo');
  await expect(page.locator('#photo-connect')).toBeVisible();
  expect(await stored(page)).toBeNull();
});

test('connecting runs the PKCE flow and keeps the key on this device', async ({ page }) => {
  const auth = await fakeOpenRouterAuth(page);
  await page.goto('/create/');
  await page.click('#start-photo');
  await page.click('#btn-connect');

  await expect(page.locator('#photo-ready')).toBeVisible();
  await expect(page.locator('#photo-connected')).toContainText('Verbunden');
  expect(new URL(page.url()).search).toBe('');
  expect(JSON.parse((await stored(page)) ?? 'null')).toEqual({ provider: 'openrouter', apiKey: 'sk-or-new' });

  const url = auth.url as unknown as URL;
  expect(url.searchParams.get('callback_url')).toMatch(/\/create\/$/);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  const exchange = auth.exchange as unknown as Record<string, string>;
  expect(exchange.code).toBe('auth-code');
  expect(exchange.code_challenge_method).toBe('S256');
  const challenge = await page.evaluate(async (verifier) => {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    return btoa(String.fromCodePoint(...digest))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }, exchange.code_verifier);
  expect(url.searchParams.get('code_challenge')).toBe(challenge);
});

test('a callback with a foreign state is refused', async ({ page }) => {
  await fakeOpenRouterAuth(page, { state: 'forged' });
  await page.goto('/create/');
  await page.click('#start-photo');
  await page.click('#btn-connect');

  await expect(page.locator('#photo-error')).toContainText('nicht zugeordnet');
  await expect(page.locator('#photo-connect')).toBeVisible();
  expect(await stored(page)).toBeNull();
});

test('a photo is read via OpenRouter and its items are ready for review', async ({ page }) => {
  await connected(page);
  let request: { auth: string; body: Record<string, unknown> } | null = null;
  await page.route(CHAT_URL, async (route) => {
    request = { auth: route.request().headers().authorization, body: route.request().postDataJSON() };
    await route.fulfill({
      status: 200,
      headers: CORS,
      json: { choices: [{ message: { content: 'Getränke\nBratwurst 3,50\nBier 4,00\nPfand -2' } }] },
    });
  });

  await page.goto('/create/');
  await pickPhoto(page, '#start-photo');

  await expect(page.locator('#setup-screen')).toBeVisible();
  await expect(page.locator('#config-notice')).toContainText('3 Artikel vom Foto übernommen');
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText(['Bratwurst', 'Bier', 'Pfand']);
  await expect(page.locator('#price-list-rejected li')).toHaveText(['Zeile 1: „Getränke" (kein Preis am Zeilenende)']);
  await expect(page.locator('#price-list')).toHaveAttribute('open', '');

  const sent = request as unknown as { auth: string; body: Record<string, unknown> };
  expect(sent.auth).toBe('Bearer sk-or-test');
  expect(sent.body.model).toBe('openrouter/free');
  const content = (sent.body.messages as { content: { type: string; image_url?: { url: string } }[] }[])[0].content;
  expect(content[0].type).toBe('text');
  expect(content[1].image_url?.url).toMatch(/^data:image\/jpeg;base64,.{100}/);
});

test('the photo button opens the camera, the second button the gallery', async ({ page }) => {
  await connected(page);
  await page.route(CHAT_URL, (route) =>
    route.fulfill({ status: 200, headers: CORS, json: { choices: [{ message: { content: 'Bier 4,00' } }] } }),
  );

  await page.goto('/create/');
  await expect(page.locator('#photo-file')).toHaveAttribute('capture', 'environment');
  await expect(page.locator('#photo-pick')).not.toHaveAttribute('capture');

  const camera = page.waitForEvent('filechooser');
  await page.click('#start-photo');
  await (await camera).setFiles([]);
  await pickPhoto(page, '#btn-photo-pick');
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText(['Bier']);
});

test('an expired connection is reported and nothing is added', async ({ page }) => {
  await connected(page);
  await page.route(CHAT_URL, (route) =>
    route.fulfill({ status: 401, headers: CORS, json: { error: { message: 'User not found.' } } }),
  );

  await page.goto('/create/');
  await pickPhoto(page, '#start-photo');

  await expect(page.locator('#photo-error')).toContainText('neu verbinden');
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#btn-photo')).toBeEnabled();
});

test('reading a photo offline explains why it does not work', async ({ page, context }) => {
  await connected(page);
  await page.goto('/create/');
  await context.setOffline(true);
  await page.setInputFiles('#photo-file', PHOTO);

  await expect(page.locator('#photo-error')).toHaveText('Keine Internetverbindung.');
});

test('without an account the answer of an AI app is taken over', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/create/');
  await page.click('#start-photo');
  await page.click('#btn-no-account');
  await expect(page.locator('#ki-app')).toBeVisible();

  await page.click('#btn-copy-prompt');
  await expect(page.locator('#prompt-status')).toHaveText('Auftrag kopiert.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Preisliste auf dem Foto');

  await page.click('#btn-ki-apply');
  await expect(page.locator('#prompt-status')).toContainText('Antwort der KI-App einfügen');

  await page.fill('#ki-answer', 'Kaffee 2,00\nKuchen 2,50');
  await page.click('#btn-ki-apply');
  await expect(page.locator('#setup-screen')).toBeVisible();
  await expect(page.locator('#setup-items-list .setup-item-name')).toHaveText(['Kaffee', 'Kuchen']);
  await expect(page.locator('#config-notice')).toContainText('aus der KI-App');
});

test('the photo is shared to an AI app together with the prompt', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        sessionStorage.setItem('shared', JSON.stringify({ files: data.files?.length ?? 0, text: data.text }));
      },
    });
  });
  await page.goto('/create/');
  await page.click('#start-photo');
  await page.click('#btn-no-account');
  await pickPhoto(page, '#btn-share-photo');

  await expect
    .poll(async () => JSON.parse((await page.evaluate(() => sessionStorage.getItem('shared'))) ?? 'null'))
    .toEqual({ files: 1, text: expect.stringContaining('Preisliste auf dem Foto') });
});

test('the share button is hidden where images cannot be shared', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
  });
  await page.goto('/create/');
  await page.click('#start-photo');
  await page.click('#btn-no-account');
  await expect(page.locator('#btn-share-photo')).toBeHidden();
  await expect(page.locator('#btn-copy-prompt')).toBeVisible();
});

test('settings connect and disconnect OpenRouter', async ({ page }) => {
  await fakeOpenRouterAuth(page);
  await page.goto('/settings/');
  await expect(page.locator('#vision-status')).toHaveText('Nicht verbunden.');
  await page.click('#btn-vision-connect');

  await expect(page.locator('#vision-status')).toHaveText('Mit OpenRouter verbunden.');
  expect(new URL(page.url()).pathname).toMatch(/\/settings\/$/);
  expect(new URL(page.url()).search).toBe('');

  await page.click('#btn-vision-disconnect');
  await expect(page.locator('#vision-status')).toHaveText('Nicht verbunden.');
  await expect(page.locator('#btn-vision-connect')).toBeVisible();
  expect(await stored(page)).toBeNull();
});
