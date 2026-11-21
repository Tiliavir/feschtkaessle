import { expect, type Page, test } from '@playwright/test';
import { buildSeedState, STORAGE_KEY } from './utils';

const ITEMS = [
  { id: 'a-wasser', name: 'Wasser', price: 1.5, color: '#85c1e9' },
  { id: 'a-bier', name: 'Bier', price: 2.5, color: '#e67e22' },
];

function deviceState(deviceId: string, deviceName: string, transactions: unknown[], items = ITEMS) {
  return {
    events: [
      {
        id: `event-${deviceId}`,
        name: 'Vereinsfest',
        createdAt: '2026-07-01T10:00:00.000Z',
        items,
        transactions,
        closed: false,
        importedItems: [],
        devices: {},
      },
    ],
    activeEventId: `event-${deviceId}`,
    deviceId,
    deviceName,
  };
}

function tx(id: string, deviceId: string, time: string, lines: [string, number][], total: number) {
  return {
    id,
    deviceId,
    timestamp: `2026-07-01T${time}:00.000Z`,
    items: lines.map(([itemId, quantity]) => ({ itemId, quantity })),
    total,
    received: total,
    change: 0,
  };
}

async function seed(page: Page, state: unknown) {
  await page.addInitScript(
    ([key, value]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify(state)],
  );
}

async function download(page: Page, button: string) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
  });
  const [file] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
  return file;
}

test('older data gets transaction and device ids once', async ({ page }) => {
  const { state } = buildSeedState();
  await seed(page, state);
  await page.goto('/settings/');

  const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), STORAGE_KEY);
  const first = await read();
  expect(first.deviceId).toEqual(expect.any(String));
  expect(first.events[0].transactions[0].id).toEqual(expect.any(String));
  expect(first.events[0].transactions[0].deviceId).toBe(first.deviceId);
  expect(first.events[0].importedItems).toEqual([]);

  await page.reload();
  expect(await read()).toEqual(first);
});

test('cashier records transaction id and device', async ({ page }) => {
  await seed(page, deviceState('dev-a', 'Kasse A', []));
  await page.goto('/');
  await page.locator('.item-tile', { hasText: 'Bier' }).click();
  await page.click('#btn-next-tx');

  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').events[0].transactions, STORAGE_KEY),
    )
    .toEqual([expect.objectContaining({ id: expect.any(String), deviceId: 'dev-a', total: 2.5 })]);
});

test('sales of two devices merge into one statement without duplicates', async ({ browser }, testInfo) => {
  // Device B: own item ids (created from the share link), one extra item, same transaction twice in the file.
  const pageB = await browser.newPage();
  const itemsB = [
    { id: 'b-wasser', name: 'Wasser', price: 1.5, color: '#85c1e9' },
    { id: 'b-bier', name: 'Bier', price: 2.5, color: '#e67e22' },
    { id: 'b-wurst', name: 'Wurst', price: 3.5, color: '#d35400' },
  ];
  await seed(
    pageB,
    deviceState(
      'dev-b',
      'Kasse Grill',
      [
        tx('b1', 'dev-b', '18:05', [['b-bier', 2]], 5),
        tx(
          'b2',
          'dev-b',
          '19:10',
          [
            ['b-wurst', 1],
            ['b-wasser', 1],
          ],
          5,
        ),
      ],
      itemsB,
    ),
  );
  await pageB.goto('/stats/?id=event-dev-b');
  const exported = await download(pageB, '#btn-export-sales');
  const exportPath = testInfo.outputPath('sales-b.json');
  await exported.saveAs(exportPath);
  await pageB.close();

  const pageA = await browser.newPage();
  await seed(pageA, deviceState('dev-a', 'Kasse Bar', [tx('a1', 'dev-a', '18:00', [['a-bier', 1]], 2.5)]));
  await pageA.goto('/stats/?id=event-dev-a');

  await pageA.setInputFiles('#import-sales-file', exportPath);
  await expect(pageA.locator('#sales-status')).toHaveText('2 Transaktionen übernommen.');
  await expect(pageA.locator('.stat-card-value').first()).toHaveText('12,50 €');
  await expect(pageA.locator('#items-table-body tr')).toHaveCount(3);
  await expect(pageA.locator('#items-table-body tr', { hasText: 'Bier' })).toContainText('3');
  await expect(pageA.locator('#devices-table-body tr')).toHaveText([
    /Kasse Grill\s*2\s*10,00 €/,
    /Kasse Bar\s*1\s*2,50 €/,
  ]);

  await pageA.setInputFiles('#import-sales-file', exportPath);
  await expect(pageA.locator('#sales-status')).toHaveText('0 Transaktionen übernommen, 2 waren schon vorhanden.');
  await expect(pageA.locator('.stat-card-value').first()).toHaveText('12,50 €');

  await pageA.reload();
  await expect(pageA.locator('.stat-card-value').first()).toHaveText('12,50 €');

  // CSV goes through the share sheet where files can be shared (Android).
  await pageA.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        if (!file) return;
        sessionStorage.setItem('shared-csv', await file.text());
        sessionStorage.setItem('shared-head', new Uint8Array(await file.arrayBuffer()).slice(0, 3).join(','));
        sessionStorage.setItem('shared-name', file.name);
      },
    });
  });
  await pageA.click('#btn-export-csv');
  await expect
    .poll(() => pageA.evaluate(() => sessionStorage.getItem('shared-name')))
    .toBe('Vereinsfest_2026-07-01.csv');
  const content = (await pageA.evaluate(() => sessionStorage.getItem('shared-csv'))) ?? '';
  // UTF-8 byte order mark, so Excel shows umlauts correctly.
  expect(await pageA.evaluate(() => sessionStorage.getItem('shared-head'))).toBe('239,187,191');
  expect(content.replace(/^\uFEFF/, '').startsWith('Veranstaltung;Vereinsfest\r\n')).toBe(true);
  expect(content).toContain('Artikel;Preis;Anzahl;Umsatz\r\nBier;2,50;3;7,50\r\n');
  expect(content).toContain('Kasse Grill;2;10,00');
  expect(content).toContain('Summe;3;12,50');
  await pageA.close();
});

test('import rejects files that are no sales export', async ({ page }) => {
  await seed(page, deviceState('dev-a', '', []));
  await page.goto('/stats/?id=event-dev-a');
  await page.setInputFiles('#import-sales-file', 'tests/e2e/fixtures/import-event.json');
  await expect(page.locator('#sales-error')).toContainText('kein Verkaufs-Export');
});

test('settings saves the device name and hints at the export when closing', async ({ page }) => {
  await seed(page, deviceState('dev-a', '', []));
  await page.goto('/settings/');
  await page.fill('#device-name', 'Kasse Bar');
  await page.locator('#device-name').blur();
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').deviceName, STORAGE_KEY))
    .toBe('Kasse Bar');

  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#btn-close-event');
  await expect(page.locator('#close-notice')).toBeVisible();
  await expect(page.locator('#close-notice-stats')).toHaveAttribute('href', /stats\/\?id=event-dev-a$/);
});

test('data under the legacy key is moved to the new key once', async ({ page }) => {
  const { state } = buildSeedState();
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('kassierer_app_v1', value);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(state));
  await page.goto('/settings/');

  await expect(page.locator('#settings-event-name')).toContainText('Vereinsfest');
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toContain('feschtkaessle_app_v1');
  expect(keys).not.toContain('kassierer_app_v1');

  await page.reload();
  await expect(page.locator('#settings-event-name')).toContainText('Vereinsfest');
});
