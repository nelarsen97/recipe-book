import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadSettings, normalizeServerUrl, saveSettings } from '@/lib/settings';

const STORAGE_KEY = 'recipe-book/settings';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('normalizeServerUrl', () => {
  it('returns empty string for empty or whitespace input', () => {
    expect(normalizeServerUrl('')).toBe('');
    expect(normalizeServerUrl('   ')).toBe('');
  });

  it('prepends http:// when no scheme is given', () => {
    expect(normalizeServerUrl('192.168.1.20:8000')).toBe('http://192.168.1.20:8000');
  });

  it('keeps an explicit scheme, including https', () => {
    expect(normalizeServerUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeServerUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
  });

  it('strips trailing slashes and surrounding whitespace', () => {
    expect(normalizeServerUrl(' http://example.com/// ')).toBe('http://example.com');
  });
});

describe('loadSettings', () => {
  it('defaults to server disabled with empty url/key when nothing is stored', async () => {
    expect(await loadSettings()).toEqual({ serverEnabled: false, serverUrl: '', apiKey: '' });
  });

  it('falls back to defaults when the stored value is corrupted', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'not json {');
    expect(await loadSettings()).toEqual({ serverEnabled: false, serverUrl: '', apiKey: '' });
  });

  it('treats a legacy record without serverEnabled as disabled but keeps url/key', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ serverUrl: 'http://old-server:8000', apiKey: 'legacy-key' })
    );
    expect(await loadSettings()).toEqual({
      serverEnabled: false,
      serverUrl: 'http://old-server:8000',
      apiKey: 'legacy-key',
    });
  });

  it('only accepts a strict boolean true for serverEnabled', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ serverEnabled: 'yes', serverUrl: '', apiKey: '' })
    );
    expect((await loadSettings()).serverEnabled).toBe(false);
  });

  it('ignores wrongly-typed url/key values', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ serverEnabled: true, serverUrl: 42, apiKey: null })
    );
    expect(await loadSettings()).toEqual({ serverEnabled: true, serverUrl: '', apiKey: '' });
  });
});

describe('saveSettings', () => {
  it('round-trips, normalizing the url and trimming the key', async () => {
    await saveSettings({ serverEnabled: true, serverUrl: 'example.com/', apiKey: '  key  ' });
    expect(await loadSettings()).toEqual({
      serverEnabled: true,
      serverUrl: 'http://example.com',
      apiKey: 'key',
    });
  });

  it('persists serverEnabled: false explicitly', async () => {
    await saveSettings({ serverEnabled: true, serverUrl: 'x', apiKey: 'k' });
    await saveSettings({ serverEnabled: false, serverUrl: 'x', apiKey: 'k' });
    expect((await loadSettings()).serverEnabled).toBe(false);
  });
});
