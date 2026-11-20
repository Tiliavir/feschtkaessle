import type { PersistenceStatus } from '../shared/index';
import { EventConfigs, Models, Storage, UI } from '../shared/index';

// ─── Settings Page ────────────────────────────────────────────────────────────
const SettingsApp = (() => {
  let state = Storage.loadState();

  function init(): void {
    state = Storage.loadState();
    renderActiveEvent();
    renderAllEvents();
    bindEvents();
    void Storage.getPersistenceStatus().then(renderPersistence);
  }

  function renderActiveEvent(): void {
    const active = Storage.getActiveEvent(state);
    const totals = active ? Models.calculateEventTotals(active) : { revenue: 0, transactionCount: 0 };
    UI.setText('settings-event-name', active ? active.name : '—');
    UI.setText('settings-revenue', UI.formatCurrency(totals.revenue));
    UI.setText('settings-tx-count', String(totals.transactionCount));
    const closeBtn = document.getElementById('btn-close-event') as HTMLButtonElement | null;
    if (closeBtn) closeBtn.disabled = !active;
  }

  function renderAllEvents(): void {
    const container = document.getElementById('all-events-list');
    if (!container) return;
    container.innerHTML = '';

    if (state.events.length === 0) {
      container.innerHTML = '<p class="empty-hint">Keine Veranstaltungen vorhanden.</p>';
      return;
    }

    const sorted = state.events.slice().sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    sorted.forEach((event) => {
      const totals = Models.calculateEventTotals(event);
      const isActive = event.id === state.activeEventId;
      const row = document.createElement('div');
      row.className = 'all-event-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'all-event-name';
      nameSpan.textContent = event.name;
      if (isActive) {
        const badge = document.createElement('span');
        badge.className = 'event-badge-active';
        badge.textContent = 'Aktiv';
        nameSpan.appendChild(badge);
      }

      const revenueSpan = document.createElement('span');
      revenueSpan.className = 'all-event-revenue';
      revenueSpan.textContent = UI.formatCurrency(totals.revenue);

      const dateSpan = document.createElement('span');
      dateSpan.className = 'all-event-date';
      dateSpan.textContent = UI.formatDate(event.createdAt);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'all-event-actions';

      const editLink = document.createElement('a');
      editLink.className = 'all-event-link';
      editLink.href = new URL(`edit/?id=${event.id}`, document.baseURI).href;
      editLink.textContent = 'Bearbeiten';

      const statsLink = document.createElement('a');
      statsLink.className = 'all-event-link';
      statsLink.href = new URL(`stats/?id=${event.id}`, document.baseURI).href;
      statsLink.textContent = 'Statistik';

      const templateLink = document.createElement('a');
      templateLink.className = 'all-event-link';
      templateLink.href = EventConfigs.createLink(EventConfigs.fromEvent(event), document.baseURI);
      templateLink.textContent = 'Als Vorlage';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'all-event-delete';
      deleteBtn.textContent = 'Löschen';
      deleteBtn.addEventListener(
        'click',
        (() => {
          const ev = event;
          return () => {
            if (!confirm(`Veranstaltung "${ev.name}" wirklich löschen?`)) return;
            state = Storage.deleteEvent(state, ev.id);
            renderActiveEvent();
            renderAllEvents();
          };
        })(),
      );

      actionsDiv.appendChild(editLink);
      actionsDiv.appendChild(statsLink);
      actionsDiv.appendChild(templateLink);
      actionsDiv.appendChild(deleteBtn);

      row.appendChild(nameSpan);
      row.appendChild(revenueSpan);
      row.appendChild(dateSpan);
      row.appendChild(actionsDiv);

      container.appendChild(row);
    });
  }

  const PERSISTENCE_TEXT: Record<PersistenceStatus, string> = {
    persisted: 'Dauerhaft gespeichert: Der Browser löscht die Daten nicht von sich aus.',
    'not-persisted': 'Nicht dauerhaft gespeichert: Bei Speichermangel darf der Browser die Daten löschen.',
    unsupported: 'Dieser Browser kann die Daten nicht dauerhaft sichern.',
  };

  function renderPersistence(status: PersistenceStatus): void {
    UI.setText('storage-status', PERSISTENCE_TEXT[status]);
    const btn = document.getElementById('btn-persist-storage');
    if (btn) btn.hidden = status !== 'not-persisted';
  }

  function bindEvents(): void {
    UI.on('btn-persist-storage', 'click', () => {
      void Storage.requestPersistence().then(renderPersistence);
    });

    UI.on('btn-back-cashier', 'click', () => {
      sessionStorage.setItem('vt-direction', 'back');
      location.href = document.baseURI;
    });

    UI.on('btn-close-event', 'click', () => {
      const active = Storage.getActiveEvent(state);
      if (!active) return;
      if (!confirm(`Veranstaltung "${active.name}" wirklich beenden?`)) return;
      state = Storage.closeEvent(state, active.id);
      renderActiveEvent();
      renderAllEvents();
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  SettingsApp.init();
});
