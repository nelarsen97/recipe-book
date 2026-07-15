import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_RECIPES } from '@/lib/defaults';

/**
 * Local-first recipe store. Every change is written here immediately
 * (marked dirty) so a network problem can never lose a recipe; sync.ts
 * reconciles this store with the server.
 */

export type Recipe = {
  id: string;
  name: string;
  ingredients: string[];
  /** Ordered instructions; each entry is one step and may contain newlines. */
  steps: string[];
  /** Epoch ms of the last local or server edit; last write wins on sync. */
  updated_at: number;
  /** True when this recipe has local changes the server hasn't seen. */
  dirty?: boolean;
};

type StoreData = {
  recipes: Recipe[];
  /** Recipe ids deleted locally but not yet deleted on the server. */
  pendingDeletes: string[];
  /**
   * Manual list order (recipe ids), set by drag-to-rearrange. A local
   * preference like pendingDeletes — never synced. Empty until the user
   * first rearranges; getRecipes falls back to alphabetical then.
   */
  order: string[];
  /**
   * Pinned recipe ids, in the user's chosen order (index = position in the
   * pinned section). A device preference like `order`: it is never pushed
   * to the server and survives server merges untouched.
   */
  pinnedIds: string[];
};

const KEY = 'recipe-book/store';
/** Set once the bundled defaults have been seeded, so they seed only once. */
const SEEDED_KEY = 'recipe-book/seeded';

let data: StoreData | null = null;
const listeners = new Set<() => void>();

export function uuid4(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

async function load(): Promise<StoreData> {
  if (data) return data;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    data = {
      // Blobs written before steps existed lack the field; default it here
      // so the rest of the app never sees steps === undefined.
      recipes: Array.isArray(parsed?.recipes)
        ? parsed.recipes.map((r: Recipe) => ({
            ...r,
            steps: Array.isArray(r.steps) ? r.steps : [],
          }))
        : [],
      pendingDeletes: Array.isArray(parsed?.pendingDeletes) ? parsed.pendingDeletes : [],
      order: Array.isArray(parsed?.order) ? parsed.order : [],
      pinnedIds: Array.isArray(parsed?.pinnedIds) ? parsed.pinnedIds : [],
    };
  } catch {
    data = { recipes: [], pendingDeletes: [], order: [], pinnedIds: [] };
  }
  return data;
}

async function persist(): Promise<void> {
  if (!data) return;
  await AsyncStorage.setItem(KEY, JSON.stringify(data));
  listeners.forEach((fn) => fn());
}

/** Re-render hook: fires after every store change (including sync). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function sortByName(recipes: Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getRecipes(): Promise<Recipe[]> {
  const store = await load();
  if (store.order.length === 0) return sortByName(store.recipes);
  // Manual order first; recipes it doesn't know (added or synced since the
  // last rearrange) follow alphabetically.
  const position = new Map(store.order.map((id, index) => [id, index]));
  const ordered = store.recipes
    .filter((r) => position.has(r.id))
    .sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  const rest = sortByName(store.recipes.filter((r) => !position.has(r.id)));
  return [...ordered, ...rest];
}

/**
 * Persist a manual list order (from drag-to-rearrange). Ids that don't match
 * a stored recipe are dropped; stored recipes missing from `ids` simply sort
 * after the ordered ones in getRecipes.
 */
export async function setRecipeOrder(ids: string[]): Promise<void> {
  const store = await load();
  const known = new Set(store.recipes.map((r) => r.id));
  store.order = ids.filter((id) => known.has(id));
  await persist();
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  return (await load()).recipes.find((r) => r.id === id) ?? null;
}

export async function pendingCount(): Promise<number> {
  const store = await load();
  return store.recipes.filter((r) => r.dirty).length + store.pendingDeletes.length;
}

export async function upsertLocal(input: {
  id?: string;
  name: string;
  ingredients: string[];
  steps?: string[];
}): Promise<Recipe> {
  const store = await load();
  const recipe: Recipe = {
    id: input.id ?? uuid4(),
    name: input.name,
    ingredients: input.ingredients,
    steps: input.steps ?? [],
    updated_at: Date.now(),
    dirty: true,
  };
  const index = store.recipes.findIndex((r) => r.id === recipe.id);
  if (index >= 0) store.recipes[index] = recipe;
  else store.recipes.push(recipe);
  await persist();
  return recipe;
}

/** Coerce arbitrary imported JSON into a well-formed list of strings. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Merge a batch of recipes (from an import file or the bundled defaults) into
 * the store, keyed by UUID: a matching id overwrites in place instead of
 * duplicating, a new id is appended. Every merged recipe is marked dirty and
 * re-stamped so the import wins locally and propagates on the next sync.
 * Persists once for the whole batch. Returns how many were new vs. overwritten.
 */
