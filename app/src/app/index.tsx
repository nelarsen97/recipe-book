import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Screen from '@/components/screen';
import { loadSettings } from '@/lib/settings';
import { deleteLocal, getRecipes, pendingCount, Recipe, subscribe } from '@/lib/store';
import { syncNow } from '@/lib/sync';
import { colors } from '@/lib/theme';

export default function RecipeListScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [serverEnabled, setServerEnabled] = useState(false);

  const readStore = useCallback(async () => {
    setRecipes(await getRecipes());
    setPending(await pendingCount());
  }, []);

  // The store notifies on every change, local edits and sync alike.
  useEffect(() => {
    // readStore is async: its setState lands in a microtask, not synchronously
    // in the effect body, which is what the rule is guarding against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    readStore();
    return subscribe(readStore);
  }, [readStore]);

  // Re-read on focus so returning from Settings picks up a toggled server.
  useFocusEffect(
    useCallback(() => {
      loadSettings().then((s) => {
        setServerEnabled(s.serverEnabled);
        if (!s.serverEnabled) setSyncError(null);
      });
    }, [])
  );

  const sync = useCallback(async () => {
    setSyncing(true);
    const result = await syncNow();
    setSyncError(result.ok ? null : (result.error ?? 'Sync failed'));
    setSyncing(false);
  }, []);

  const confirmDelete = (recipe: Recipe) => {
    Alert.alert('Delete recipe', `Delete "${recipe.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteLocal(recipe.id);
          syncNow();
        },
      },
    ]);
  };

  const showBanner = serverEnabled && (pending > 0 || syncError !== null);

  return (
    <Screen>
      {showBanner && (
        <Pressable style={styles.banner} onPress={sync} disabled={syncing}>
          <Text style={styles.bannerText}>
            {syncing
              ? 'Syncing…'
              : pending > 0
                ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync — tap to retry`
                : 'Synced'}
          </Text>
          {!syncing && syncError && <Text style={styles.bannerDetail}>{syncError}</Text>}
        </Pressable>
      )}

      <FlatList
        data={recipes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={recipes.length === 0 ? styles.message : styles.list}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={sync} />}
        ListEmptyComponent={
          <Text style={styles.messageText}>
            No recipes yet. Tap + to add your first one.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
            onLongPress={() => confirmDelete(item)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              {item.dirty && <Text style={styles.dirtyDot}>●</Text>}
            </View>
            <Text style={styles.cardSubtitle}>
              {item.ingredients.length}{' '}
              {item.ingredients.length === 1 ? 'ingredient' : 'ingredients'}
            </Text>
          </Pressable>
        )}
      />

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#FFF3E8',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bannerText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  bannerDetail: { color: colors.muted, fontSize: 12, marginTop: 2 },
  list: { padding: 16, gap: 10, paddingBottom: 96 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text, flexShrink: 1 },
  dirtyDot: { color: colors.accent, fontSize: 10 },
  cardSubtitle: { marginTop: 2, fontSize: 13, color: colors.muted },
  message: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  messageText: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
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
