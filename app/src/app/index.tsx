import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError, deleteRecipe, listRecipes, NOT_CONFIGURED, Recipe } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function RecipeListScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setRecipes(await listRecipes());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const confirmDelete = (recipe: Recipe) => {
    Alert.alert('Delete recipe', `Delete "${recipe.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRecipe(recipe.id);
            refresh();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof ApiError ? e.message : String(e));
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {error ? (
        <View style={styles.message}>
          <Text style={styles.messageText}>{error}</Text>
          {error === NOT_CONFIGURED ? (
            <Pressable style={styles.button} onPress={() => router.push('/settings')}>
              <Text style={styles.buttonText}>Open Settings</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.button} onPress={refresh}>
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={recipes}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={recipes.length === 0 ? styles.message : styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
          ListEmptyComponent={
            loading ? null : (
              <Text style={styles.messageText}>
                No recipes yet. Tap + to add your first one.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
              onLongPress={() => confirmDelete(item)}
            >
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSubtitle}>
                {item.ingredients.length}{' '}
                {item.ingredients.length === 1 ? 'ingredient' : 'ingredients'}
              </Text>
            </Pressable>
          )}
        />
      )}

      <View style={styles.footer}>
        <Link href="/settings" asChild>
          <Pressable style={styles.settingsLink} hitSlop={12}>
            <Text style={styles.settingsLinkText}>Settings</Text>
          </Pressable>
        </Link>
        <Link href="/edit" asChild>
          <Pressable style={styles.fab}>
            <Text style={styles.fabText}>+</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 96 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  cardSubtitle: { marginTop: 2, fontSize: 13, color: colors.muted },
  message: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  messageText: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  buttonText: { color: colors.accentText, fontWeight: '600' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingsLink: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  settingsLinkText: { color: colors.muted, fontWeight: '600' },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: colors.accentText, fontSize: 30, lineHeight: 34, fontWeight: '400' },
});
