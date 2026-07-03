import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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

import { getRecipe, upsertLocal } from '@/lib/store';
import { syncNow } from '@/lib/sync';
import { colors } from '@/lib/theme';

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const editing = id !== undefined;

  const [name, setName] = useState('');
  const [ingredientsText, setIngredientsText] = useState('');
  const [loading, setLoading] = useState(editing);

  useEffect(() => {
    if (!editing) return;
    getRecipe(id)
      .then((r) => {
        if (r) {
          setName(r.name);
          setIngredientsText(r.ingredients.join('\n'));
        }
      })
      .finally(() => setLoading(false));
  }, [editing, id]);

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Missing name', 'Give the recipe a name.');
      return;
    }
    const ingredients = ingredientsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    // Saving is local and can't fail from network problems; the sync
    // kicked off here pushes to the server whenever it's reachable.
    await upsertLocal({ id: editing ? id : undefined, name: trimmedName, ingredients });
    syncNow();
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: editing ? 'Edit Recipe' : 'New Recipe' }} />
      {loading ? (
        <ActivityIndicator style={styles.loading} color={colors.accent} />
      ) : (
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Pancakes"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>Ingredients (one per line)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={ingredientsText}
            onChangeText={setIngredientsText}
            placeholder={'2 cups flour\n3 eggs\n1 cup milk'}
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
          />

          <Pressable style={styles.saveButton} onPress={save}>
            <Text style={styles.saveButtonText}>Save</Text>
          </Pressable>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { marginTop: 48 },
  form: { padding: 16, gap: 8 },
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
  multiline: { minHeight: 220 },
  saveButton: {
    marginTop: 16,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
});
