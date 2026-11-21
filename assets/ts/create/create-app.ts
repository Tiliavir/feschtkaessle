import type { EventConfig, Item, RejectedLine } from '../shared/index';
import { EventConfigs, ItemEditor, Models, PriceList, Storage, UI } from '../shared/index';

// ─── Create Page ──────────────────────────────────────────────────────────────
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
    applyConfigFromHash();
  }

  // A share link or "use as template" opens this page with `#cfg=…`.
  function applyConfigFromHash(): void {
    const config = EventConfigs.fromHash(location.hash);
    if (config === undefined) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (config === null) {
      UI.setText('config-notice', '');
      UI.setText('import-error', 'Der Link enthält keine gültige Konfiguration.');
      return;
    }
    applyConfig(config);
    UI.setText('config-notice', 'Name und Artikel wurden übernommen. Bitte prüfen und die Veranstaltung starten.');
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

    UI.on('btn-example-config', 'click', () => {
      const nameInput = document.getElementById('event-name') as HTMLInputElement;
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = 'Vereinsfest';
      }
      replaceItems(EXAMPLE_ITEMS.map((cfg) => Models.createItem(cfg.name, cfg.price, cfg.color)));
    });

    UI.on('btn-import', 'click', () => {
      const fileInput = document.getElementById('import-file') as HTMLInputElement;
      if (fileInput) fileInput.click();
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

    UI.on('btn-price-list-apply', 'click', applyPriceList);
    UI.on('btn-copy-prompt', 'click', () => {
      void copyPrompt();
    });

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

  // Appends the parsed items, so a long list can be pasted in parts.
  function applyPriceList(): void {
    const textarea = document.getElementById('price-list-text') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const result = PriceList.parse(textarea.value);
    if (result.items.length > 0) {
      replaceItems([...pendingItems, ...EventConfigs.toItems({ name: '', items: result.items })]);
    }
    UI.setText('price-list-result', `${result.items.length} Artikel übernommen.`);
    renderRejected(result.rejected);
    textarea.value = result.rejected.map((r) => r.text).join('\n');
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

  async function importFile(file: File): Promise<void> {
    let config: EventConfig | null = null;
    try {
      config = EventConfigs.parse(JSON.parse(await file.text()));
    } catch {
      config = null;
    }
    if (!config) {
      UI.setText('config-notice', '');
      UI.setText('import-error', 'Fehler beim Importieren: Ungültiges JSON-Format.');
      return;
    }
    applyConfig(config);
    UI.setText('import-error', '');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  CreateApp.init();
});
