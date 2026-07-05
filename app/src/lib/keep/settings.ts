/**
 * Settings for the direct (serverless) Google Keep path. Kept separate
 * from lib/settings.ts because the master token is a full Google
 * account credential: on Android/iOS it lives in the hardware-backed
 * keystore via expo-secure-store, never in AsyncStorage. The web build
 * has no secure store (and can't reach Keep anyway, see README), so it
 * falls back to AsyncStorage there.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type KeepSettings = {
  /** When true the app talks to Google Keep itself instead of the server. */
  enabled: boolean;
  email: string;
  masterToken: string;
  noteId: string;
};

const KEY = 'recipe-book/keep-settings';
// SecureStore keys may only contain [A-Za-z0-9._-].
const TOKEN_KEY = 'recipe-book.keep-master-token';

const DEFAULTS: KeepSettings = { enabled: false, email: '', masterToken: '', noteId: '' };

const secureStoreUsable = Platform.OS !== 'web';

async function loadMasterToken(): Promise<string> {
  if (secureStoreUsable) {
    return (await SecureStore.getItemAsync(TOKEN_KEY)) ?? '';
  }
  return (await AsyncStorage.getItem(TOKEN_KEY)) ?? '';
}

async function saveMasterToken(token: string): Promise<void> {
  if (secureStoreUsable) {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
    return;
  }
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function loadKeepSettings(): Promise<KeepSettings> {
  const raw = await AsyncStorage.getItem(KEY);
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // fall through to defaults
    }
  }
  return {
    enabled: parsed.enabled === true,
    email: typeof parsed.email === 'string' ? parsed.email : DEFAULTS.email,
    noteId: typeof parsed.noteId === 'string' ? parsed.noteId : DEFAULTS.noteId,
    masterToken: await loadMasterToken(),
  };
}

export async function saveKeepSettings(settings: KeepSettings): Promise<void> {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({
      enabled: settings.enabled,
      email: settings.email.trim(),
      noteId: settings.noteId.trim(),
    })
  );
  await saveMasterToken(settings.masterToken.trim());
}

/** True once every field the direct path needs is filled in. */
export function keepConfigured(settings: KeepSettings): boolean {
  return Boolean(settings.email && settings.masterToken && settings.noteId);
}
