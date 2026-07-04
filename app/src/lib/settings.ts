import AsyncStorage from '@react-native-async-storage/async-storage';

export type Settings = {
  /** When false the app is fully local: no sync, no Keep integration. */
  serverEnabled: boolean;
  serverUrl: string;
  apiKey: string;
};

const KEY = 'recipe-book/settings';

export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

const DEFAULTS: Settings = { serverEnabled: false, serverUrl: '', apiKey: '' };

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw);
    return {
      serverEnabled: parsed.serverEnabled === true,
      serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({
      serverEnabled: settings.serverEnabled,
      serverUrl: normalizeServerUrl(settings.serverUrl),
      apiKey: settings.apiKey.trim(),
    })
  );
}
