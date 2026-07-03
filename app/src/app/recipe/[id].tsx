import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
            <Pressable
              style={[styles.keepButton, (needed.length === 0 || sending) && styles.keepButtonDisabled]}
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
  list: { padding: 12, paddingBottom: 120 },
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
});
