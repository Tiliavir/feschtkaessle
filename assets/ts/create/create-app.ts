import type { EventConfig, Item, RejectedLine } from '../shared/index';
import { EventConfigs, ItemEditor, Models, PriceList, Storage, UI, Vision, VisionError } from '../shared/index';

// ─── Create Page ──────────────────────────────────────────────────────────────
// Start screen (how to start: photo, template, example, manual) → setup screen (review, start).
const CreateApp = (() => {
  let pendingItems: Item[] = [];
  let editor: ReturnType<typeof ItemEditor.bind> | null = null;

  const EXAMPLE_ITEMS = [
    { name: 'Softdrinks', price: 2.0, color: '#3498db' },
    { name: 'Bier', price: 2.5, color: '#e67e22' },
    { name: 'Wasser', price: 1.5, color: '#85c1e9' },
    { name: 'Wein', price: 3.0, color: '#9b59b6' },
    { name: 'Schorle', price: 2.0, color: '#27ae60' },
    { name: 'Pfand+', price: 2.0, color: '#95a5a6' },
    { name: 'Pfand-', price: -2.0, color: '#95a5a6' },
    { name: 'Grillwurst', price: 3.5, color: '#e67e22' },
    { name: 'Bratwurst', price: 3.0, color: '#d35400' },
    { name: 'Pommes', price: 3.0, color: '#f1c40f' },
    { name: 'Steak', price: 6.0, color: '#795548' },
    { name: 'Kaffee', price: 2.0, color: '#4e342e' },
    { name: 'Kuchen', price: 2.5, color: '#d7ccc8' },
    { name: 'Torte', price: 3.0, color: '#f48fb1' },
  ];

  function init(): void {
    editor = ItemEditor.bind({
      getItems: () => pendingItems,
      setItems: (items) => {
        pendingItems = items;
      },
    });
    editor.render();
    bindEvents();
    updateStartButton();
    if (applyConfigFromHash()) return;
    showScreen('start');
    void handleConnectCallback();
  }

  // ─── Screens ────────────────────────────────────────────────────────────────
  function showScreen(screen: 'start' | 'setup'): void {
    const start = document.getElementById('start-screen');
    const setup = document.getElementById('setup-screen');
    if (start) start.hidden = screen !== 'start';
    if (setup) setup.hidden = screen !== 'setup';
    globalThis.scrollTo(0, 0);
  }

  function showSetup(notice: string): void {
    UI.setText('config-notice', notice);
    showScreen('setup');
  }

  // A share link or "use as template" opens this page with `#cfg=…`.
  function applyConfigFromHash(): boolean {
    const config = EventConfigs.fromHash(location.hash);
    if (config === undefined) return false;
    history.replaceState(null, '', location.pathname + location.search);
    if (config === null) {
      showScreen('start');
      UI.setText('import-error', 'Der Link enthält keine gültige Konfiguration.');
      return true;
    }
    applyConfig(config);
    showSetup('Name und Artikel wurden übernommen. Bitte prüfen und die Kasse öffnen.');
    return true;
  }

  function applyConfig(config: EventConfig): void {
    const nameInput = document.getElementById('event-name') as HTMLInputElement;
    if (nameInput) nameInput.value = config.name;
    replaceItems(EventConfigs.toItems(config));
  }

  function replaceItems(items: Item[]): void {
    pendingItems = items;
    if (editor) editor.stopEditing();
  }

  function updateStartButton(): void {
    const btn = document.getElementById('btn-start-event') as HTMLButtonElement;
    const checkbox = document.getElementById('accept-liability') as HTMLInputElement;
    if (btn) btn.disabled = !checkbox?.checked;
  }

  function bindEvents(): void {
    UI.on('accept-liability', 'change', updateStartButton);
    UI.on('btn-restart', 'click', () => showScreen('start'));

    UI.on('start-manual', 'click', () => {
      showSetup('');
      (document.getElementById('event-name') as HTMLInputElement | null)?.focus();
    });

    UI.on('start-example', 'click', () => {
      const nameInput = document.getElementById('event-name') as HTMLInputElement;
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = 'Vereinsfest';
      }
      replaceItems(EXAMPLE_ITEMS.map((cfg) => Models.createItem(cfg.name, cfg.price, cfg.color)));
      showSetup('Beispiel geladen – passe es an euer Fest an.');
    });

    UI.on('start-template', 'click', () => {
      (document.getElementById('import-file') as HTMLInputElement | null)?.click();
    });

    const fileInput = document.getElementById('import-file') as HTMLInputElement;
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        void importFile(file).finally(() => {
          fileInput.value = '';
        });
      });
    }

    bindPhotoImport();
    bindAppImport();
    UI.on('btn-price-list-apply', 'click', applyPriceList);

    UI.on('btn-start-event', 'click', () => {
      const nameInput = document.getElementById('event-name') as HTMLInputElement;
      const name = nameInput ? nameInput.value.trim() : '';
      const checkbox = document.getElementById('accept-liability') as HTMLInputElement;
      if (!name) {
        alert('Bitte Veranstaltungsname eingeben.');
        return;
      }
      if (pendingItems.length === 0) {
        alert('Bitte mindestens einen Artikel hinzufügen.');
        return;
      }
      if (!checkbox?.checked) {
        alert('Bitte den Haftungsausschluss akzeptieren.');
        return;
      }
      const currentState = Storage.loadState();
      const event = Models.createEvent(name);
      event.items = pendingItems.slice();
      Storage.addEvent(currentState, event);
      void Storage.requestPersistence().finally(() => {
        location.href = document.baseURI;
      });
    });
  }

  // ─── Price list text ────────────────────────────────────────────────────────
  // Appends the parsed items, so a long list can be pasted in parts.
  function applyPriceList(): void {
    const textarea = document.getElementById('price-list-text') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const count = applyText(textarea.value);
    UI.setText('price-list-result', `${count} Artikel übernommen.`);
  }

  // Adds the recognised items; unclear lines stay in the text field with the reason.
  function applyText(text: string): number {
    const result = PriceList.parse(text);
    if (result.items.length > 0) {
      replaceItems([...pendingItems, ...EventConfigs.toItems({ name: '', items: result.items })]);
    }
    const textarea = document.getElementById('price-list-text') as HTMLTextAreaElement | null;
    if (textarea) textarea.value = result.rejected.map((r) => r.text).join('\n');
    renderRejected(result.rejected);
    const details = document.getElementById('price-list') as HTMLDetailsElement | null;
    if (details && result.rejected.length > 0) details.open = true;
    return result.items.length;
  }

  function renderRejected(rejected: RejectedLine[]): void {
    const box = document.getElementById('price-list-rejected');
    const list = document.getElementById('price-list-rejected-lines');
    if (!box || !list) return;
    list.replaceChildren(
      ...rejected.map((r) => {
        const li = document.createElement('li');
        li.textContent = `Zeile ${r.line}: „${r.text}" (${r.reason})`;
        return li;
      }),
    );
    box.hidden = rejected.length === 0;
  }

  function applyRecognised(text: string, source: string): void {
    const count = applyText(text);
    showSetup(`${count} Artikel ${source} übernommen. Bitte Namen und Preise prüfen.`);
  }

  // ─── Photo via OpenRouter ───────────────────────────────────────────────────
  function renderConnection(): void {
    const connected = Vision.isConnected();
    const connect = document.getElementById('photo-connect');
    const ready = document.getElementById('photo-ready');
    if (connect) connect.hidden = connected;
    if (ready) ready.hidden = !connected;
  }

  function openPhotoPanel(): void {
    const panel = document.getElementById('photo-panel');
    if (panel) panel.hidden = false;
    renderConnection();
  }

  function bindPhotoImport(): void {
    UI.on('start-photo', 'click', () => {
      openPhotoPanel();
      if (Vision.isConnected()) {
        (document.getElementById('photo-file') as HTMLInputElement | null)?.click();
      } else {
        document.getElementById('photo-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    UI.on('btn-connect', 'click', () => {
      void connect();
    });

    UI.on('btn-photo', 'click', () => {
      (document.getElementById('photo-file') as HTMLInputElement | null)?.click();
    });
    UI.on('btn-photo-pick', 'click', () => {
      (document.getElementById('photo-pick') as HTMLInputElement | null)?.click();
    });
    // `photo-file` opens the camera (capture), `photo-pick` the gallery.
    for (const id of ['photo-file', 'photo-pick']) {
      const fileInput = document.getElementById(id) as HTMLInputElement | null;
      fileInput?.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        void readPhoto(file).finally(() => {
          fileInput.value = '';
        });
      });
    }
  }

  async function connect(): Promise<void> {
    UI.setText('photo-error', '');
    try {
      location.assign(await Vision.startConnect(location.origin + location.pathname));
    } catch (e) {
      UI.setText('photo-error', e instanceof VisionError ? e.message : 'Verbinden ist fehlgeschlagen.');
    }
  }

  // OpenRouter redirects back to this page with `?code=…&state=…`.
  async function handleConnectCallback(): Promise<void> {
    const search = location.search;
    if (!new URLSearchParams(search).has('code')) return;
    history.replaceState(null, '', location.pathname);
    openPhotoPanel();
    try {
      await Vision.completeConnect(search);
      renderConnection();
      UI.setText('photo-connected', 'Verbunden. Du kannst jetzt Fotos auslesen lassen.');
    } catch (e) {
      UI.setText('photo-error', e instanceof VisionError ? e.message : 'Verbinden ist fehlgeschlagen.');
    }
  }

  async function readPhoto(file: File): Promise<void> {
    const buttons = ['btn-photo', 'btn-photo-pick']
      .map((id) => document.getElementById(id) as HTMLButtonElement | null)
      .filter((b): b is HTMLButtonElement => b !== null);
    const prompt = document.getElementById('price-list-prompt') as HTMLTextAreaElement | null;
    if (!prompt) return;
    UI.setText('photo-error', '');
    UI.setText('photo-status', 'Foto wird ausgelesen … das dauert ein paar Sekunden.');
    for (const b of buttons) b.disabled = true;
    try {
      const text = await Vision.readPriceList(file, prompt.value);
      UI.setText('photo-status', '');
      applyRecognised(text, 'vom Foto');
    } catch (e) {
      UI.setText('photo-status', '');
      UI.setText('photo-error', e instanceof VisionError ? e.message : 'Das Foto konnte nicht ausgelesen werden.');
      if (e instanceof VisionError && !Vision.isConnected()) renderConnection();
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  }

  // ─── Without account: a KI app on the phone ─────────────────────────────────
  function bindAppImport(): void {
    UI.on('btn-no-account', 'click', () => {
      const box = document.getElementById('ki-app');
      if (box) box.hidden = false;
      const share = document.getElementById('btn-share-photo');
      if (share) share.hidden = !canShareImages();
      box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    UI.on('btn-copy-prompt', 'click', () => {
      void copyPrompt();
    });
    UI.on('btn-share-photo', 'click', () => {
      (document.getElementById('share-file') as HTMLInputElement | null)?.click();
    });
    const shareInput = document.getElementById('share-file') as HTMLInputElement | null;
    shareInput?.addEventListener('change', () => {
      const file = shareInput.files?.[0];
      if (!file) return;
      void sharePhoto(file).finally(() => {
        shareInput.value = '';
      });
    });
    UI.on('btn-ki-apply', 'click', () => {
      const answer = document.getElementById('ki-answer') as HTMLTextAreaElement | null;
      if (!answer?.value.trim()) {
        UI.setText('prompt-status', 'Bitte zuerst die Antwort der KI-App einfügen.');
        return;
      }
      applyRecognised(answer.value, 'aus der KI-App');
      answer.value = '';
    });
  }

  function canShareImages(): boolean {
    if (typeof navigator.canShare !== 'function') return false;
    const probe = new File([new Uint8Array(1)], 'preisliste.jpg', { type: 'image/jpeg' });
    return navigator.canShare({ files: [probe] });
  }

  // Some apps drop the text of a share, so the prompt is copied as well.
  async function sharePhoto(file: File): Promise<void> {
    const prompt = document.getElementById('price-list-prompt') as HTMLTextAreaElement | null;
    if (!prompt) return;
    await copyPrompt();
    try {
      await navigator.share({ files: [file], text: prompt.value });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      UI.setText('prompt-status', 'Teilen hat nicht geklappt. Bitte das Foto in der KI-App selbst anhängen.');
    }
  }

  async function copyPrompt(): Promise<void> {
    const prompt = document.getElementById('price-list-prompt') as HTMLTextAreaElement | null;
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.value);
      UI.setText('prompt-status', 'Auftrag kopiert.');
    } catch {
      prompt.select();
      UI.setText('prompt-status', 'Bitte den markierten Text kopieren.');
    }
  }

  // ─── Template file ──────────────────────────────────────────────────────────
  async function importFile(file: File): Promise<void> {
    let config: EventConfig | null = null;
    try {
      config = EventConfigs.parse(JSON.parse(await file.text()));
    } catch {
      config = null;
    }
    if (!config) {
      UI.setText('import-error', 'Fehler beim Importieren: Ungültiges JSON-Format.');
      return;
    }
    UI.setText('import-error', '');
    applyConfig(config);
    showSetup('Einrichtung übernommen. Bitte prüfen und die Kasse öffnen.');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  CreateApp.init();
});
