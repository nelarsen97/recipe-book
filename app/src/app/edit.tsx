import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';

import { getRecipe, upsertLocal } from '@/lib/store';
import { syncNow } from '@/lib/sync';
import { colors } from '@/lib/theme';

type Selection = { start: number; end: number };
type KeyPressEvent = NativeSyntheticEvent<TextInputKeyPressEventData>;

/**
 * On web the event target is the DOM input, whose live selection is more
 * trustworthy than onSelectionChange (react-native-web only updates that
 * from `select` events, which caret-only moves don't always fire).
 */
function liveSelection(e: KeyPressEvent): Selection | null {
  const target = e.target as unknown as {
    selectionStart?: number | null;
    selectionEnd?: number | null;
  };
  if (typeof target?.selectionStart === 'number' && typeof target?.selectionEnd === 'number') {
    return { start: target.selectionStart, end: target.selectionEnd };
  }
  return null;
}

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const editing = id !== undefined;

  const [name, setName] = useState('');
  // One entry per row; a recipe always shows at least one ingredient row.
  const [ingredients, setIngredients] = useState<string[]>(['']);
  const [steps, setSteps] = useState<string[]>(['']);
  const [loading, setLoading] = useState(editing);

  const scrollRef = useRef<ScrollView>(null);
  const ingredientRefs = useRef<(TextInput | null)[]>([]);
  const stepRefs = useRef<(TextInput | null)[]>([]);
  // Where the cursor sits in each ingredient row, so Backspace knows
  // whether it was pressed at the very start of the text.
  const ingredientSelections = useRef<Record<number, Selection>>({});
  // Row to focus once it exists — inputs inserted by a state update can't
  // be focused until after the re-render.
  const pendingFocus = useRef<{
    list: 'ingredient' | 'step';
    index: number;
    scrollToEnd?: boolean;
  } | null>(null);
  // Transient controlled selection: places the caret at the merge point
  // after two ingredient rows join, then goes back to uncontrolled.
  const [selectionOverride, setSelectionOverride] = useState<{
    index: number;
    selection: Selection;
  } | null>(null);

  useEffect(() => {
    if (!editing) return;
    getRecipe(id)
      .then((r) => {
        if (r) {
          setName(r.name);
          setIngredients(r.ingredients.length ? [...r.ingredients] : ['']);
          setSteps(r.steps.length ? [...r.steps] : ['']);
        }
      })
      .finally(() => setLoading(false));
  }, [editing, id]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const apply = () => {
      const refs = target.list === 'ingredient' ? ingredientRefs : stepRefs;
      refs.current[target.index]?.focus();
      if (target.scrollToEnd) scrollRef.current?.scrollToEnd({ animated: true });
    };
    // On web, wait out the in-flight key event: this effect runs before the
    // browser applies Backspace's default deletion, and refocusing sooner
    // would let that deletion land on the newly focused input.
    if (Platform.OS === 'web') setTimeout(apply, 0);
    else apply();
  }, [ingredients, steps]);

  const setIngredient = (index: number, text: string) => {
    setIngredients((prev) => prev.map((v, i) => (i === index ? text : v)));
    if (selectionOverride) setSelectionOverride(null);
  };

  const insertIngredientAfter = (index: number) => {
    setIngredients((prev) => [...prev.slice(0, index + 1), '', ...prev.slice(index + 1)]);
    pendingFocus.current = { list: 'ingredient', index: index + 1 };
  };

  const mergeIngredientIntoPrevious = (index: number) => {
    if (index === 0) return;
    const caret = ingredients[index - 1].length;
    const next = [...ingredients];
    next[index - 1] += next[index];
    next.splice(index, 1);
    setIngredients(next);
    setSelectionOverride({ index: index - 1, selection: { start: caret, end: caret } });
    pendingFocus.current = { list: 'ingredient', index: index - 1 };
  };

  const onIngredientBackspace = (index: number, e: KeyPressEvent) => {
    if (index === 0) return;
    const sel = liveSelection(e) ?? ingredientSelections.current[index];
    const atStart =
      ingredients[index] === '' || (sel !== undefined && sel.start === 0 && sel.end === 0);
    if (!atStart) return;
    // Without this the browser applies the deletion to whichever input
    // holds focus after the rows re-render, eating its last character.
    // (Optional call: events fired from tests have no preventDefault.)
    e.preventDefault?.();
    mergeIngredientIntoPrevious(index);
  };

  const setStep = (index: number, text: string) => {
    setSteps((prev) => prev.map((v, i) => (i === index ? text : v)));
  };

  const addStep = () => {
    pendingFocus.current = { list: 'step', index: steps.length, scrollToEnd: true };
    setSteps((prev) => [...prev, '']);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    pendingFocus.current =
      index > 0
        ? { list: 'step', index: index - 1 }
        : { list: 'ingredient', index: ingredients.length - 1 };
  };

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Missing name', 'Give the recipe a name.');
      return;
    }

    // Saving is local and can't fail from network problems; the sync
    // kicked off here pushes to the server whenever it's reachable.
    await upsertLocal({
      id: editing ? id : undefined,
      name: trimmedName,
      ingredients: ingredients.map((line) => line.trim()).filter(Boolean),
      steps: steps.map((step) => step.trim()).filter(Boolean),
    });
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
        <>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Pancakes"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.label}>Ingredients</Text>
            {ingredients.map((ingredient, i) => (
              <TextInput
                key={i}
                ref={(el) => {
                  ingredientRefs.current[i] = el;
                }}
                style={[styles.input, styles.ingredientInput]}
                value={ingredient}
                onChangeText={(t) => setIngredient(i, t)}
                selection={selectionOverride?.index === i ? selectionOverride.selection : undefined}
                onSelectionChange={({ nativeEvent: { selection } }) => {
                  ingredientSelections.current[i] = selection;
                  if (
                    selectionOverride?.index === i &&
                    (selection.start !== selectionOverride.selection.start ||
                      selection.end !== selectionOverride.selection.end)
                  ) {
                    setSelectionOverride(null);
                  }
                }}
                onKeyPress={(e) => {
                  if (e.nativeEvent.key === 'Backspace') onIngredientBackspace(i, e);
                }}
                returnKeyType="next"
                // submitBehavior is the native prop; react-native-web still
                // reads blurOnSubmit, so set both to keep the keyboard up.
                submitBehavior="submit"
                blurOnSubmit={false}
                onSubmitEditing={() => insertIngredientAfter(i)}
                placeholder={i === 0 ? 'e.g. 2 cups flour' : undefined}
                placeholderTextColor={colors.muted}
                accessibilityLabel={`Ingredient ${i + 1}`}
              />
            ))}

            <Text style={styles.label}>Steps</Text>
            {steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <Text style={styles.stepNumber}>{i + 1}.</Text>
                <TextInput
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  style={[styles.input, styles.stepInput]}
                  value={step}
                  onChangeText={(t) => setStep(i, t)}
                  onKeyPress={(e) => {
                    if (e.nativeEvent.key === 'Backspace' && steps[i] === '') {
                      e.preventDefault?.();
                      removeStep(i);
                    }
                  }}
                  multiline
                  textAlignVertical="top"
                  placeholder={i === 0 ? 'e.g. Mix the dry ingredients' : undefined}
                  placeholderTextColor={colors.muted}
                  accessibilityLabel={`Step ${i + 1}`}
                />
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.addStepButton} onPress={addStep}>
              <Text style={styles.addStepButtonText}>Add step</Text>
            </Pressable>
            <Pressable style={styles.saveButton} onPress={save}>
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { marginTop: 48 },
  // Extra bottom padding keeps the last inputs clear of the fixed footer.
  form: { padding: 16, gap: 8, paddingBottom: 180 },
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
  ingredientInput: { paddingVertical: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNumber: {
    width: 24,
    paddingTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: colors.muted,
    textAlign: 'right',
  },
  stepInput: { flex: 1, minHeight: 64 },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    gap: 10,
  },
  addStepButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 4,
  },
  addStepButtonText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 4,
  },
  saveButtonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
});
