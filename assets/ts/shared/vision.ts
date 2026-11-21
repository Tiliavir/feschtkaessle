// ─── Photo → price list via OpenRouter (opt-in) ──────────────────────────────
// The user connects their own OpenRouter account (OAuth PKCE, no app registration, no backend).
// The resulting key stays on this device (own localStorage key, not part of the app state)
// and is only sent to OpenRouter, together with the photo.
const SETTINGS_KEY = 'feschtkaessle_vision_v1';
const PENDING_KEY = 'feschtkaessle_vision_pending';
const AUTH_URL = 'https://openrouter.ai/auth';
const KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Routes to a free model that supports the features of the request (here: image input).
const MODEL = 'openrouter/free';
const MAX_IMAGE_SIDE = 1568;

class VisionError extends Error {}

// ─── Stored key ───────────────────────────────────────────────────────────────
// Up to 1.x the settings held a key for Anthropic, OpenAI or Gemini; those are dropped.
function loadKey(): string | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as {
      provider?: unknown;
      apiKey?: unknown;
    } | null;
    if (raw === null) return null;
    if (raw.provider === 'openrouter' && typeof raw.apiKey === 'string' && raw.apiKey.trim() !== '') {
      return raw.apiKey.trim();
    }
    localStorage.removeItem(SETTINGS_KEY);
    return null;
  } catch {
    return null;
  }
}

function saveKey(apiKey: string): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ provider: 'openrouter', apiKey }));
}

function disconnect(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch (e) {
    console.error('Failed to remove vision settings:', e);
  }
}

function isConnected(): boolean {
  return loadKey() !== null;
}

// ─── Connect (OAuth PKCE) ─────────────────────────────────────────────────────
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

// Returns the OpenRouter URL to send the user to; it redirects back to `callbackUrl?code=…&state=…`.
async function startConnect(callbackUrl: string): Promise<string> {
  if (!crypto.subtle) throw new VisionError('Verbinden geht nur über eine sichere Verbindung (https).');
  const verifier = randomToken();
  const state = randomToken();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    state,
    key_label: 'Feschtkässle',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function takePending(): { verifier: string; state: string } | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as {
      verifier?: unknown;
      state?: unknown;
    } | null;
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw || typeof raw.verifier !== 'string' || typeof raw.state !== 'string') return null;
    return { verifier: raw.verifier, state: raw.state };
  } catch {
    return null;
  }
}

// Handles the redirect back from OpenRouter. Returns false when the URL is no callback.
async function completeConnect(search: string): Promise<boolean> {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  if (code === null) return false;
  const pending = takePending();
  if (pending === null || params.get('state') !== pending.state) {
    throw new VisionError('Die Anmeldung bei OpenRouter konnte nicht zugeordnet werden. Bitte erneut verbinden.');
  }
  let response: Response;
  try {
    response = await fetch(KEYS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: pending.verifier, code_challenge_method: 'S256' }),
    });
  } catch {
    throw new VisionError('OpenRouter ist nicht erreichbar. Bitte erneut verbinden.');
  }
  const body = (await response.json().catch(() => null)) as { key?: unknown } | null;
  if (!response.ok || !body || typeof body.key !== 'string' || body.key === '') {
    throw new VisionError('Die Verbindung mit OpenRouter ist fehlgeschlagen. Bitte erneut verbinden.');
  }
  saveKey(body.key);
  return true;
}

// ─── Image ────────────────────────────────────────────────────────────────────
// Phone photos are large; scaled down they upload faster and cost fewer tokens.
async function encodeImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new VisionError('Das Foto konnte nicht verarbeitet werden.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ─── Read ─────────────────────────────────────────────────────────────────────
function errorMessage(status: number, body: unknown): string {
  if (status === 401 || status === 403) return 'Die Verbindung zu OpenRouter gilt nicht mehr. Bitte neu verbinden.';
  if (status === 402) return 'Das Guthaben bei OpenRouter ist aufgebraucht.';
  if (status === 429) return 'Tageslimit erreicht oder zu viele Anfragen. Später erneut versuchen.';
  const detail = (body as { error?: { message?: unknown } } | null)?.error?.message;
  const suffix = typeof detail === 'string' ? `: ${detail}` : '';
  return `Fehler bei OpenRouter (HTTP ${status})${suffix}.`;
}

function readText(body: unknown): string {
  const choices = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices;
  const content = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
  return typeof content === 'string' ? content : '';
}

// Returns the recognised price list as text (one item per line).
async function readPriceList(file: Blob, prompt: string): Promise<string> {
  const apiKey = loadKey();
  if (apiKey === null) throw new VisionError('Nicht mit OpenRouter verbunden.');
  if (!navigator.onLine) throw new VisionError('Keine Internetverbindung.');
  const image = await encodeImage(file);
  let response: Response;
  try {
    response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new VisionError('OpenRouter ist nicht erreichbar.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new VisionError(errorMessage(response.status, body));
  const text = readText(body).trim();
  if (!text) throw new VisionError('Auf dem Foto wurde kein Text erkannt.');
  return text;
}

export const Vision = {
  MODEL,
  isConnected,
  disconnect,
  startConnect,
  completeConnect,
  readPriceList,
};

export { VisionError };
