import AsyncStorage from '@react-native-async-storage/async-storage';

export type Settings = {
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

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return { serverUrl: '', apiKey: '' };
  try {
    const parsed = JSON.parse(raw);
    return {
      serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return { serverUrl: '', apiKey: '' };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({
      serverUrl: normalizeServerUrl(settings.serverUrl),
      apiKey: settings.apiKey.trim(),
    })
  );
}
