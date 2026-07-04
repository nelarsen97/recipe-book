import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { addToKeep, ApiError } from '@/lib/api';
import { loadSettings } from '@/lib/settings';
import { getRecipe, Recipe, subscribe } from '@/lib/store';
import { colors } from '@/lib/theme';

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Ingredients the user already has (per-visit scratchpad, not persisted).
  const [have, setHave] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [serverEnabled, setServerEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readStore = useCallback(async () => {
    const r = await getRecipe(id);
    setRecipe(r);
    setLoaded(true);
    if (r) {
      setHave((prev) => {
        const next = new Set([...prev].filter((i) => i < r.ingredients.length));
        return next.size === prev.size ? prev : next;
      });
    }
  }, [id]);

  useEffect(() => {
    readStore();
    return subscribe(readStore);
  }, [readStore]);

  useFocusEffect(
    useCallback(() => {
      loadSettings().then((s) => setServerEnabled(s.serverEnabled));
    }, [])
  );

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );

  const toggle = (index: number) => {
    setHave((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const needed = recipe
    ? recipe.ingredients.filter((_, index) => !have.has(index))
    : [];

  const sendToKeep = async () => {
    if (needed.length === 0 || sending) return;
    setSending(true);
    try {
      const result = await addToKeep(needed);
      const parts = [`Added ${result.added} item${result.added === 1 ? '' : 's'}.`];
      if (result.skipped > 0) {
        parts.push(
          `Skipped ${result.skipped} already on the list: ${result.skipped_items.join(', ')}.`
        );
      }
      Alert.alert('Sent to Google Keep', parts.join('\n'));
    } catch (e) {
      Alert.alert('Could not add to Keep', e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  // One ingredient per line: pasting into a Google Keep checklist turns
  // each line into its own bullet.
  const copyToClipboard = async () => {
    if (needed.length === 0) return;
    try {
      await Clipboard.setStringAsync(needed.join('\n'));
    } catch (e) {
      Alert.alert('Could not copy', String(e));
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2500);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: recipe?.name ?? 'Recipe',
          headerRight: () =>
            recipe ? (
              <Pressable
                hitSlop={12}
                onPress={() => router.push({ pathname: '/edit', params: { id: recipe.id } })}
              >
                <Text style={styles.editLink}>Edit</Text>
              </Pressable>
            ) : null,
        }}
      />

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !recipe ? (
        <View style={styles.center}>
          <Text style={styles.muted}>This recipe is gone — it may have been deleted.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>Check off what you already have:</Text>
          <FlatList
            data={recipe.ingredients}
            keyExtractor={(_, index) => String(index)}
            contentContainerStyle={styles.list}
            renderItem={({ item, index }) => {
              const checked = have.has(index);
              return (
                <Pressable style={styles.row} onPress={() => toggle(index)}>
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.ingredient, checked && styles.ingredientChecked]}>
                    {item}
                  </Text>
                </Pressable>
              );
            }}
          />
          <View style={styles.footer}>
            {serverEnabled && (
              <Pressable
                style={[
                  styles.keepButton,
                  (needed.length === 0 || sending) && styles.keepButtonDisabled,
                ]}
                disabled={needed.length === 0 || sending}
                onPress={sendToKeep}
              >
                {sending ? (
                  <ActivityIndicator color={colors.accentText} />
                ) : (
                  <Text style={styles.keepButtonText}>
                    {needed.length === 0
                      ? 'Nothing to add — you have it all!'
                      : `Add ${needed.length} to Google Keep`}
                  </Text>
                )}
              </Pressable>
            )}
            <Pressable
              style={[
                styles.copyButton,
                !serverEnabled && styles.copyButtonPrimary,
                needed.length === 0 && styles.keepButtonDisabled,
              ]}
              disabled={needed.length === 0}
              onPress={copyToClipboard}
            >
              <Text
                style={[
                  styles.copyButtonText,
                  !serverEnabled && styles.copyButtonTextPrimary,
                  needed.length === 0 && styles.copyButtonTextDisabled,
                ]}
              >
                {copied
                  ? 'Copied! Paste into Google Keep.'
                  : needed.length === 0
                    ? serverEnabled
                      ? 'Copy to clipboard'
                      : 'Nothing to copy — you have it all!'
                    : `Copy ${needed.length} to clipboard`}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  muted: { color: colors.muted, textAlign: 'center', lineHeight: 22 },
  hint: { paddingHorizontal: 20, paddingTop: 12, color: colors.muted, fontSize: 13 },
  list: { padding: 12, paddingBottom: 180 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.success, borderColor: colors.success },
  checkmark: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 18 },
  ingredient: { fontSize: 16, color: colors.text, flex: 1 },
  ingredientChecked: { color: colors.muted, textDecorationLine: 'line-through' },
  editLink: { color: colors.accent, fontWeight: '600', fontSize: 16 },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    gap: 10,
  },
  keepButton: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 4,
  },
  keepButtonDisabled: { backgroundColor: colors.muted },
  keepButtonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  copyButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 4,
  },
  copyButtonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  copyButtonText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  copyButtonTextPrimary: { color: colors.accentText, fontWeight: '700' },
  copyButtonTextDisabled: { color: colors.accentText },
});