export async function importRecipes(
  incoming: { id?: string; name?: string; ingredients?: unknown; steps?: unknown }[]
): Promise<{ added: number; updated: number }> {
  const store = await load();
  let added = 0;
  let updated = 0;
  for (const raw of incoming) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue; // a recipe with no name is not worth importing
    const recipe: Recipe = {
      id: raw.id ?? uuid4(),
      name,
      ingredients: toStringArray(raw.ingredients),
      steps: toStringArray(raw.steps),
      updated_at: Date.now(),
      dirty: true,
    };
    const index = store.recipes.findIndex((r) => r.id === recipe.id);
    if (index >= 0) {
      store.recipes[index] = recipe;
      updated++;
    } else {
      store.recipes.push(recipe);
      added++;
    }
  }
  if (added + updated > 0) await persist();
  return { added, updated };
}

/**
 * Seed the bundled default recipes the first time the app runs. Gated on a
 * one-shot flag (not on the store being empty) so a user who deletes a default
 * never sees it reappear on the next launch.
 */
export async function ensureSeeded(): Promise<void> {
  if ((await AsyncStorage.getItem(SEEDED_KEY)) !== null) return;
  await importRecipes(DEFAULT_RECIPES);
  await AsyncStorage.setItem(SEEDED_KEY, '1');
}

export async function deleteLocal(id: string): Promise<void> {
  const store = await load();
  store.recipes = store.recipes.filter((r) => r.id !== id);
  store.pinnedIds = store.pinnedIds.filter((p) => p !== id);
  if (!store.pendingDeletes.includes(id)) store.pendingDeletes.push(id);
  await persist();
}

/**
 * Pinned recipe ids in display order, restricted to recipes that still
 * exist — a pin can go stale when its recipe is deleted on another device
 * and dropped by a sync merge.
 */
export async function getPinnedIds(): Promise<string[]> {
  const store = await load();
  const exists = new Set(store.recipes.map((r) => r.id));
  return store.pinnedIds.filter((id) => exists.has(id));
}

/**
 * Pin (appended at the end of the pinned section) or unpin a recipe.
 * Pinning never marks the recipe dirty: it's a local preference, invisible
 * to the server.
 */
export async function togglePinned(id: string): Promise<void> {
  const store = await load();
  if (store.pinnedIds.includes(id)) {
    store.pinnedIds = store.pinnedIds.filter((p) => p !== id);
  } else {
    store.pinnedIds.push(id);
  }
  await persist();
}

/** Move a pinned recipe to a new position within the pinned section. */
export async function movePinned(id: string, toIndex: number): Promise<void> {
  const pinned = await getPinnedIds(); // pruned of stale ids, like the UI's view
  const from = pinned.indexOf(id);
  if (from < 0) return;
  pinned.splice(from, 1);
  pinned.splice(Math.max(0, Math.min(toIndex, pinned.length)), 0, id);
  const store = await load();
  store.pinnedIds = pinned;
  await persist();
}

/**
 * Merge the authoritative server list into the local store, preserving
 * anything the server hasn't seen yet:
 * - locally dirty recipes win over the server copy unless the server's
 *   is newer (last write wins);
 * - clean local recipes missing from the server were deleted elsewhere
 *   and are dropped;
 * - recipes with a pending local delete are ignored until the delete
 *   is pushed.
 */
export async function mergeServerRecipes(serverRecipes: Recipe[]): Promise<void> {
  const store = await load();
  const localById = new Map(store.recipes.map((r) => [r.id, r]));
  const merged: Recipe[] = [];

  for (const server of serverRecipes) {
    if (store.pendingDeletes.includes(server.id)) continue;
    const local = localById.get(server.id);
    if (local?.dirty && local.updated_at >= server.updated_at) {
      merged.push(local);
    } else {
      merged.push({ ...server, dirty: false });
    }
  }
  for (const local of store.recipes) {
    if (local.dirty && !serverRecipes.some((s) => s.id === local.id)) {
      merged.push(local);
    }
  }

  store.recipes = merged;
  await persist();
}

/** Replace a dirty recipe with the server's accepted copy. */
export async function markSynced(server: Recipe): Promise<void> {
  const store = await load();
  const index = store.recipes.findIndex((r) => r.id === server.id);
  if (index >= 0) store.recipes[index] = { ...server, dirty: false };
  await persist();
}

export async function clearPendingDelete(id: string): Promise<void> {
  const store = await load();
  store.pendingDeletes = store.pendingDeletes.filter((d) => d !== id);
  await persist();
}

export async function dirtyRecipes(): Promise<Recipe[]> {
  return (await load()).recipes.filter((r) => r.dirty);
}

export async function pendingDeletes(): Promise<string[]> {
  return [...(await load()).pendingDeletes];
}
