import { UI } from '../shared/index';

// ─── Feedback Page ────────────────────────────────────────────────────────────
// Guided questions, sent to the shared feedback endpoint of Tiliavir/public-feedback
// (docs/feedback.md), which files them as a GitHub issue. Answers stay in the form
// when sending fails.
const FeedbackApp = (() => {
  const startedAt = Date.now();

  function init(): void {
    UI.on('btn-back-settings', 'click', () => {
      sessionStorage.setItem('vt-direction', 'back');
      const href = (document.getElementById('btn-back-settings') as HTMLElement).dataset.href;
      if (href) location.href = href;
    });
    const form = document.getElementById('feedback-form') as HTMLFormElement | null;
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      void send(form);
    });
  }

  function hasAnswer(data: FormData): boolean {
    for (const [name, value] of data.entries()) {
      if (name.startsWith('answers[') && typeof value === 'string' && value.trim() !== '') return true;
    }
    return false;
  }

  function isInstalled(): boolean {
    const nav = navigator as Navigator & { standalone?: boolean };
    return globalThis.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
  }

  function isMobile(): boolean {
    return /Android|iPhone|iPad|iPod|Mobile/.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
  }

  async function send(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    if (!hasAnswer(data)) {
      UI.setText('feedback-error', 'Bitte beantworte mindestens eine Frage.');
      return;
    }
    data.set('meta[version]', form.dataset.version ?? '');
    data.set('meta[installiert]', isInstalled() ? 'ja' : 'nein');
    data.set('meta[geraet]', isMobile() ? 'mobil' : 'desktop');
    data.set('started', String(startedAt));

    const button = document.getElementById('btn-feedback-send') as HTMLButtonElement | null;
    if (button) button.disabled = true;
    UI.setText('feedback-error', '');
    try {
      const response = await fetch(form.dataset.endpoint ?? '', {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
      });
      if (response.status === 429) {
        UI.setText('feedback-error', 'Gerade kamen sehr viele Rückmeldungen. Bitte versuch es später nochmal.');
        return;
      }
      if (!response.ok) {
        UI.setText('feedback-error', 'Senden hat nicht geklappt. Bitte versuch es später nochmal.');
        return;
      }
      form.hidden = true;
      const thanks = document.getElementById('feedback-thanks');
      if (thanks) thanks.hidden = false;
      globalThis.scrollTo(0, 0);
    } catch {
      UI.setText(
        'feedback-error',
        navigator.onLine
          ? 'Senden hat nicht geklappt. Bitte versuch es später nochmal.'
          : 'Keine Internetverbindung. Deine Antworten bleiben stehen – sende sie, sobald du wieder online bist.',
      );
    } finally {
      if (button) button.disabled = false;
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  FeedbackApp.init();
});
