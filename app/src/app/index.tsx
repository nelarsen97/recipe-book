import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  PanResponder,
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
  setRecipeOrder,
  subscribe,
} from '@/lib/store';
import { syncNow } from '@/lib/sync';
import { colors } from '@/lib/theme';
import { exportRecipesToFile, parseImport, pickAndReadImportFile } from '@/lib/transfer';

/** Vertical space between cards; must match styles.list gap. */
const LIST_GAP = 10;

type RecipeCardProps = {
  item: Recipe;
  selectionMode: boolean;
  selected: boolean;
  /** This card is lifted; translate it by dragDy and float it above the rest. */
  dragging: boolean;
  dragDy: number;
  /** Another card is lifted; slide this one out of / into its way. */
  shift: number;
  onPress: (id: string) => void;
  onLongPress: (id: string) => void;
  onToggle: (id: string) => void;
  onHeight: (id: string, height: number) => void;
  onDragStart: (id: string) => void;
  onDragMove: (dy: number) => void;
  onDragEnd: (commit: boolean) => void;
};

/**
 * One list card. The Pressable handles taps and long-presses on both
 * platforms (tap opens, or toggles in selection mode; long-press enters
 * selection mode, or — already in it — lifts the card). Once lifted, the
 * wrapper's pan responder captures the next move and drags the card;
 * releasing drops it into the hovered slot.
 */
function RecipeCard(props: RecipeCardProps) {
  // The responder is created once and reads the latest props through this
  // ref, so its closures never go stale. (Gesture callbacks always fire
  // after the commit, so the effect has run by the time they read it.)
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const lifted = useRef(false);
  const granted = useRef(false);

  // Created once per card, in state so render may read it. create() only
  // stores these callbacks; they run from touch events, never during
  // render, so the refs they close over are read outside of rendering.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      // Take the gesture over from the Pressable only once a long-press
      // has lifted this card.
      onMoveShouldSetPanResponderCapture: () => lifted.current,
      onPanResponderGrant: () => {
        granted.current = true;
      },
      // dy accumulates from the original touch-down, i.e. the lift point.
      onPanResponderMove: (_evt, gesture) => propsRef.current.onDragMove(gesture.dy),
      onPanResponderTerminationRequest: () => !lifted.current,
      onPanResponderRelease: () => {
        lifted.current = false;
        granted.current = false;
        propsRef.current.onDragEnd(true);
      },
      onPanResponderTerminate: () => {
        lifted.current = false;
        granted.current = false;
        propsRef.current.onDragEnd(false);
      },
    })
  );

  const { item, selectionMode, selected, dragging, dragDy, shift } = props;
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => props.onHeight(item.id, e.nativeEvent.layout.height)}
      style={
        dragging
          ? { transform: [{ translateY: dragDy }], zIndex: 10, elevation: 8 }
          : shift !== 0
            ? { transform: [{ translateY: shift }] }
            : null
      }
    >
      <Pressable
        style={[
          styles.card,
          selectionMode && selected && styles.cardSelected,
          dragging && styles.cardDragging,
        ]}
        onPress={() => (selectionMode ? props.onToggle(item.id) : props.onPress(item.id))}
        onLongPress={() => {
          if (selectionMode) {
            lifted.current = true;
            props.onDragStart(item.id);
          } else {
            props.onLongPress(item.id);
          }
        }}
        onPressOut={() => {
          // A lift that never moved releases here (the pan responder only
          // takes over on a move). Defer a tick: when a move DID hand the
          // gesture over, the responder's grant runs in this same dispatch.
          if (!lifted.current) return;
          setTimeout(() => {
            if (lifted.current && !granted.current) {
              lifted.current = false;
              propsRef.current.onDragEnd(true);
            }
          }, 0);
        }}
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
          {item.ingredients.length} {item.ingredients.length === 1 ? 'ingredient' : 'ingredients'}
        </Text>
      </Pressable>
    </View>
  );
}

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

  // Mirror of `recipes` for the drag handlers, which outlive any one render.
  const recipesRef = useRef<Recipe[]>([]);

  const readStore = useCallback(async () => {
    const list = await getRecipes();
    recipesRef.current = list;
    setRecipes(list);
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

  // Drag-to-rearrange (selection mode): the lifted card, where it started,
  // where it would drop, and how far the finger has moved. The gesture
  // handlers keep the authoritative copy in dragRef (written only from
  // events) and mirror it into state for rendering.
  type Drag = { id: string; from: number; to: number; dy: number; height: number };
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const heightsRef = useRef(new Map<string, number>());

  const onCardHeight = useCallback((id: string, height: number) => {
    heightsRef.current.set(id, height);
  }, []);

  // Which slot the lifted card's center currently hovers over.
  const dropIndexFor = useCallback((from: number, dy: number): number => {
    const list = recipesRef.current;
    const height = (i: number) => heightsRef.current.get(list[i].id) ?? 72;
    let top = 0;
    const tops = list.map((_, i) => {
      const t = top;
      top += height(i) + LIST_GAP;
      return t;
    });
    const center = tops[from] + height(from) / 2 + dy;
    for (let i = 0; i < list.length; i++) {
      if (center < tops[i] + height(i) + LIST_GAP) return i;
    }
    return list.length - 1;
  }, []);

  const onDragStart = useCallback((id: string) => {
    const from = recipesRef.current.findIndex((r) => r.id === id);
    if (from < 0) return;
    const next = { id, from, to: from, dy: 0, height: heightsRef.current.get(id) ?? 72 };
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onDragMove = useCallback(
    (dy: number) => {
      const prev = dragRef.current;
      if (!prev) return;
      const next = { ...prev, dy, to: dropIndexFor(prev.from, dy) };
      dragRef.current = next;
      setDrag(next);
    },
    [dropIndexFor]
  );

  const onDragEnd = useCallback((commit: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || !commit || d.to === d.from) return;
    const reordered = [...recipesRef.current];
    const [moved] = reordered.splice(d.from, 1);
    reordered.splice(d.to, 0, moved);
    // Optimistic: show the new order now; the store notify re-reads the same.
    recipesRef.current = reordered;
    setRecipes(reordered);
    setRecipeOrder(reordered.map((r) => r.id));
  }, []);

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
        scrollEnabled={drag === null}
        ListEmptyComponent={
          <Text style={styles.messageText}>
            No recipes yet. Tap + to add your first one.
          </Text>
        }
        renderItem={({ item, index }) => {
          const dragging = drag?.id === item.id;
          // Slide bystander cards out of the lifted card's target slot.
          let shift = 0;
          if (drag && !dragging) {
            const slot = drag.height + LIST_GAP;
            if (drag.to > drag.from && index > drag.from && index <= drag.to) shift = -slot;
            else if (drag.to < drag.from && index >= drag.to && index < drag.from) shift = slot;
          }
          return (
            <RecipeCard
              item={item}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              dragging={dragging}
              dragDy={dragging ? drag.dy : 0}
              shift={shift}
              onPress={(id) => router.push({ pathname: '/recipe/[id]', params: { id } })}
              onLongPress={enterSelection}
              onToggle={toggleSelected}
              onHeight={onCardHeight}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            />
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
  list: { padding: 16, gap: LIST_GAP, paddingBottom: 96 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: '#FFF3E8' },
  cardDragging: {
    borderColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
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
