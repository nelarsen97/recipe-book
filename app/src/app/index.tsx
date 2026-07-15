import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';
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
import {
  deleteLocal,
  getRecipes,
  importRecipes,
  pendingCount,
  Recipe,
  subscribe,
} from '@/lib/store';
import { syncNow } from '@/lib/sync';
import { colors } from '@/lib/theme';
import { exportRecipesToFile, parseImport, pickAndReadImportFile } from '@/lib/transfer';

export default function RecipeListScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [serverEnabled, setServerEnabled] = useState(false);

  // Multi-select: long-press a card to enter selection mode, then tap to toggle.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const enterSelection = (id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = recipes.length > 0 && selectedIds.size === recipes.length;

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(recipes.map((r) => r.id)));
  };

  const exportSelected = async () => {
    const chosen = recipes.filter((r) => selectedIds.has(r.id));
    if (chosen.length === 0) return;
    try {
      await exportRecipesToFile(chosen);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    }
    exitSelection();
  };

  const confirmDeleteSelected = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    Alert.alert(
      'Delete recipes',
      `Delete ${ids.length} recipe${ids.length === 1 ? '' : 's'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const id of ids) await deleteLocal(id);
            syncNow();
            exitSelection();
          },
        },
      ]
    );
  };

  const importFromFile = async () => {
    try {
      const text = await pickAndReadImportFile();
      if (text === null) return; // user cancelled the picker
      const incoming = parseImport(text);
      const { added, updated } = await importRecipes(incoming);
      syncNow();
      Alert.alert(
        'Import complete',
        `${added} added, ${updated} updated (matched by recipe id).`
      );
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  };

  const showBanner = serverEnabled && (pending > 0 || syncError !== null);

  return (
    <Screen>
      <Stack.Screen
        options={
          selectionMode
            ? {
                title: `${selectedIds.size} selected`,
                headerLeft: undefined,
                headerRight: () => (
                  <View style={styles.headerButtonRow}>
                    <Pressable hitSlop={12} onPress={toggleSelectAll}>
                      <Text style={styles.headerButton}>
                        {allSelected ? 'Deselect all' : 'Select all'}
                      </Text>
                    </Pressable>
                    <Pressable hitSlop={12} onPress={exitSelection}>
                      <Text style={styles.headerButton}>Cancel</Text>
                    </Pressable>
                  </View>
                ),
              }
            : {
                title: 'Recipe Book',
                headerLeft: undefined,
                headerRight: () => (
                  <View style={styles.headerButtonRow}>
                    <Pressable hitSlop={12} onPress={() => router.push('/settings')}>
                      <Text style={styles.headerButton}>Settings</Text>
                    </Pressable>
                    <Pressable hitSlop={12} onPress={importFromFile}>
                      <Text style={styles.headerButton}>Import</Text>
                    </Pressable>
                  </View>
                ),
              }
        }
      />

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
        renderItem={({ item }) => {
          const selected = selectedIds.has(item.id);
          return (
            <Pressable
              style={[styles.card, selectionMode && selected && styles.cardSelected]}
              onPress={() =>
                selectionMode
                  ? toggleSelected(item.id)
                  : router.push({ pathname: '/recipe/[id]', params: { id: item.id } })
              }
              onLongPress={() => enterSelection(item.id)}
            >
              <View style={styles.cardHeader}>
                {selectionMode && (
                  <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                    {selected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                )}
                <Text style={styles.cardTitle}>{item.name}</Text>
                {item.dirty && <Text style={styles.dirtyDot}>●</Text>}
              </View>
              <Text style={styles.cardSubtitle}>
                {item.ingredients.length}{' '}
                {item.ingredients.length === 1 ? 'ingredient' : 'ingredients'}
              </Text>
            </Pressable>
          );
        }}
      />

      {selectionMode ? (
        <View style={styles.actionBar}>
          <Pressable
            style={[styles.actionButton, selectedIds.size === 0 && styles.actionButtonDisabled]}
            disabled={selectedIds.size === 0}
            onPress={exportSelected}
          >
            <Text style={styles.actionButtonText}>Export ({selectedIds.size})</Text>
          </Pressable>
          <Pressable
            style={[
              styles.actionButton,
              styles.actionButtonDanger,
              selectedIds.size === 0 && styles.actionButtonDisabled,
            ]}
            disabled={selectedIds.size === 0}
            onPress={confirmDeleteSelected}
          >
            <Text style={[styles.actionButtonText, styles.actionButtonTextDanger]}>
              Delete ({selectedIds.size})
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.footer}>
          <Link href="/edit" asChild>
            <Pressable style={styles.fab}>
              <Text style={styles.fabText}>+</Text>
            </Pressable>
          </Link>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerButton: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  headerButtonRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
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
  cardSelected: { borderColor: colors.accent, backgroundColor: '#FFF3E8' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkmark: { color: colors.accentText, fontSize: 13, fontWeight: '700', lineHeight: 16 },
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
    justifyContent: 'flex-end',
  },
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
  actionBar: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    elevation: 4,
  },
  actionButtonDanger: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  actionButtonDisabled: { opacity: 0.45 },
  actionButtonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  actionButtonTextDanger: { color: colors.danger },
});
