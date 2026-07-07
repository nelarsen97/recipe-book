/**
 * Provision mode — the recipe detail screen. Check off the ingredients you
 * already have; the rest gets "provisioned" (copied to the clipboard or
 * posted to Google Keep). Each ingredient's leading quantity is editable
 * here, but like the check-offs those overrides are per-visit scratch
 * state: they change what gets provisioned, never the stored recipe.
 * Changing the recipe itself happens in edit mode (edit.tsx, free text).
 */
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
  TextInput,
  View,
} from 'react-native';

import Screen from '@/components/screen';
import { addToKeep, ApiError } from '@/lib/api';
import { parseIngredient, provisionIngredient, sanitizeQty } from '@/lib/ingredients';
import { loadKeepSettings } from '@/lib/keep/settings';
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
  // Quantity overrides (index -> qty string), per-visit like `have`.
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);
  // Keep button shows when either path can deliver: the server proxy or
  // the on-device client (Settings > Google Keep).
  const [keepAvailable, setKeepAvailable] = useState(false);
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
      setOverrides((prev) => {
        const stale = Object.keys(prev).filter((k) => Number(k) >= r.ingredients.length);
        if (stale.length === 0) return prev;
        const next = { ...prev };
        for (const k of stale) delete next[Number(k)];
        return next;
      });
    }
  }, [id]);

  useEffect(() => {
    // readStore is async: its setState lands in a microtask, not synchronously
    // in the effect body, which is what the rule is guarding against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    readStore();
    return subscribe(readStore);
  }, [readStore]);

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadSettings(), loadKeepSettings()]).then(([server, keep]) =>
        setKeepAvailable(server.serverEnabled || keep.enabled)
      );
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

  const setOverride = (index: number, text: string) => {
    setOverrides((prev) => ({ ...prev, [index]: sanitizeQty(text) }));
  };

  // What actually gets provisioned: unchecked ingredients with any quantity
  // overrides spliced in.
  const provisioned = recipe
    ? recipe.ingredients.flatMap((item, index) =>
        have.has(index) ? [] : [provisionIngredient(item, overrides[index])]
      )
    : [];

  const sendToKeep = async () => {
    if (provisioned.length === 0 || sending) return;
    setSending(true);
    try {
      const result = await addToKeep(provisioned);
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

  // One ingredient per line. Keep for Android pastes multi-line text into a
  // checklist as a single checkbox, so the copied hint walks the user through
  // the flow that does split lines: hide checkboxes, paste, show checkboxes.
  const copyToClipboard = async () => {
    if (provisioned.length === 0) return;
    try {
      await Clipboard.setStringAsync(provisioned.join('\n'));
    } catch (e) {
      Alert.alert('Could not copy', String(e));
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    // Long enough to read the paste instructions below the button.
    copiedTimer.current = setTimeout(() => setCopied(false), 8000);
  };

  return (
    <Screen>
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
            style={styles.listFill}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            extraData={[have, overrides]}
            ListFooterComponent={
              recipe.steps.length > 0 ? (
                <View style={styles.stepsSection}>
                  <Text style={styles.stepsHeading}>Steps</Text>
                  {recipe.steps.map((step, index) => (
                    <View key={index} style={styles.stepRow}>
                      <Text style={styles.stepNumber}>{index + 1}.</Text>
                      <Text style={styles.stepText}>{step}</Text>
                    </View>
                  ))}
                </View>
              ) : null
            }
            renderItem={({ item, index }) => {
              const checked = have.has(index);
              const { qty, rest } = parseIngredient(item);
              return (
                <View style={styles.row}>
                  <Pressable hitSlop={10} onPress={() => toggle(index)}>
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                      {checked && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  </Pressable>
                  {qty !== null && !checked && (
                    <TextInput
                      style={styles.qtyInput}
                      // Not the plain numeric keyboard: it has no "/" key,
                      // and any quantity may be overridden with a fraction.
                      keyboardType="numbers-and-punctuation"
                      value={overrides[index] ?? qty}
                      onChangeText={(t) => setOverride(index, t)}
                      accessibilityLabel={`Quantity for ${rest.trim()}`}
                    />
                  )}
                  <Pressable style={styles.textTarget} onPress={() => toggle(index)}>
                    <Text style={[styles.ingredient, checked && styles.ingredientChecked]}>
                      {checked
                        ? provisionIngredient(item, overrides[index])
                        : qty !== null
                          ? rest.trimStart()
                          : item}
                    </Text>
                  </Pressable>
                </View>
              );
            }}
          />
          <View style={styles.footer}>
            <View style={styles.buttonRow}>
              {keepAvailable && (
                <Pressable
                  style={[
                    styles.keepButton,
                    (provisioned.length === 0 || sending) && styles.keepButtonDisabled,
                  ]}
                  disabled={provisioned.length === 0 || sending}
                  onPress={sendToKeep}
                >
                  {sending ? (
                    <ActivityIndicator color={colors.accentText} />
                  ) : (
                    <Text style={styles.keepButtonText}>Add to Keep</Text>
                  )}
                </Pressable>
              )}
              <Pressable
                style={[
                  styles.copyButton,
                  !keepAvailable && styles.copyButtonPrimary,
                  provisioned.length === 0 && styles.keepButtonDisabled,
                ]}
                disabled={provisioned.length === 0}
                onPress={copyToClipboard}
              >
                <Text
                  style={[
                    styles.copyButtonText,
                    !keepAvailable && styles.copyButtonTextPrimary,
                    provisioned.length === 0 && styles.copyButtonTextDisabled,
                  ]}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </Pressable>
            </View>
            {copied && (
              <Text style={styles.copyHint}>
                Keep pastes everything into one checkbox. On your Keep list, choose Hide
                checkboxes, paste, then Show checkboxes.
              </Text>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  muted: { color: colors.muted, textAlign: 'center', lineHeight: 22 },
  hint: { paddingHorizontal: 20, paddingTop: 12, color: colors.muted, fontSize: 13 },
  // The list fills the space above the docked footer bar (flex) and scrolls
  // within it, so the last step ends above the bar rather than under it.
  listFill: { flex: 1 },
  list: { padding: 12, paddingBottom: 12 },
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
  qtyInput: {
    minWidth: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.card,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 16,
    color: colors.text,
    textAlign: 'right',
  },
  textTarget: { flex: 1 },
  ingredient: { fontSize: 16, color: colors.text },
  ingredientChecked: { color: colors.muted, textDecorationLine: 'line-through' },
  editLink: { color: colors.accent, fontWeight: '600', fontSize: 16 },
  stepsSection: { marginTop: 20, paddingHorizontal: 10, gap: 10 },
  stepsHeading: { fontSize: 13, fontWeight: '600', color: colors.muted },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNumber: {
    width: 24,
    fontSize: 16,
    fontWeight: '600',
    color: colors.muted,
    textAlign: 'right',
  },
  stepText: { flex: 1, fontSize: 16, color: colors.text, lineHeight: 22 },
  // Docked action bar: its own box, separated from the scroll list by the
  // top border line.
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonRow: { flexDirection: 'row', gap: 10 },
  keepButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 4,
  },
  keepButtonDisabled: { backgroundColor: colors.muted },
  keepButtonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  copyButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 4,
  },
  copyButtonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  copyHint: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 8 },
  copyButtonText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  copyButtonTextPrimary: { color: colors.accentText, fontWeight: '700' },
  copyButtonTextDisabled: { color: colors.accentText },
});
