import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import Screen from '@/components/screen';
import { ChecklistSummary, fetchChecklists, KeepError } from '@/lib/keep/client';
import { loadKeepSettings, saveKeepSettings } from '@/lib/keep/settings';
import { loadSettings, normalizeServerUrl, saveSettings } from '@/lib/settings';
import { syncNow } from '@/lib/sync';
import { colors } from '@/lib/theme';

export default function SettingsScreen() {
  const [serverEnabled, setServerEnabled] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [keepEnabled, setKeepEnabled] = useState(false);
  const [keepEmail, setKeepEmail] = useState('');
  const [keepMasterToken, setKeepMasterToken] = useState('');
  const [keepNoteId, setKeepNoteId] = useState('');
  const [keepStatus, setKeepStatus] = useState<string | null>(null);
  const [findingLists, setFindingLists] = useState(false);
  const [checklists, setChecklists] = useState<ChecklistSummary[] | null>(null);

  useEffect(() => {
    Promise.all([loadSettings(), loadKeepSettings()]).then(([s, keep]) => {
      setServerEnabled(s.serverEnabled);
      setServerUrl(s.serverUrl);
      setApiKey(s.apiKey);
      setKeepEnabled(keep.enabled);
      setKeepEmail(keep.email);
      setKeepMasterToken(keep.masterToken);
      setKeepNoteId(keep.noteId);
      setLoaded(true);
    });
  }, []);

  const toggleServer = async (enabled: boolean) => {
    setServerEnabled(enabled);
    try {
      await saveSettings({ serverEnabled: enabled, serverUrl, apiKey });
      if (enabled) syncNow();
    } catch (e) {
      setServerEnabled(!enabled);
      Alert.alert('Could not save settings', String(e));
    }
  };

  const save = async () => {
    await saveSettings({ serverEnabled, serverUrl, apiKey });
    setServerUrl(normalizeServerUrl(serverUrl));
    setStatus('Saved.');
  };

  const testConnection = async () => {
    const base = normalizeServerUrl(serverUrl);
    if (!base) {
      setStatus('Enter a server address first.');
      return;
    }
    setTesting(true);
    setStatus(null);
    try {
      const response = await fetch(`${base}/recipes`, {
        headers: { 'X-API-Key': apiKey.trim() },
      });
      if (response.status === 401) {
        setStatus('Reached the server, but it rejected the API key.');
      } else if (!response.ok) {
        setStatus(`Server responded with HTTP ${response.status}.`);
      } else {
        const health = await (await fetch(`${base}/health`)).json();
        const keepError = health?.keep?.last_error;
        setStatus(
          keepError
            ? `Connected! But Keep reported a problem earlier: ${keepError}`
            : 'Connected! Server and API key look good.'
        );
      }
    } catch {
      setStatus('Could not reach the server. Check the address and your network.');
    } finally {
      setTesting(false);
    }
  };

  // Manual sync, replacing the home screen's pull-to-refresh.
  const runSync = async () => {
    setSyncing(true);
    setStatus(null);
    const result = await syncNow();
    setStatus(
      result.ok
        ? result.pending > 0
          ? `Synced, but ${result.pending} change${result.pending === 1 ? '' : 's'} could not be pushed.`
          : 'Synced.'
        : `Sync failed: ${result.error ?? 'unknown error'}`
    );
    setSyncing(false);
  };

  const keepSettings = () => ({
    enabled: keepEnabled,
    email: keepEmail,
    masterToken: keepMasterToken,
    noteId: keepNoteId,
  });

  const toggleKeep = async (enabled: boolean) => {
    setKeepEnabled(enabled);
    try {
      await saveKeepSettings({ ...keepSettings(), enabled });
    } catch (e) {
      setKeepEnabled(!enabled);
      Alert.alert('Could not save settings', String(e));
    }
  };

  const saveKeep = async () => {
    await saveKeepSettings(keepSettings());
    setKeepStatus('Saved.');
  };

  // Doubles as the connection test: it exercises the token exchange and
  // a full sync, and saves typing a 40-character note id by hand.
  const findChecklists = async () => {
    if (!keepEmail.trim() || !keepMasterToken.trim()) {
      setKeepStatus('Enter the Google account and master token first.');
      return;
    }
    setFindingLists(true);
    setKeepStatus(null);
    setChecklists(null);
    try {
      const lists = await fetchChecklists({
        email: keepEmail.trim(),
        masterToken: keepMasterToken.trim(),
      });
      setChecklists(lists);
      setKeepStatus(
        lists.length === 0
          ? 'Connected, but there are no checklists in this account. In the Keep app, ' +
              'create a note and choose "Show checkboxes".'
          : 'Connected! Tap your shopping list below.'
      );
    } catch (e) {
      setKeepStatus(e instanceof KeepError ? e.message : String(e));
    } finally {
      setFindingLists(false);
    }
  };

  const pickChecklist = async (list: ChecklistSummary) => {
    setKeepNoteId(list.id);
    try {
      await saveKeepSettings({ ...keepSettings(), noteId: list.id });
      setKeepStatus(`Saved "${list.title}" as the shopping list.`);
    } catch (e) {
      Alert.alert('Could not save settings', String(e));
    }
  };

  if (!loaded) return null;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabels}>
              <Text style={styles.toggleTitle}>Enable server connection</Text>
              <Text style={styles.toggleSubtitle}>
                When off, the app works entirely on this device — no syncing, and shopping lists
                are copied to the clipboard instead of sent to Google Keep.
              </Text>
            </View>
            <Switch
              testID="server-toggle"
              value={serverEnabled}
              onValueChange={toggleServer}
              trackColor={{ true: colors.accent }}
              thumbColor="#fff"
            />
          </View>

          {serverEnabled && (
            <>
              <Text style={styles.intro}>
                Point the app at your recipe-book server. Both values come from the server setup —
                see the project README.
              </Text>

              <Text style={styles.label}>Server address</Text>
              <TextInput
                style={styles.input}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="http://192.168.1.20:8000"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              <Text style={styles.label}>API key</Text>
              <TextInput
                style={styles.input}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="the API_KEY from the server's .env"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable
                style={[styles.button, styles.saveButton]}
                onPress={() => {
                  save().catch((e) => Alert.alert('Could not save settings', String(e)));
                }}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>

              <Pressable
                style={[styles.button, styles.testButton]}
                disabled={testing}
                onPress={testConnection}
              >
                {testing ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Text style={styles.testButtonText}>Test connection</Text>
                )}
              </Pressable>

              <Pressable
                style={[styles.button, styles.testButton]}
                disabled={syncing}
                onPress={runSync}
              >
                {syncing ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Text style={styles.testButtonText}>Sync now</Text>
                )}
              </Pressable>

              {status && <Text style={styles.status}>{status}</Text>}
            </>
          )}

          <View style={[styles.toggleRow, styles.sectionGap]}>
            <View style={styles.toggleLabels}>
              <Text style={styles.toggleTitle}>Send to Google Keep from this phone</Text>
              <Text style={styles.toggleSubtitle}>
                The app talks to Keep directly with a Google master token — no server needed
                for the Keep button. When on, this replaces the server&apos;s Keep forwarding.
              </Text>
            </View>
            <Switch
              testID="keep-toggle"
              value={keepEnabled}
              onValueChange={toggleKeep}
              trackColor={{ true: colors.accent }}
              thumbColor="#fff"
            />
          </View>

          {keepEnabled && (
            <>
              <Text style={styles.intro}>
                Run get_master_token.py from the project on any computer to get the master
                token, then fill these in. The token grants broad access to the Google
                account — it is stored in this device&apos;s secure keystore.
                {Platform.OS === 'web'
                  ? ' Note: browsers block direct Keep requests, so this only works in the Android app.'
                  : ''}
              </Text>

              <Text style={styles.label}>Google account email</Text>
              <TextInput
                style={styles.input}
                value={keepEmail}
                onChangeText={setKeepEmail}
                placeholder="you@gmail.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />

              <Text style={styles.label}>Master token</Text>
              <TextInput
                style={styles.input}
                value={keepMasterToken}
                onChangeText={setKeepMasterToken}
                placeholder="aas_et/..."
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />

              <Text style={styles.label}>Shopping-list note ID</Text>
              <TextInput
                style={styles.input}
                value={keepNoteId}
                onChangeText={setKeepNoteId}
                placeholder='tap "Find my checklists" below'
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable
                style={[styles.button, styles.saveButton]}
                onPress={() => {
                  saveKeep().catch((e) => Alert.alert('Could not save settings', String(e)));
                }}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>

              <Pressable
                style={[styles.button, styles.testButton]}
                disabled={findingLists}
                onPress={findChecklists}
              >
                {findingLists ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Text style={styles.testButtonText}>Find my checklists</Text>
                )}
              </Pressable>

              {keepStatus && <Text style={styles.status}>{keepStatus}</Text>}

              {checklists?.map((list) => {
                const selected = list.id === keepNoteId;
                return (
                  <Pressable
                    key={list.id}
                    style={[styles.checklistRow, selected && styles.checklistRowSelected]}
                    onPress={() => pickChecklist(list)}
                  >
                    <Text
                      style={[styles.checklistTitle, selected && styles.checklistTitleSelected]}
                      numberOfLines={1}
                    >
                      {selected ? '✓ ' : ''}
                      {list.title}
                    </Text>
                    <Text style={styles.checklistCount}>
                      {list.uncheckedCount} unchecked item{list.uncheckedCount === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: 16, gap: 8 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  toggleLabels: { flex: 1, gap: 4 },
  toggleTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  toggleSubtitle: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  intro: { color: colors.muted, lineHeight: 20, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 8 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveButton: { backgroundColor: colors.accent },
  saveButtonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  testButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  testButtonText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  status: { marginTop: 12, color: colors.text, lineHeight: 20 },
  sectionGap: { marginTop: 20 },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  checklistRowSelected: { borderColor: colors.accent, borderWidth: 2 },
  checklistTitle: { flex: 1, fontSize: 16, color: colors.text },
  checklistTitleSelected: { color: colors.accent, fontWeight: '700' },
  checklistCount: { fontSize: 13, color: colors.muted },
});
