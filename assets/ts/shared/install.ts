// ─── Install as app ───────────────────────────────────────────────────────────
// Suggests installing the app: native dialog where the browser offers one
// (`beforeinstallprompt`), short instructions on iPhone/iPad and Firefox for
// Android, nothing elsewhere and never inside the installed app.
// Markup: `layouts/partials/install.html` (bar on the cashier, section in settings).

const INSTALL_KEY = 'feschtkaessle_install_v1';

type InstallMode = 'prompt' | 'ios' | 'firefox' | 'none';

interface InstallState {
  dismissed: boolean;
  installed: boolean;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const HOWTO: Record<'ios' | 'firefox', string> = {
  ios: 'Im Browser auf „Teilen" tippen, dann „Zum Home-Bildschirm".',
  firefox: 'Im Firefox-Menü (⋮) „Installieren" bzw. „Zum Startbildschirm hinzufügen" wählen.',
};

let deferredPrompt: InstallPromptEvent | null = null;

function loadInstallState(): InstallState {
  try {
    const parsed = JSON.parse(localStorage.getItem(INSTALL_KEY) || '{}') as Partial<InstallState>;
    return { dismissed: parsed.dismissed === true, installed: parsed.installed === true };
  } catch {
    return { dismissed: false, installed: false };
  }
}

function saveInstallState(change: Partial<InstallState>): void {
  try {
    localStorage.setItem(INSTALL_KEY, JSON.stringify({ ...loadInstallState(), ...change }));
  } catch {
    // Storage full or blocked: the hint simply shows again next time.
  }
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return globalThis.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function installMode(): InstallMode {
  if (deferredPrompt) return 'prompt';
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'ios';
  if (/Android/.test(ua) && /Firefox/.test(ua)) return 'firefox';
  return 'none';
}

function render(): void {
  const mode = isStandalone() ? 'none' : installMode();
  const state = loadInstallState();
  const bar = document.getElementById('install-bar');
  if (bar) bar.hidden = mode === 'none' || state.dismissed || state.installed;
  const section = document.getElementById('install-section');
  if (section) section.hidden = mode === 'none';
  const install = document.getElementById('btn-install');
  if (install) install.hidden = mode !== 'prompt';
  const howto = document.getElementById('btn-install-howto');
  if (howto) howto.hidden = mode === 'prompt' || mode === 'none';
  const text = document.getElementById('install-howto');
  if (text && (mode === 'ios' || mode === 'firefox')) text.textContent = HOWTO[mode];
  if (text && mode === 'prompt') text.hidden = true;
}

async function promptInstall(): Promise<void> {
  const event = deferredPrompt;
  if (!event) return;
  deferredPrompt = null;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') saveInstallState({ installed: true });
  render();
}

function bindInstall(): void {
  globalThis.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    render();
  });
  globalThis.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    saveInstallState({ installed: true });
    render();
  });
  document.getElementById('btn-install')?.addEventListener('click', () => {
    void promptInstall();
  });
  document.getElementById('btn-install-howto')?.addEventListener('click', () => {
    const text = document.getElementById('install-howto');
    if (text) text.hidden = !text.hidden;
  });
  document.getElementById('btn-install-dismiss')?.addEventListener('click', () => {
    saveInstallState({ dismissed: true });
    render();
  });
  render();
}

export const Install = {
  bind: bindInstall,
};
