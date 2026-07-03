import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';

import { loadSettings, normalizeServerUrl, saveSettings } from '@/lib/settings';
import { colors } from '@/lib/theme';

export default function SettingsScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then((s) => {
      setServerUrl(s.serverUrl);
      setApiKey(s.apiKey);
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    await saveSettings({ serverUrl, apiKey });
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

  if (!loaded) return null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Point the app at your recipe-book server. Both values come from the server setup — see
          the project README.
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

        <Pressable style={[styles.button, styles.testButton]} disabled={testing} onPress={testConnection}>
          {testing ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.testButtonText}>Test connection</Text>
          )}
        </Pressable>

        {status && <Text style={styles.status}>{status}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: 16, gap: 8 },
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
});
