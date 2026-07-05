import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { keepConfigured, loadKeepSettings, saveKeepSettings } from '@/lib/keep/settings';

beforeEach(async () => {
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync('recipe-book.keep-master-token');
});

it('defaults to disabled and empty', async () => {
  expect(await loadKeepSettings()).toEqual({
    enabled: false,
    email: '',
    masterToken: '',
    noteId: '',
  });
});

it('round-trips settings, trimming the text fields', async () => {
  await saveKeepSettings({
    enabled: true,
    email: ' me@gmail.com ',
    masterToken: ' aas_et/tok ',
    noteId: ' abc123 ',
  });

  expect(await loadKeepSettings()).toEqual({
    enabled: true,
    email: 'me@gmail.com',
    masterToken: 'aas_et/tok',
    noteId: 'abc123',
  });
});

it('keeps the master token out of AsyncStorage (it lives in the keystore)', async () => {
  await saveKeepSettings({
    enabled: true,
    email: 'me@gmail.com',
    masterToken: 'aas_et/secret',
    noteId: 'abc',
  });

  const stored = await AsyncStorage.getItem('recipe-book/keep-settings');
  expect(stored).not.toContain('aas_et/secret');
  expect(await SecureStore.getItemAsync('recipe-book.keep-master-token')).toBe('aas_et/secret');
});

it('deletes the stored token when cleared', async () => {
  await saveKeepSettings({ enabled: true, email: 'e', masterToken: 'tok', noteId: 'n' });
  await saveKeepSettings({ enabled: true, email: 'e', masterToken: '', noteId: 'n' });

  expect(await SecureStore.getItemAsync('recipe-book.keep-master-token')).toBeNull();
  expect((await loadKeepSettings()).masterToken).toBe('');
});

it('survives corrupted stored JSON', async () => {
  await AsyncStorage.setItem('recipe-book/keep-settings', '{nope');
  expect((await loadKeepSettings()).enabled).toBe(false);
});

it('keepConfigured requires email, token and note id', () => {
  const base = { enabled: true, email: 'e', masterToken: 't', noteId: 'n' };
  expect(keepConfigured(base)).toBe(true);
  expect(keepConfigured({ ...base, email: '' })).toBe(false);
  expect(keepConfigured({ ...base, masterToken: '' })).toBe(false);
  expect(keepConfigured({ ...base, noteId: '' })).toBe(false);
});
