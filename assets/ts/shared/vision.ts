// ─── Photo → price list via a vision model (opt-in) ──────────────────────────
// The user brings their own API key. It stays on this device (own localStorage key,
// not part of the app state) and is only sent to the chosen provider, with the photo.
type VisionProvider = 'anthropic' | 'openai';

interface VisionSettings {
  provider: VisionProvider | null;
  apiKey: string;
  model: string;
}

const SETTINGS_KEY = 'kassierer_vision_v1';
const MAX_IMAGE_SIDE = 1568;

const DEFAULT_MODELS: Record<VisionProvider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-6-luna',
};

function defaultSettings(): VisionSettings {
  return { provider: null, apiKey: '', model: '' };
}

function loadSettings(): VisionSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<VisionSettings> | null;
    if (!raw || (raw.provider !== 'anthropic' && raw.provider !== 'openai')) return defaultSettings();
    return {
      provider: raw.provider,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      model: typeof raw.model === 'string' ? raw.model : '',
    };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(settings: VisionSettings): void {
  try {
    if (settings.provider === null) {
      localStorage.removeItem(SETTINGS_KEY);
      return;
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save vision settings:', e);
  }
}

function isConfigured(settings: VisionSettings): boolean {
  return settings.provider !== null && settings.apiKey.trim() !== '';
}

function modelOf(settings: VisionSettings & { provider: VisionProvider }): string {
  return settings.model.trim() || DEFAULT_MODELS[settings.provider];
}

// ─── Image ────────────────────────────────────────────────────────────────────
interface EncodedImage {
  mediaType: 'image/jpeg';
  base64: string;
}

// Phone photos are large; scaled down they upload faster and cost fewer tokens.
async function encodeImage(file: Blob): Promise<EncodedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new VisionError('Das Foto konnte nicht verarbeitet werden.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

// ─── Providers ────────────────────────────────────────────────────────────────
class VisionError extends Error {}

interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  readText(response: unknown): string;
}

function anthropicRequest(apiKey: string, model: string, image: EncodedImage, prompt: string): ProviderRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: {
      model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    },
    readText(response) {
      const content = (response as { content?: { type: string; text?: string }[] }).content;
      if (!Array.isArray(content)) return '';
      return content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
    },
  };
}

function openaiRequest(apiKey: string, model: string, image: EncodedImage, prompt: string): ProviderRequest {
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } },
          ],
        },
      ],
    },
    readText(response) {
      const choices = (response as { choices?: { message?: { content?: unknown } }[] }).choices;
      const content = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
      return typeof content === 'string' ? content : '';
    },
  };
}

function errorMessage(status: number, body: unknown): string {
  if (status === 401 || status === 403) return 'Der API-Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen.';
  if (status === 429) return 'Zu viele Anfragen oder kein Guthaben beim Anbieter. Später erneut versuchen.';
  const detail = (body as { error?: { message?: unknown } } | null)?.error?.message;
  const suffix = typeof detail === 'string' ? `: ${detail}` : '';
  return `Fehler beim Anbieter (HTTP ${status})${suffix}.`;
}

// Returns the recognised price list as text (one item per line) for the user to review.
async function readPriceList(file: Blob, settings: VisionSettings, prompt: string): Promise<string> {
  if (settings.provider === null || !isConfigured(settings)) {
    throw new VisionError('Kein KI-Anbieter eingerichtet.');
  }
  if (!navigator.onLine) throw new VisionError('Keine Internetverbindung.');
  const image = await encodeImage(file);
  const model = modelOf({ ...settings, provider: settings.provider });
  const apiKey = settings.apiKey.trim();
  const request =
    settings.provider === 'anthropic'
      ? anthropicRequest(apiKey, model, image, prompt)
      : openaiRequest(apiKey, model, image, prompt);
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
  } catch {
    throw new VisionError('Der Anbieter ist nicht erreichbar.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new VisionError(errorMessage(response.status, body));
  const text = request.readText(body).trim();
  if (!text) throw new VisionError('Der Anbieter hat keinen Text erkannt.');
  return text;
}

export const Vision = {
  DEFAULT_MODELS,
  loadSettings,
  saveSettings,
  isConfigured,
  readPriceList,
};

export type { VisionProvider, VisionSettings };
export { VisionError };
