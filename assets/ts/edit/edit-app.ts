import { EventConfigs, ItemEditor, Storage, UI } from '../shared/index';

// ─── Edit Page ────────────────────────────────────────────────────────────────
const EditApp = (() => {
  let state = Storage.loadState();
  let eventId: string | null = null;

  function init(): void {
    eventId = new URLSearchParams(location.search).get('id');
    state = Storage.loadState();
    const event = state.events.find((e) => e.id === eventId);

    if (!event) {
      const errEl = document.getElementById('edit-error');
      if (errEl) errEl.hidden = false;
      return;
    }

    const contentEl = document.getElementById('edit-content');
    if (contentEl) contentEl.hidden = false;

    const titleEl = document.getElementById('edit-event-name');
    if (titleEl) titleEl.textContent = event.name;

    ItemEditor.bind({
      getItems: () => {
        const current = currentEvent();
        return current ? current.items : [];
      },
      setItems: (items) => {
        if (eventId) state = Storage.setEventItems(state, eventId, items);
      },
    }).render();
    bindEvents();
  }

  function currentEvent() {
    return state.events.find((e) => e.id === eventId) || null;
  }

  function bindEvents(): void {
    UI.on('btn-back-settings', 'click', () => {
      sessionStorage.setItem('vt-direction', 'back');
      const href = (document.getElementById('btn-back-settings') as HTMLElement).dataset.href;
      if (href) location.href = href;
    });

    UI.on('btn-export', 'click', () => {
      const event = currentEvent();
      if (!event) return;
      const data = EventConfigs.fromEvent(event);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${event.name.replace(/[^a-z0-9äöüß]/gi, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    UI.on('btn-share-link', 'click', () => {
      const event = currentEvent();
      if (!event) return;
      void shareLink(event.name, EventConfigs.createLink(EventConfigs.fromEvent(event), document.baseURI));
    });
  }

  // Share sheet where available (Android), else clipboard, else a field to copy by hand.
  async function shareLink(name: string, link: string): Promise<void> {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: name, text: `Artikel für „${name}"`, url: link });
        UI.setText('share-status', '');
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      UI.setText('share-status', 'Link in die Zwischenablage kopiert.');
    } catch {
      showLinkField(link);
    }
  }

  function showLinkField(link: string): void {
    const input = document.getElementById('share-link') as HTMLInputElement | null;
    const label = document.getElementById('share-link-label');
    if (!input || !label) return;
    input.value = link;
    input.hidden = false;
    label.hidden = false;
    input.select();
    UI.setText('share-status', 'Link oben markieren und kopieren.');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  EditApp.init();
});
